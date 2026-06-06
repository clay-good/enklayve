import { z } from "zod";

/**
 * Zod schemas for every bundled dataset type in BUILD-SPEC.md §7.2, plus the
 * data manifest. Each shard is validated against its schema at load time, so a
 * malformed data refresh fails loudly instead of shipping a wrong number
 * (BUILD-SPEC.md §6, §7). The jurisdiction schema (federal + state) is the moat
 * described in §8 and is intentionally the most detailed.
 */

/** Filing statuses supported across the tax engine. */
export const FilingStatus = z.enum([
  "single",
  "married_jointly",
  "married_separately",
  "head_of_household",
  "qualifying_surviving_spouse",
]);
export type FilingStatus = z.infer<typeof FilingStatus>;

/**
 * Provenance metadata — mirrors the Citation interface in src/engine.
 * `contentHash` is optional on disk because a shard cannot contain its own
 * hash; the authoritative integrity hash lives in the manifest entry and the
 * loader injects it into the runtime citation. See ManifestEntrySchema.
 */
export const CitationSchema = z.object({
  sourceUrl: z.string().url(),
  /**
   * The citation-style short name shown on hover (SPEC-3-citations §2). Capped
   * so the tooltip stays readable; the long "why this value / transcription"
   * prose lives in `sourceNote`, which the readout report renders where it can
   * wrap. The build audit enforces the same cap so it cannot silently regress.
   */
  sourceDocument: z.string().min(1).max(160),
  /** The long rationale/transcription note, shown in the report, not the tooltip. */
  sourceNote: z.string().optional(),
  effectiveYear: z.number().int().gte(1900),
  dateRetrieved: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  contentHash: z.string().min(1).optional(),
});
export type CitationData = z.infer<typeof CitationSchema>;

/**
 * One marginal bracket: every dollar at or above `lowerBound` (and below the
 * next bracket's lowerBound) is taxed at `rate`. Brackets are stored in
 * ascending order; the top bracket has the highest lowerBound and no ceiling.
 */
export const TaxBracketSchema = z.object({
  lowerBound: z.number().gte(0),
  rate: z.number().gte(0).lte(1),
});

const bracketsByStatus = z.record(FilingStatus, z.array(TaxBracketSchema).min(1));
const amountByStatus = z.record(FilingStatus, z.number().gte(0));

/** A local income-tax add-on (e.g. New York City, Yonkers, Ohio municipalities). */
export const LocalAddOnSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Either a flat rate or its own ascending brackets. */
  flatRate: z.number().gte(0).lte(1).optional(),
  brackets: z.array(TaxBracketSchema).optional(),
});

/** A named special rule (e.g. the California 1% mental-health-services surtax). */
export const SpecialRuleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  /** Optional flat surtax rate applied above `incomeThreshold`. */
  surtaxRate: z.number().gte(0).lte(1).optional(),
  incomeThreshold: z.number().gte(0).optional(),
});

/**
 * A "taxpayer tax credit" (the Utah pattern): a nonrefundable credit that
 * substitutes for a standard deduction. The state taxes federal AGI directly
 * (no standard deduction subtracted), then grants `creditRate` of the *federal*
 * deduction back as a credit, reduced by `phaseOutRate` of state taxable income
 * above a filing-status `basePhaseOut`, floored at zero (Utah Code §59-10-1018;
 * TC-40 taxpayer-tax-credit worksheet). Per-dependent personal exemptions that
 * would add to the credit base are deferred — like every other state's dependent
 * handling, the engine models the no-dependent filer — so the modeled credit
 * errs slightly small (state tax slightly high), the conservative side.
 */
export const TaxpayerCreditSchema = z.object({
  /** Fraction of the federal deduction granted as the initial credit (Utah: 0.06). */
  creditRate: z.number().gte(0).lte(1),
  /** Fraction of taxable income above the base by which the credit phases out (Utah: 0.013). */
  phaseOutRate: z.number().gte(0).lte(1),
  /** Taxable income above which the credit begins to phase out, by filing status. */
  basePhaseOutByFilingStatus: amountByStatus,
});
export type TaxpayerCreditData = z.infer<typeof TaxpayerCreditSchema>;

