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
  sourceDocument: z.string().min(1),
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
  localAddOns: z.array(LocalAddOnSchema).optional(),
  specialRules: z.array(SpecialRuleSchema).optional(),
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

/** ACA applicable percentage table and county benchmark silver plan (IRS/CMS). */
export const AcaSchema = z.object({
  year: z.number().int(),
  applicablePercentage: z
    .array(z.object({ fplLow: z.number(), fplHigh: z.number(), percentage: z.number() }))
    .min(1),
  citation: CitationSchema,
});

/** SNAP COLA, deductions, and maximum allotments (USDA FNS). */
export const SnapSchema = z.object({
  fiscalYear: z.number().int(),
  maxAllotmentByHouseholdSize: z.record(z.string(), z.number().gte(0)),
  standardDeductionByHouseholdSize: z.record(z.string(), z.number().gte(0)),
  earnedIncomeDeductionRate: z.number().gte(0).lte(1),
  citation: CitationSchema,
});

/** Medicaid MAGI thresholds by state (CMS / state publications). */
export const MedicaidSchema = z.object({
  year: z.number().int(),
  stateId: z.string().regex(/^US-[A-Z]{2}$/),
  expansionState: z.boolean(),
  adultMagiThresholdPctFpl: z.number().gte(0),
  citation: CitationSchema,
});

/** FAFSA Student Aid Index tables and Pell schedule (Dept. of Education). */
export const FafsaSchema = z.object({
  awardYear: z.string().regex(/^\d{4}-\d{4}$/),
  maxPellGrant: z.number().gte(0),
  saiIncomeProtectionAllowance: z.record(z.string(), z.number().gte(0)),
  citation: CitationSchema,
});

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
  aca: AcaSchema,
  snap: SnapSchema,
  medicaid: MedicaidSchema,
  fafsa: FafsaSchema,
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