/**
 * An AGI-based phase-out of the standard deduction — a "sliding standard
 * deduction". Two equivalent linear forms are supported, exactly one per
 * filing-status entry:
 *
 *  - **`divisor`** (South Carolina H.4216 / SCIAD): the deduction is reduced by
 *    `standardDeduction × (AGI − agiThreshold) / divisor`, reaching zero once AGI
 *    exceeds the threshold by `divisor` (the fraction reaches one). The reduction
 *    is proportional to the deduction. Statutory cite: S.C. Code §12-6-1140(15).
 *  - **`reductionRate`** (Wisconsin Wis. Stat. §71.05(23)(a)): the deduction is
 *    reduced by `reductionRate × (AGI − agiThreshold)` — a flat percentage of
 *    income above the threshold, *independent* of the deduction's size — reaching
 *    zero once that reduction equals the deduction (single 12%, joint 19.778%).
 *
 * In both forms the deduction is the full amount at or below `agiThreshold` and
 * floored at zero above. `roundReductionDownTo` rounds the *reduction* down to a
 * multiple of that many dollars when present (SC: "the next lowest ten dollars").
 */
export const StandardDeductionPhaseOutSchema = z.object({
  byFilingStatus: z.record(
    z.string(),
    z
      .object({
        agiThreshold: z.number().gte(0),
        divisor: z.number().gt(0).optional(),
        reductionRate: z.number().gt(0).lte(1).optional(),
      })
      .refine((e) => (e.divisor === undefined) !== (e.reductionRate === undefined), {
        message: "supply exactly one of `divisor` (SC form) or `reductionRate` (WI form)",
      }),
  ),
  roundReductionDownTo: z.number().gt(0).optional(),
});
export type StandardDeductionPhaseOutData = z.infer<typeof StandardDeductionPhaseOutSchema>;

/**
 * A tax jurisdiction (federal, a state, or a no-income-tax state as a
 * first-class record). One generic evaluator consumes any number of these —
 * adding a state means adding a data file, not code (BUILD-SPEC.md §8).
 */
export const JurisdictionSchema = z.object({
  /** "US", or "US-CA", "US-NY", etc. */
  id: z.string().regex(/^US(-[A-Z]{2})?$/),
  name: z.string().min(1),
  taxYear: z.number().int().gte(1900),
  /** States with no income tax set this true and carry empty brackets. */
  hasIncomeTax: z.boolean(),
  supportedFilingStatuses: z.array(FilingStatus).min(1),
  bracketsByFilingStatus: bracketsByStatus,
  standardDeductionByFilingStatus: amountByStatus,
  personalExemptionByFilingStatus: amountByStatus.optional(),
  /** AGI-based phase-out of the standard deduction (South Carolina SCIAD). */
  standardDeductionPhaseOut: StandardDeductionPhaseOutSchema.optional(),
  localAddOns: z.array(LocalAddOnSchema).optional(),
  specialRules: z.array(SpecialRuleSchema).optional(),
  /** A taxpayer tax credit that substitutes for a standard deduction (Utah). */
  taxpayerCredit: TaxpayerCreditSchema.optional(),
  citation: CitationSchema,
  effectiveDateRange: z.object({
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
});
export type Jurisdiction = z.infer<typeof JurisdictionSchema>;

// --- The remaining §7.2 dataset kinds. These are deliberately concise; each is
// fleshed out further in the phase that consumes it (Pillars 1–2). ---

/** Retirement / HSA / FSA limits and catch-up amounts (IRS annual notice). */
export const RetirementLimitsSchema = z.object({
  taxYear: z.number().int(),
  limits: z.record(z.string(), z.number().gte(0)),
  citation: CitationSchema,
});
export type RetirementLimitsData = z.infer<typeof RetirementLimitsSchema>;

/** FICA wage base, COLA, and Social Security bend points (SSA fact sheets). */
export const FicaSchema = z.object({
  taxYear: z.number().int(),
  socialSecurityWageBase: z.number().gte(0),
  socialSecurityRate: z.number().gte(0).lte(1),
  medicareRate: z.number().gte(0).lte(1),
  additionalMedicareRate: z.number().gte(0).lte(1),
  additionalMedicareThresholdByFilingStatus: amountByStatus,
  citation: CitationSchema,
});
export type FicaData = z.infer<typeof FicaSchema>;

/** CPI-U series for inflation adjustment (BLS public database). */
export const CpiSchema = z.object({
  series: z.literal("CPI-U"),
  byYear: z.record(z.string().regex(/^\d{4}$/), z.number().gt(0)),
  citation: CitationSchema,
});
export type CpiData = z.infer<typeof CpiSchema>;

/**
 * Long-term capital-gains brackets and the Net Investment Income Tax (NIIT).
 * Long-term gains stack on top of ordinary taxable income through the 0/15/20%
 * brackets; NIIT adds a flat surtax on net investment income above a MAGI
 * threshold (IRS annual revenue procedure for the brackets; IRC §1411 for NIIT).
 */
export const CapitalGainsSchema = z.object({
  taxYear: z.number().int(),
  /** Preferential long-term brackets per filing status (ascending lowerBounds). */
  longTermBracketsByFilingStatus: bracketsByStatus,
  /** Net Investment Income Tax rate (3.8%). */
  netInvestmentIncomeTaxRate: z.number().gte(0).lte(1),
  /** MAGI above which NIIT applies, by filing status (statutory, not indexed). */
  niitThresholdByFilingStatus: amountByStatus,
  citation: CitationSchema,
});
export type CapitalGainsData = z.infer<typeof CapitalGainsSchema>;

/**
 * IRS Uniform Lifetime Table for required minimum distributions (Pub 590-B).
 * The RMD for a year is the prior-year-end account balance divided by the
 * distribution period (life-expectancy factor) for the owner's age.
 */
export const RmdSchema = z.object({
  taxYear: z.number().int(),
  /** Age at which RMDs begin (73 under SECURE 2.0 for 2024). */
  beginAge: z.number().int().positive(),
  /** Distribution period (life-expectancy factor) by age. */
  distributionPeriodByAge: z.record(z.string().regex(/^\d{2,3}\+?$/), z.number().gt(0)),
  citation: CitationSchema,
});
export type RmdData = z.infer<typeof RmdSchema>;

/** Treasury I-bond / savings-bond fixed and inflation rates (TreasuryDirect). */
export const TreasuryBondsSchema = z.object({
  rates: z
    .array(
      z.object({
        period: z.string().min(1),
        fixedRate: z.number(),
        inflationRate: z.number(),
      }),
    )
    .min(1),
  citation: CitationSchema,
});
export type TreasuryBondsData = z.infer<typeof TreasuryBondsSchema>;

/** Federal Poverty Level guidelines with the three region variants (HHS). */
export const FederalPovertyLevelSchema = z.object({
  year: z.number().int(),
  region: z.enum(["contiguous", "alaska", "hawaii"]),
  base: z.number().gt(0),
  perAdditionalPerson: z.number().gt(0),
  citation: CitationSchema,
});

/** EITC and Child Tax Credit parameters (IRS annual revenue procedure). */
export const EitcCtcSchema = z.object({
  taxYear: z.number().int(),
  eitc: z.array(
    z.object({
      qualifyingChildren: z.number().int().gte(0),
      phaseInRate: z.number().gte(0).lte(1),
      maxCredit: z.number().gte(0),
      phaseOutRate: z.number().gte(0).lte(1),
      phaseOutThresholdSingle: z.number().gte(0),
      phaseOutThresholdMarried: z.number().gte(0),
    }),
  ),
  childTaxCredit: z.object({
    perChild: z.number().gte(0),
    /** Refundable portion cap per child (the Additional Child Tax Credit). */
    refundableCap: z.number().gte(0),
    /** MAGI above which the credit phases out (single / head of household). */
    phaseOutThresholdSingle: z.number().gte(0),
    /** MAGI above which the credit phases out (married filing jointly). */
    phaseOutThresholdMarried: z.number().gte(0),
    /** Credit lost per $1,000 (or fraction) of MAGI over the threshold (e.g. $50). */
    phaseOutPerThousand: z.number().gte(0),
  }),
  citation: CitationSchema,
});
export type EitcCtcData = z.infer<typeof EitcCtcSchema>;
export type FederalPovertyLevelData = z.infer<typeof FederalPovertyLevelSchema>;

/**
 * ACA premium-tax-credit applicable-percentage table (BUILD-SPEC.md §4.2). The
 * share of household income a family is expected to contribute toward the
 * benchmark (second-lowest-cost silver) plan, sliding linearly within each FPL
 * band from `percentageLow` (at `fplLow`) to `percentageHigh` (at `fplHigh`).
 * The top band may be open-ended (`fplHigh: null`) and flat — as it was under
 * the ARPA/IRA enhancement through 2025, which lifted the 400%-FPL cliff. That
 * enhancement expired after 2025, so the shipped plan-year-2026 table reverts to
 * the higher percentages and its top band ends at 400% FPL: above it there is no
 * premium tax credit (the cliff returned — see the dataset citation). The
 * benchmark premium itself is per-county and is supplied by the user (looked up
 * on HealthCare.gov), not bundled.
 */
export const AcaSchema = z.object({
  year: z.number().int(),
  applicablePercentage: z
    .array(
      z.object({
        fplLow: z.number().gte(0),
        fplHigh: z.number().nullable(),
        percentageLow: z.number().gte(0),
        percentageHigh: z.number().gte(0),
      }),
    )
    .min(1),
  citation: CitationSchema,
});
export type AcaData = z.infer<typeof AcaSchema>;

/**
 * Saver's Credit — the Retirement Savings Contributions Credit (BUILD-SPEC.md
 * §4.2, IRS Form 8880). A non-refundable credit equal to a rate (50%, 20%, or
 * 10%) of up to a capped contribution amount, where the rate steps down as AGI
 * rises through filing-status-specific ceilings.
 */
export const SaversCreditSchema = z.object({
  taxYear: z.number().int(),
  /** Maximum contribution counted per individual ($2,000); MFJ counts each spouse. */
  maxContributionPerPerson: z.number().gte(0),
  /** Credit-rate tiers, highest rate first; each gives the AGI ceiling per status. */
  tiers: z
    .array(
      z.object({
        rate: z.number().gte(0).lte(1),
        agiCapSingle: z.number().gte(0),
        agiCapHeadOfHousehold: z.number().gte(0),
        agiCapMarried: z.number().gte(0),
      }),
    )
    .min(1),
  citation: CitationSchema,
});
export type SaversCreditData = z.infer<typeof SaversCreditSchema>;

/** SNAP COLA, deductions, allotments, and the income tests (USDA FNS). */
export const SnapSchema = z.object({
  fiscalYear: z.number().int(),
  /** Region these figures apply to (allotments differ for AK/HI). */
  region: z.enum(["contiguous", "alaska", "hawaii"]),
  maxAllotmentByHouseholdSize: z.record(z.string(), z.number().gte(0)),
  /** Added to the size-8 allotment for each person beyond eight. */
  additionalPersonAllotment: z.number().gte(0),
  standardDeductionByHouseholdSize: z.record(z.string(), z.number().gte(0)),
  earnedIncomeDeductionRate: z.number().gte(0).lte(1),
  /** Gross monthly income limit as a percentage of the poverty line (130). */
  grossIncomeLimitPctFpl: z.number().gte(0),
  /** Net monthly income limit as a percentage of the poverty line (100). */
  netIncomeLimitPctFpl: z.number().gte(0),
  /** Share of net income a household is expected to contribute (0.30). */
  expectedContributionRate: z.number().gte(0).lte(1),
  /** Minimum monthly benefit for eligible one- and two-person households. */
  minBenefit: z.number().gte(0),
  citation: CitationSchema,
});
export type SnapData = z.infer<typeof SnapSchema>;

/**
 * Medicaid adult eligibility (BUILD-SPEC.md §4.3). In expansion states adult
 * MAGI eligibility is deterministic (at or below a percentage of the poverty
 * line); in non-expansion states adult coverage is limited and
 * category-specific, so we carry the expansion status per state and the
 * expansion threshold rather than inventing a precise non-expansion number.
 */
export const MedicaidSchema = z.object({
  year: z.number().int(),
  /** Adult MAGI eligibility ceiling in expansion states, as a % of FPL (138). */
  expansionThresholdPctFpl: z.number().gte(0),
  /** Per-state ceiling overrides (e.g. DC covers adults to 215% FPL). */
  thresholdOverridesPctFpl: z
    .record(z.string().regex(/^[A-Z]{2}$/), z.number().gte(0))
    .optional(),
  /** Whether each state (and DC) expanded Medicaid, keyed by two-letter code. */
  expansionByState: z.record(z.string().regex(/^[A-Z]{2}$/), z.boolean()),
  citation: CitationSchema,
});
export type MedicaidData = z.infer<typeof MedicaidSchema>;

/**
 * FAFSA Student Aid Index tables and Pell schedule (BUILD-SPEC.md §4.4, Dept. of
 * Education SAI Formula Guide). The SAI is a published, fully deterministic
 * formula; this carries the dependent-student tables it needs. Every figure is
 * cited to the official guide and is an *estimate to verify* against it and the
 * applicant's FAFSA Submission Summary — the formula structure is exact, the
 * table values are the reviewer's data-only step (like a jurisdiction's brackets).
 */
export const FafsaSchema = z.object({
  awardYear: z.string().regex(/^\d{4}-\d{4}$/),
  /** Maximum Pell Grant for the award year. */
  maxPellGrant: z.number().gte(0),
  /** Minimum Pell Grant (the floor an otherwise-eligible student receives). */
  minPellGrant: z.number().gte(0),
  /** The lowest the SAI can be under the new methodology (negative allowed). */
  saiFloor: z.number(),
  /** Parents' income protection allowance by family size (string key). */
  saiIncomeProtectionAllowance: z.record(z.string(), z.number().gte(0)),
  /** Added to the largest tabulated family size for each additional member. */
  ipaPerAdditionalPerson: z.number().gte(0),
  /** Dependent student's own income protection allowance. */
  studentIncomeProtectionAllowance: z.number().gte(0),
  /** Employment expense allowance: a rate of the lesser earned income, capped. */
  employmentExpenseAllowance: z.object({
    rate: z.number().gte(0).lte(1),
    cap: z.number().gte(0),
  }),
  /** Rate at which parents' net worth converts to an asset contribution (0.12). */
  parentAssetRate: z.number().gte(0).lte(1),
  /** Rate at which the student's available income is assessed (0.50). */
  studentIncomeRate: z.number().gte(0).lte(1),
  /** Rate at which the student's net worth is assessed (0.20). */
  studentAssetRate: z.number().gte(0).lte(1),
  /**
   * Progressive assessment of parents' adjusted available income, ascending by
   * `lowerBound` (≥ 0). The lowest rate also applies to negative AAI, so the
   * contribution can be negative (the new SAI allows a negative result).
   */
  aaiAssessment: z
    .array(z.object({ lowerBound: z.number().gte(0), rate: z.number().gte(0).lte(1) }))
    .min(1),
  citation: CitationSchema,
});
export type FafsaData = z.infer<typeof FafsaSchema>;

/**
 * Social Security retirement benefit-adjustment rules (BUILD-SPEC-2 §6.7, SSA).
 * The monthly benefit equals the Primary Insurance Amount (the benefit at Full
 * Retirement Age) adjusted for the claiming age: reduced for claiming early,
 * increased by delayed-retirement credits for claiming after FRA up to age 70.
 * The reduction is "5/9 of one percent" per month for the first 36 months early
 * and "5/12 of one percent" thereafter; the delayed credit is "2/3 of one
 * percent" per month (8%/year) for births 1943 and later — repeating fractions,
 * so they are stored exactly as numerator/denominator of one percent rather than
 * as truncated decimals.
 */
export const SocialSecuritySchema = z.object({
  effectiveYear: z.number().int(),
  /** Earliest age you can claim retirement benefits (62). */
  earliestClaimAge: z.number().int().positive(),
  /** Age at which delayed-retirement credits stop accruing (70). */
  delayedCreditMaxAge: z.number().int().positive(),
  /**
   * Full Retirement Age in months by birth year, ascending. Each entry applies
   * to births through `bornThrough` (inclusive); the final entry is open-ended
   * (`bornThrough: null`).
   */
  fullRetirementAge: z
    .array(
      z.object({
        bornThrough: z.number().int().nullable(),
        months: z.number().int().positive(),
      }),
    )
    .min(1),
  /** Early-claiming reduction, in fractions of one percent per month. */
  earlyReduction: z.object({
    firstMonths: z.number().int().positive(),
    perMonthFirstNumer: z.number().positive(),
    perMonthFirstDenom: z.number().positive(),
    perMonthBeyondNumer: z.number().positive(),
    perMonthBeyondDenom: z.number().positive(),
  }),
  /** Delayed-retirement credit per month, in fractions of one percent. */
  delayedCreditPerMonthNumer: z.number().positive(),
  delayedCreditPerMonthDenom: z.number().positive(),
  citation: CitationSchema,
});
export type SocialSecurityData = z.infer<typeof SocialSecuritySchema>;

/**
 * Traditional-IRA deduction phase-out ranges (SPEC-3 §4.3, IRS annual notice;
 * IRC §219(g)). When the taxpayer (or, for a joint filer, their spouse) is an
 * active participant in a workplace plan, the deduction for a traditional-IRA
 * contribution slides from the full contribution limit to zero as MAGI rises
 * across the filing-status range. With no workplace-plan coverage there is no
 * income limit at all, so no range applies. Each range is `{ low, high }`: full
 * deduction at or below `low`, none at or above `high`, a pro-rated partial in
 * between (Pub 590-A worksheet: round up to $10, floor at $200 inside the band).
 */
export const IraDeductionSchema = z.object({
  taxYear: z.number().int(),
  phaseOuts: z.object({
    /** You are covered by a workplace plan (single or head of household). */
    singleCovered: z.object({ low: z.number().gte(0), high: z.number().gte(0) }),
    /** You are covered, filing jointly (or qualifying surviving spouse). */
    marriedJointlyCovered: z.object({ low: z.number().gte(0), high: z.number().gte(0) }),
    /** You are NOT covered but your spouse is, filing jointly. */
    marriedJointlySpouseCovered: z.object({ low: z.number().gte(0), high: z.number().gte(0) }),
    /** Married filing separately, either spouse covered (not inflation-indexed). */
    marriedSeparatelyCovered: z.object({ low: z.number().gte(0), high: z.number().gte(0) }),
  }),
  citation: CitationSchema,
});
export type IraDeductionData = z.infer<typeof IraDeductionSchema>;

/**
 * Annual gift-tax exclusion and the lifetime gift/estate exemption (SPEC-3 §4.4,
 * IRS annual revenue procedure; IRC §2503(b), §2010, §2001(c)). A present-interest
 * gift up to `annualExclusion` per recipient per year is excluded outright; a gift
 * to a non-citizen spouse has its own higher exclusion. Amounts over the exclusion
 * draw down the `lifetimeExemption` (no tax until it is exhausted); beyond it the
 * `topRate` (the 40% top gift-tax rate) applies.
 */
export const GiftTaxSchema = z.object({
  taxYear: z.number().int(),
  annualExclusion: z.number().gte(0),
  annualExclusionNonCitizenSpouse: z.number().gte(0),
  lifetimeExemption: z.number().gte(0),
  topRate: z.number().gte(0).lte(1),
  citation: CitationSchema,
});
export type GiftTaxData = z.infer<typeof GiftTaxSchema>;

/**
 * Alternative Minimum Tax exemption, phase-out, and rate breakpoint (SPEC-3 §4.7,
 * IRS annual revenue procedure; IRC §55). The exemption shelters AMT income (AMTI)
 * and itself phases out at `phaseoutRate` of AMTI above a filing-status threshold.
 * The AMT base above the exemption is taxed at `rateLow` (26%) up to the
 * filing-status 28% breakpoint and `rateHigh` (28%) beyond it. This shard powers a
 * deliberately coarse screener, not a full Form 6251 computation.
 */
export const AmtSchema = z.object({
  taxYear: z.number().int(),
  exemptionByFilingStatus: amountByStatus,
  phaseoutThresholdByFilingStatus: amountByStatus,
  phaseoutRate: z.number().gte(0).lte(1),
  rateLow: z.number().gte(0).lte(1),
  rateHigh: z.number().gte(0).lte(1),
  rate28ThresholdByFilingStatus: amountByStatus,
  citation: CitationSchema,
});
export type AmtData = z.infer<typeof AmtSchema>;

/**
 * Child-tax parameters (SPEC-3 §4.5, IRC §1(g), Form 8615). A dependent child's
 * unearned income is sheltered up to `dependentStandardDeductionBase`, the next
 * like amount is taxed at the child's own rate, and the remainder (unearned income
 * over twice the base) is taxed at the parents' marginal rate. The dependent
 * standard deduction is the greater of the base or earned income plus
 * `earnedIncomeAddOn`, capped at the single standard deduction (read from the
 * federal shard).
 */
export const ChildTaxSchema = z.object({
  taxYear: z.number().int(),
  /** The dependent's minimum standard deduction / unearned-income shelter ($1,350). */
  dependentStandardDeductionBase: z.number().gte(0),
  /** Added to earned income when that yields a larger dependent deduction ($450). */
  earnedIncomeAddOn: z.number().gte(0),
  citation: CitationSchema,
});
export type ChildTaxData = z.infer<typeof ChildTaxSchema>;

/**
 * Education-credit parameters (SPEC-3 §4.6, IRC §25A, Form 8863). The American
 * Opportunity Tax Credit is `tier1Rate` of the first `tier1Cap` of qualified
 * expenses plus `tier2Rate` of the next `tier2Cap` (max `maxCredit` per student),
 * `refundableRate` of it refundable. The Lifetime Learning Credit is `rate` of up
 * to `expenseCap` of expenses (max `maxCredit` per return), nonrefundable. Both
 * phase out across a MAGI range by filing group (the AOTC ranges are statutory and
 * unindexed; the LLC ranges were aligned to them and made permanent).
 */
export const EducationCreditsSchema = z.object({
  taxYear: z.number().int(),
  aotc: z.object({
    tier1Cap: z.number().gte(0),
    tier1Rate: z.number().gte(0).lte(1),
    tier2Cap: z.number().gte(0),
    tier2Rate: z.number().gte(0).lte(1),
    maxCredit: z.number().gte(0),
    refundableRate: z.number().gte(0).lte(1),
  }),
  llc: z.object({
    expenseCap: z.number().gte(0),
    rate: z.number().gte(0).lte(1),
    maxCredit: z.number().gte(0),
  }),
  phaseOut: z.object({
    single: z.object({ low: z.number().gte(0), high: z.number().gte(0) }),
    married: z.object({ low: z.number().gte(0), high: z.number().gte(0) }),
  }),
  citation: CitationSchema,
});
export type EducationCreditsData = z.infer<typeof EducationCreditsSchema>;

/** Every dataset kind referenced by the manifest (BUILD-SPEC.md §7.2). */
export const DATASET_SCHEMAS = {
  "federal-income-tax": JurisdictionSchema,
  "state-income-tax": JurisdictionSchema,
  "retirement-limits": RetirementLimitsSchema,
  fica: FicaSchema,
  cpi: CpiSchema,
  "capital-gains": CapitalGainsSchema,
  rmd: RmdSchema,
  "treasury-bonds": TreasuryBondsSchema,
  "federal-poverty-level": FederalPovertyLevelSchema,
  "eitc-ctc": EitcCtcSchema,
  "savers-credit": SaversCreditSchema,
  aca: AcaSchema,
  snap: SnapSchema,
  medicaid: MedicaidSchema,
  fafsa: FafsaSchema,
  "social-security": SocialSecuritySchema,
  "ira-deduction": IraDeductionSchema,
  "gift-tax": GiftTaxSchema,
  amt: AmtSchema,
  "child-tax": ChildTaxSchema,
  "education-credits": EducationCreditsSchema,
} as const;

export type DatasetKind = keyof typeof DATASET_SCHEMAS;
export const DATASET_KINDS = Object.keys(DATASET_SCHEMAS) as DatasetKind[];

/** Schema for a single manifest entry pinning one shard. */
export const ManifestEntrySchema = z.object({
  id: z.string().min(1),
  kind: z.enum(Object.keys(DATASET_SCHEMAS) as [DatasetKind, ...DatasetKind[]]),
  version: z.string().min(1),
  effectiveYear: z.number().int().gte(1900),
  /** Expected refresh cadence in months (annual = 12, monthly CPI = 1). */
  expectedRefreshMonths: z.number().int().positive(),
  /**
   * Grace, in years, before an out-of-date effective year is treated as stale.
   * Annual data effective for year Y is acceptable through Y + staleAfterYears.
   */
  staleAfterYears: z.number().int().gte(0).default(1),
  shard: z.string().min(1),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  sourceUrl: z.string().url(),
  sourceDocument: z.string().min(1),
  dateRetrieved: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;

/** Top-level data manifest embedded into the build. */
export const ManifestSchema = z.object({
  schemaVersion: z.number().int().positive(),
  generatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  datasets: z.array(ManifestEntrySchema).min(1),
});
export type Manifest = z.infer<typeof ManifestSchema>;
