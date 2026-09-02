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
  /**
   * A fixed dollar amount the statute adds on top of the marginal computation
   * for income landing in THIS band — Ohio's `$332.00 plus 2.75% of the amount
   * in excess of $26,050` (ORC 5747.02(A)(3)(c), taxable years beginning 2026
   * and thereafter). It is a genuine cliff: Ohio exempts income at or below
   * $26,050 outright, and a filer one dollar over owes the whole $332.
   *
   * Only ever set this on a band whose lower bands are all 0%. In a published
   * "tax table" schedule the base amounts are CUMULATIVE — each one already
   * contains the tax from every band beneath it — so adding one on top of a
   * non-zero accumulation would double-count. Ohio fits because its only band
   * below the base is exempt, leaving nothing to double.
   */
  baseTax: z.number().gte(0).optional(),
});

const bracketsByStatus = z.record(FilingStatus, z.array(TaxBracketSchema).min(1));
const amountByStatus = z.record(FilingStatus, z.number().gte(0));

/**
 * A per-filing-status amount that MUST define **every** status. `z.record` over
 * an enum key validates a *partial* object at runtime (a shard with only
 * `single` still parses), which is the right shape for state schedules that
 * legitimately omit statuses and lean on the engine's `bracketsFor` fallback.
 * But a federal figure published for all five statuses — the Additional Medicare
 * Tax threshold — must be complete: a shard missing one is a data error that
 * should fail load-time validation and trip the fail-safe banner, never let the
 * engine silently substitute a statutory literal for the absent status
 * (the SPEC-3-hardening §A6 magic-number rule, applied here to FICA).
 */
const amountForEveryStatus = z.object({
  single: z.number().gte(0),
  married_jointly: z.number().gte(0),
  married_separately: z.number().gte(0),
  head_of_household: z.number().gte(0),
  qualifying_surviving_spouse: z.number().gte(0),
});

/** A local income-tax add-on (e.g. New York City, Yonkers, Ohio municipalities). */
export const LocalAddOnSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Either a flat rate or its own ascending brackets. */
  flatRate: z.number().gte(0).lte(1).optional(),
  brackets: z.array(TaxBracketSchema).optional(),
  /**
   * A local exemption the locality subtracts for itself, when its taxable
   * income is **not** the state's.
   *
   * Every local modeled before Detroit rode on the state's base: Maryland's and
   * Indiana's counties are levied on state taxable income by statute (Schedule
   * CT-40 line 1 is literally "the amount from IT-40, line 7"), and New York
   * City's brackets are applied to New York taxable income. Detroit is not:
   * the City of Detroit return starts from AGI and subtracts **$600 per
   * exemption** (Form 5123, TY2026), where Michigan subtracts $5,900. Running
   * Detroit's 2.4% over the state's base would understate the city tax by
   * 2.4% × $5,300 = $127.20 — small, and on the wrong side, since every other
   * launch-fidelity omission in this engine errs slightly HIGH.
   *
   * When present, the add-on's base is AGI less this amount (floored at zero)
   * instead of state taxable income. Resolved through the same filing-status
   * fallback as everything else, so MFS → single and QSS → married jointly.
   */
  personalExemptionByFilingStatus: amountByStatus.optional(),
});
export type LocalAddOnData = z.infer<typeof LocalAddOnSchema>;

/**
 * A residence-based local income tax (the Maryland county pattern). Unlike the
 * opt-in `localAddOns` (NYC, Yonkers, Ohio municipalities — where a resident
 * *checks* the one that applies), Maryland's county / Baltimore-City tax is
 * MANDATORY and set by the county of residence: every resident pays exactly one,
 * determined by where they live. When a jurisdiction carries this block, its
 * `localAddOns` are a REQUIRED single-select group labeled `label`, defaulting to
 * `defaultId`; the UI renders a dropdown (not checkboxes) and the evaluator
 * applies the single selected rate — a flat percentage, or (Anne Arundel and
 * Frederick) its own income-tiered `brackets` — to the state's taxable income.
 */
export const ResidenceLocalTaxSchema = z.object({
  /** The dropdown label shown in the take-home tile (Maryland: "County of residence"). */
  label: z.string().min(1),
  /** The `localAddOns` id selected by default when none is in the deep link. */
  defaultId: z.string().min(1),
});
export type ResidenceLocalTaxData = z.infer<typeof ResidenceLocalTaxSchema>;

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
 * floored at `floor` above (zero unless the status sets a non-zero `floor`).
 * `roundReductionDownTo` rounds the *reduction* down to a multiple of that many
 * dollars when present (SC: "the next lowest ten dollars").
 *
 * `floor` carries the **Alabama** case (Ala. Code §40-18-15(b), the Form 40
 * standard-deduction chart): the deduction slides down but never below a
 * filing-status minimum — $5,000 married-jointly, $2,500 single/MFS/head-of-family
 * — rather than to zero. Every status phases over the same $25,500→$35,500 AGI
 * band, each at its own `reductionRate` (single 5%, MFS 17.5%, head-of-family
 * 27%, joint 35% of AGI over $25,500), reaching its floor at exactly $35,500.
 *
 * `secondSegment` carries the **two-segment** variant — Wisconsin's head-of-household
 * schedule (Wis. Stat. §71.05(23)(a)3., printed as the "Schedule for Head of
 * Household" table in the DOR's Form 1-ES instructions). Head of household starts
 * from a *higher* base ($18,030 for 2026) and slides *faster* (22.515%) until the
 * curve meets the single schedule ($13,960 sliding at 12% from the same threshold),
 * after which it follows that flatter line to zero. Because both segments are lines
 * measured from the same `agiThreshold`, the schedule is exactly the **greater of the
 * two** at every AGI, so the crossover AGI is implied rather than stored — one less
 * number that can drift out of agreement with the two it is derived from. (For 2026
 * it lands at $58,827, the band boundary the DOR prints.)
 */
export const StandardDeductionPhaseOutSchema = z.object({
  byFilingStatus: z.record(
    z.string(),
    z
      .object({
        agiThreshold: z.number().gte(0),
        divisor: z.number().gt(0).optional(),
        reductionRate: z.number().gt(0).lte(1).optional(),
        /** The minimum the deduction slides to (Alabama); 0 when omitted (SC/WI/ME). */
        floor: z.number().gte(0).optional(),
        /**
         * A flatter second line, measured from the same `agiThreshold`, that takes
         * over once it yields the larger deduction (Wisconsin head of household).
         * Only meaningful alongside `reductionRate`.
         */
        secondSegment: z
          .object({
            base: z.number().gte(0),
            reductionRate: z.number().gt(0).lte(1),
          })
          .optional(),
      })
      .refine((e) => (e.divisor === undefined) !== (e.reductionRate === undefined), {
        message: "supply exactly one of `divisor` (SC form) or `reductionRate` (WI form)",
      })
      .refine((e) => e.secondSegment === undefined || e.reductionRate !== undefined, {
        message: "`secondSegment` is the two-line WI head-of-household form; it needs `reductionRate`",
      }),
  ),
  roundReductionDownTo: z.number().gt(0).optional(),
});
export type StandardDeductionPhaseOutData = z.infer<typeof StandardDeductionPhaseOutSchema>;

/**
 * A deduction (or "subtraction") for federal income tax paid, taken against
 * *state* taxable income before the state brackets apply. Two real shapes:
 *
 *  - **Alabama** (Ala. Code §40-18-15(a)(1)): the filer's full federal
 *    income-tax liability is deductible, **uncapped** — set neither
 *    `capByFilingStatus` nor `phaseOut`.
 *  - **Oregon** (ORS §316.680 / §316.695): the subtraction is **capped**
 *    (≈ $8,250 in 2024, indexed annually) and the cap itself **phases out
 *    linearly with federal AGI** — the full cap at or below `agiThreshold`,
 *    nothing at or above `agiZero`, pro-rated between.
 *
 * The evaluator subtracts `min(federal income tax, cap-after-phase-out)` from
 * state taxable income, where the federal income tax is the engine's own
 * computed figure for the same filer (so the marginal-rate probe captures the
 * interaction automatically). The federal tax used is pre-credit, matching the
 * launch-fidelity convention elsewhere in the engine.
 */
/**
 * The federal cap on the state-and-local-tax itemized deduction, IRC §164(b)(6)
 * and (b)(7).
 *
 * This was a constant in the engine — `SALT_CAP = 10000` — with no citation and
 * no shard behind it, which is the §A4 magic-number anti-pattern in its most
 * expensive form: the figure moved and the constant did not. The One Big
 * Beautiful Bill Act rewrote §164(b)(6) to cap SALT at an "applicable limitation
 * amount" of $40,000 for 2025 and $40,400 for 2026, rising 1% a year through
 * 2029 and reverting to $10,000 after. The federal shard had already been
 * refreshed to Rev. Proc. 2025-32 "reflecting the One Big Beautiful Bill Act";
 * the constant beside it still said $10,000, so a 2026 filer itemizing $30,000
 * of state and local tax was shown $20,000 less deduction than the law allows.
 *
 * Every field is a separate sentence of the statute, so a future amendment
 * changes data rather than code:
 *   (b)(7)(A)     the applicable limitation amount for this tax year
 *   (b)(7)(B)(i)  reduced by 30% of MAGI over the threshold
 *   (b)(7)(B)(ii) the threshold amount for this tax year
 *   (b)(7)(B)(iii) and never reduced below $10,000
 *   (b)(6)(B)     half of everything for a married individual filing separately
 */
/** The federal jurisdiction's shard id, the one shard that must carry a SALT limitation. */
export const FEDERAL_JURISDICTION_ID = "US";

/**
 * IRC §170(p): cash giving a filer may deduct WITHOUT itemizing.
 *
 * Added by the One Big Beautiful Bill Act (Pub. L. 119-21 §70424) for taxable
 * years beginning after December 31, 2025, and mechanically it is not part of
 * the standard deduction at all — §63(b)(4) subtracts it from adjusted gross
 * income separately, alongside the standard deduction, for a filer who does not
 * itemize.
 *
 * Optional rather than required, and the difference from the SALT limitation is
 * worth stating because the two look alike. A federal shard with no SALT
 * limitation is a shard that cannot answer a question the engine must answer, so
 * it fails validation. A federal shard with no §170(p) rule is answering: before
 * 2026 there was no such deduction, and zero is the right number. Absence means
 * something here, so absence is allowed.
 */
export const NonItemizerCharitableSchema = z.object({
  /** §170(p): the cap on a return that is not a joint return. */
  cap: z.number().gte(0),
  /** §170(p): the cap "in the case of a joint return". */
  capJointReturn: z.number().gte(0),
});
export type NonItemizerCharitableData = z.infer<typeof NonItemizerCharitableSchema>;

/**
 * IRC §151(d)(5)(C): the deduction for filers aged 65 and over.
 *
 * Added by the One Big Beautiful Bill Act for taxable years beginning before
 * January 1, 2029 — $6,000 for each qualified individual, reduced by 6% of
 * modified adjusted gross income over $75,000, or $150,000 on a joint return,
 * and never below zero. So it runs out at $175,000 single and $250,000 joint.
 *
 * Two rules in the statute that a reasonable implementation gets wrong:
 *
 *   (C)(v)  a married filer gets it ONLY on a joint return, so married filing
 *           separately is zero rather than half.
 *   (C)(i)  the $6,000 *per individual* is what the phase-out reduces, so a
 *           couple both over 65 lose twice as many dollars per dollar of income
 *           as a single filer does.
 *
 * Like §170(p) and unlike the SALT limitation, absence is an answer: a tax year
 * with no such deduction carries no rule and the engine deducts nothing, which
 * is what 2029 will need.
 */
export const SeniorDeductionSchema = z.object({
  perQualifiedIndividual: z.number().gte(0),
  /** Reduction per dollar of MAGI over the threshold (§151(d)(5)(C)(iii)(I)). */
  phaseOutRate: z.number().gte(0).lte(1),
  thresholdSingle: z.number().gt(0),
  thresholdJointReturn: z.number().gt(0),
});
export type SeniorDeductionData = z.infer<typeof SeniorDeductionSchema>;

/**
 * IRC §224 (qualified tips) and §225 (qualified overtime): two deductions with
 * one shape.
 *
 * Both added by the One Big Beautiful Bill Act (§§70201, 70202) for taxable
 * years beginning after 2025 and terminating after 2028. Both cap the deduction,
 * both reduce it by $100 for each $1,000 of modified AGI over a threshold, and
 * both apply to a married filer only on a joint return (§224(f), §225(e)).
 *
 * The phase-down is a STEP, not a rate, and that is the detail worth carrying in
 * data rather than assuming. "$100 for each $1,000 by which ... exceeds" counts
 * whole thousands: unlike §24(b)(2)'s child-credit phase-out, which says "or
 * fraction thereof" and rounds a part-thousand up, and unlike the SALT and
 * senior phase-outs, which are percentages of the excess and so are continuous.
 * Three phase-outs in one engine, three different shapes, one Act.
 *
 * IRC §163(h)(4) — qualified passenger vehicle loan interest, the Act's fifth
 * new deduction (§70203) — is the same shape again and reuses this schema, but
 * it disagrees with §§224 and 225 on both of the things that are easiest to
 * assume rather than read. It says "$200 for each $1,000 (or portion thereof)",
 * so a part-thousand counts, and it carries no joint-return restriction at all,
 * so a married individual filing separately gets it. Two sections that look
 * alike and are not, again — which is why both are FIELDS here and not a
 * convention the engine applies to every rule of this shape.
 */
export const SteppedIncomeDeductionSchema = z.object({
  cap: z.number().gte(0),
  capJointReturn: z.number().gte(0),
  /** Dollars of deduction lost per step of income over the threshold. */
  phaseOutPerStep: z.number().gte(0),
  /** The step, in dollars of income. */
  phaseOutStep: z.number().gt(0),
  thresholdSingle: z.number().gt(0),
  thresholdJointReturn: z.number().gt(0),
  /**
   * True where the statute says "or portion thereof" (§163(h)(4)(C)(ii)), so a
   * part-step counts as a whole one. False where it does not (§§224(b)(2),
   * 225(b)(2)), so only completed steps count and $1,999 over costs one step.
   */
  partialStepCounts: z.boolean(),
  /**
   * True where a married individual gets the deduction only on a joint return
   * (§224(f), §225(e)). False where the statute says no such thing, as
   * §163(h)(4) does not — separate filers get it, at the single threshold.
   */
  jointReturnOnly: z.boolean(),
});
export type SteppedIncomeDeductionData = z.infer<typeof SteppedIncomeDeductionSchema>;

/**
 * Which federal deductions a state inherits because its income tax starts from
 * FEDERAL TAXABLE INCOME rather than from federal adjusted gross income.
 *
 * §63(b) subtracts seven things from AGI to reach taxable income, and five of
 * them are the One Big Beautiful Bill Act's new deductions. A state whose
 * starting point is that figure has already given them, without legislating
 * anything, unless it adds them back — so for a tipped worker in North Dakota
 * the federal deduction is a state deduction too, and an engine that stops at
 * the standard deduction charges them state tax they do not owe.
 *
 * Five booleans rather than one, because the answer is not uniform even within
 * one state: Colorado adds back the overtime deduction (C.R.S. §39-22-104(3),
 * HB25-1296) and its own guide says in the same paragraph that no addback is
 * required for tips. And required rather than optional, because a state that
 * carries this block has to answer for each — the next new §63(b) paragraph
 * should break the build rather than be silently inherited.
 *
 * Absence is the answer for every other state, and it is a different answer
 * from "all false": New Mexico starts from federal ADJUSTED GROSS income and
 * subtracts "an amount equal to the standard deduction allowed ... by Section
 * 63" (NMSA 1978 §7-2-2(N)), which is §63(c) alone. Nothing in §63(b) reaches
 * it, so there is no conformity question to answer there.
 */
export const FederalDeductionConformitySchema = z.object({
  /** §63(b)(4), IRC §170(p): giving deducted without itemizing. */
  nonItemizerCharitable: z.boolean(),
  /** §63(b)(2), IRC §151(d)(5)(C): the deduction at 65. */
  senior: z.boolean(),
  /** §63(b)(5), IRC §224: qualified tips. */
  qualifiedTips: z.boolean(),
  /** §63(b)(6), IRC §225: qualified overtime. */
  qualifiedOvertime: z.boolean(),
  /** §63(b)(7), IRC §163(h)(4): qualified car loan interest. */
  vehicleLoanInterest: z.boolean(),
});
export type FederalDeductionConformityData = z.infer<typeof FederalDeductionConformitySchema>;

/**
 * IRC §170(b)(1)(I): the floor an itemizer's charitable giving must clear.
 *
 * Added by the One Big Beautiful Bill Act (Pub. L. 119-21 §70425) for taxable
 * years beginning after December 31, 2025. A contribution "shall be allowed only
 * to the extent that the aggregate of such contributions exceeds 0.5 percent of
 * the taxpayer's contribution base for the taxable year" — the contribution base
 * being adjusted gross income computed without any net operating loss carryback
 * (§170(b)(1)(H)), which for a wage earner is the AGI this engine already has.
 *
 * A rate rather than a dollar figure, so nothing indexes and a change is an
 * amendment somebody reads. Optional, and absence is an answer the same way
 * §170(p)'s is: before 2026 there was no floor, and zero is the right number.
 *
 * It does NOT reach the §170(p) deduction, and that is not an inference — the
 * statute excludes it by name, computing that deduction "without regard to
 * subsections (b)(1)(G)(ii), (b)(1)(I), and (d)(1)".
 */
export const CharitableFloorSchema = z.object({
  /** Share of the contribution base a gift must exceed before any is allowed. */
  rate: z.number().gte(0).lte(1),
});
export type CharitableFloorData = z.infer<typeof CharitableFloorSchema>;

/**
 * IRC §68, the overall limitation on itemized deductions — rewritten by the One
 * Big Beautiful Bill Act (§70111) and biting again for the first time since
 * 2017, for taxable years beginning after December 31, 2025.
 *
 * The old §68 was a phase-out of the deductions themselves. The new one is a
 * cap on their VALUE: "the amount of the itemized deductions otherwise allowable
 * ... shall be reduced by 2/37 of the lesser of (1) such amount of itemized
 * deductions, or (2) so much of the taxable income ... as exceeds the dollar
 * amount at which the 37 percent rate bracket under section 1 begins". Two
 * thirty-sevenths of thirty-seven percent is two percent, so a dollar of
 * deduction is worth 35 cents to a top-bracket filer instead of 37.
 *
 * Carried as the statute writes it — a numerator and a denominator, not a
 * decimal — because 2/37 does not terminate and a rounded copy of it would be a
 * figure this repo could not reproduce from the Code. The threshold is not
 * carried at all: it is "the dollar amount at which the 37 percent rate bracket
 * begins", which the shard already states in its own bracket schedule, so
 * `thresholdRate` names the rate to look it up by rather than duplicating a
 * number that would then have two places to drift.
 *
 * §68(b): applied AFTER every other limitation, which is why the engine reaches
 * it last — after the SALT cap, after the §170(b)(1)(I) charitable floor, and
 * after the medical floor.
 */
export const ItemizedLimitationSchema = z.object({
  reductionNumerator: z.number().int().gt(0),
  reductionDenominator: z.number().int().gt(0),
  /** The bracket rate whose lower bound is the threshold (0.37 today). */
  thresholdRate: z.number().gt(0).lte(1),
});
export type ItemizedLimitationData = z.infer<typeof ItemizedLimitationSchema>;

export const SaltLimitationSchema = z.object({
  applicableLimitationAmount: z.number().gt(0),
  thresholdAmount: z.number().gt(0),
  phasedownRate: z.number().gte(0).lte(1),
  floor: z.number().gte(0),
  /** The share a married-filing-separately return gets of the cap and threshold. */
  marriedSeparatelyShare: z.number().gt(0).lte(1),
});
export type SaltLimitationData = z.infer<typeof SaltLimitationSchema>;

export const FederalTaxDeductionSchema = z
  .object({
    /** Cap on the deductible federal tax, by filing status. Omit → uncapped (Alabama). */
    capByFilingStatus: amountByStatus.optional(),
    /**
     * AGI-based linear phase-out of the cap (Oregon): full cap at or below
     * `agiThreshold`, zero at or above `agiZero`. Only meaningful with a cap.
     */
    phaseOut: z
      .object({
        byFilingStatus: z.record(
          z.string(),
          z
            .object({
              agiThreshold: z.number().gte(0),
              agiZero: z.number().gt(0),
            })
            .refine((e) => e.agiZero > e.agiThreshold, {
              message: "agiZero must exceed agiThreshold",
            }),
        ),
      })
      .optional(),
  })
  .refine((d) => !d.phaseOut || d.capByFilingStatus !== undefined, {
    message: "phaseOut requires capByFilingStatus — an uncapped subtraction cannot phase out",
  });
export type FederalTaxDeductionData = z.infer<typeof FederalTaxDeductionSchema>;

/**
 * One stage of a high-income "benefit recapture": a flat dollar amount that
 * ramps linearly from `0` (at `thresholdLow`) to `amount` (at `thresholdHigh`)
 * and stays `amount` (constant) above — ADDED to the bracket tax. Stacking
 * several stages reproduces a multi-step recapture schedule with flat holds
 * between the ramps.
 */
export const RecaptureStageSchema = z
  .object({
    /** Taxable income at/below which this stage contributes nothing. */
    thresholdLow: z.number().gte(0),
    /** Taxable income at/above which this stage contributes the full `amount`. */
    thresholdHigh: z.number().gt(0),
    /** The maximum (and above-band constant) contribution of this stage. */
    amount: z.number().gte(0),
  })
  .refine((d) => d.thresholdHigh > d.thresholdLow, {
    message: "thresholdHigh must exceed thresholdLow",
  });
export type RecaptureStageData = z.infer<typeof RecaptureStageSchema>;

/**
 * A high-income "benefit recapture" added to the bracket tax. Two shapes — at
 * least one must be present:
 *
 *  - **`stages`** applies to every filing status — **Arkansas's bracket
 *    adjustment** (Ark. Code §26-51-201): one ramp ($0 → $329 over $94,700 →
 *    $97,900 of net taxable income) that recaptures the benefit of the lower
 *    0/2/3/3.4% brackets, converging to a near-flat 3.9%.
 *  - **`byFilingStatus`** gives per-status stage lists — **Connecticut's 2% Tax
 *    Rate Phase-Out Add-Back (Table C) and Tax Recapture (Table D)** combined
 *    (CT-1040 TCS): several stacked ramps, by status, that claw back the benefit
 *    of the lower brackets so the highest earners pay a near-flat 6.99%. Resolved
 *    via the filing-status fallback (MFS → single, QSS → married-jointly).
 *
 * The recapture is computed on taxable income; for Connecticut the personal
 * exemption is fully phased out before any recapture stage begins, so taxable
 * income equals Connecticut AGI there and the model matches Tables C/D exactly
 * (apart from the linear-vs-step residual within each ramp).
 */
export const IncomeRecaptureSchema = z
  .object({
    stages: z.array(RecaptureStageSchema).optional(),
    byFilingStatus: z.record(z.string(), z.array(RecaptureStageSchema)).optional(),
  })
  .refine((d) => d.stages !== undefined || d.byFilingStatus !== undefined, {
    message: "incomeRecapture requires `stages` (all statuses) or `byFilingStatus`",
  });
export type IncomeRecaptureData = z.infer<typeof IncomeRecaptureSchema>;

/**
 * A nonrefundable "personal tax credit" expressed as a fraction of the computed
 * tax (including any recapture), where the fraction depends on the filer's AGI —
 * **Connecticut's Table E** (CT-1040 TCS): the credit decimal slides from 0.75
 * (lowest incomes) down to 0 in published AGI steps, so a low-to-middle earner's
 * Connecticut income tax is `tax × (1 − rate)`. Each filing status carries an
 * ascending-by-`agiUpTo` step table; the rate is the first row whose `agiUpTo`
 * is at or above the filer's AGI, or 0 when AGI exceeds every row. Resolved via
 * the filing-status fallback (MFS → single, QSS → married-jointly).
 */
export const PersonalCreditRateSchema = z.object({
  byFilingStatus: z.record(
    z.string(),
    z.array(z.object({ agiUpTo: z.number().gt(0), rate: z.number().gte(0).lte(1) })).min(1),
  ),
});
export type PersonalCreditRateData = z.infer<typeof PersonalCreditRateSchema>;

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
  /** A mandatory residence-based local tax — its add-ons are a required single-select (Maryland counties). */
  residenceLocalTax: ResidenceLocalTaxSchema.optional(),
  specialRules: z.array(SpecialRuleSchema).optional(),
  /** A taxpayer tax credit that substitutes for a standard deduction (Utah). */
  taxpayerCredit: TaxpayerCreditSchema.optional(),
  /** A deduction for federal income tax paid (Alabama uncapped; Oregon capped + AGI-phased). */
  federalTaxDeduction: FederalTaxDeductionSchema.optional(),
  /** A high-income benefit recapture added to the bracket tax (Arkansas / Connecticut). */
  incomeRecapture: IncomeRecaptureSchema.optional(),
  /** A percent-of-tax personal credit that slides down with AGI (Connecticut's Table E). */
  personalCreditRate: PersonalCreditRateSchema.optional(),
  /**
   * The federal SALT cap (IRC §164(b)(6)-(7)). Optional on the shared schema
   * because it is a federal figure and no state carries one — but REQUIRED on
   * the federal shard, enforced below. That is the A6/A7 remedy: a federal
   * shard without it fails validation, the loader marks it invalid, and the
   * tiles show their verify-before-relying banner. The alternative is an engine
   * that substitutes a plausible literal, which is how the figure went two
   * years stale in the first place.
   */
  saltLimitation: SaltLimitationSchema.optional(),
  /** IRC §170(p), cash giving deductible without itemizing (federal only). */
  nonItemizerCharitable: NonItemizerCharitableSchema.optional(),
  /** IRC §170(b)(1)(I), the floor on an itemizer's giving (federal only). */
  charitableFloor: CharitableFloorSchema.optional(),
  /** IRC §68, the 35% value cap on itemized deductions (federal only). */
  itemizedLimitation: ItemizedLimitationSchema.optional(),
  /** IRC §151(d)(5)(C), the deduction at 65 (federal only). */
  seniorDeduction: SeniorDeductionSchema.optional(),
  /** IRC §224, the deduction for qualified tips (federal only). */
  qualifiedTipsDeduction: SteppedIncomeDeductionSchema.optional(),
  /** IRC §225, the deduction for qualified overtime (federal only). */
  qualifiedOvertimeDeduction: SteppedIncomeDeductionSchema.optional(),
  /** IRC §163(h)(4), qualified passenger vehicle loan interest (federal only). */
  vehicleLoanInterestDeduction: SteppedIncomeDeductionSchema.optional(),
  /**
   * Present only on a state whose taxable income starts from FEDERAL TAXABLE
   * INCOME, which is what makes the federal §63(b) deductions its deductions
   * too. Absent everywhere else, including the federal shard.
   */
  federalDeductionConformity: FederalDeductionConformitySchema.optional(),
  citation: CitationSchema,
  effectiveDateRange: z.object({
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
})
  .superRefine((j, ctx) => {
    // The federal shard must state its SALT limitation. See the note on the
    // field: the engine has no literal to fall back on any more, and a shard
    // that cannot answer must fail loudly rather than be answered for.
    if (j.id === FEDERAL_JURISDICTION_ID && !j.saltLimitation) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["saltLimitation"],
        message: "the federal shard must state its SALT limitation (IRC §164(b)(6)-(7))",
      });
    }
  });
export type Jurisdiction = z.infer<typeof JurisdictionSchema>;

// --- The remaining §7.2 dataset kinds. These are deliberately concise; each is
// fleshed out further in the phase that consumes it (Pillars 1–2). ---

/** Retirement / HSA / FSA limits and catch-up amounts (IRS annual notice). */
export const RetirementLimitsSchema = z.object({
  taxYear: z.number().int(),
  // The named limits the tiles read are required, so a shard missing one fails
  // validation and the dependent tiles fall back to the verify-before-relying
  // banner instead of silently substituting a stale literal (SPEC-3.md §2.5,
  // the §A4 magic-number rule). `.catchall` keeps the IRS notice's other limits
  // (FSA, the 60–63 catch-up) without requiring them.
  limits: z
    .object({
      elective_deferral_401k: z.number().gte(0),
      catch_up_401k_50plus: z.number().gte(0),
      defined_contribution_415c: z.number().gte(0),
      ira_contribution: z.number().gte(0),
      ira_catch_up_50plus: z.number().gte(0),
      hsa_self_only: z.number().gte(0),
      hsa_family: z.number().gte(0),
      hsa_catch_up_55plus: z.number().gte(0),
    })
    .catchall(z.number().gte(0)),
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
  additionalMedicareThresholdByFilingStatus: amountForEveryStatus,
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
 * Taxation of Social Security benefits (IRC §86, IRS Pub. 915). The share of
 * benefits pulled into taxable income depends on "provisional income" = other
 * income (the AGI without Social Security) + tax-exempt interest + half the
 * benefits, compared to two filing-status base amounts. Below `base1` none is
 * taxable; between `base1` and `base2` up to `tier1InclusionRate` (50%) of the
 * benefits is taxable; above `base2`, up to `tier2InclusionRate` (85%). The base
 * amounts are STATUTORY and never inflation-adjusted (unchanged since 1984/1993),
 * so the same figures apply every year — the citation says so explicitly.
 */
export const SocialSecurityTaxationSchema = z.object({
  taxYear: z.number().int(),
  /** Provisional income below which no benefits are taxable, by filing status. */
  base1ByFilingStatus: amountByStatus,
  /** Provisional income above which the 85% tier applies, by filing status. */
  base2ByFilingStatus: amountByStatus,
  /** Max share of benefits taxable in the middle tier (0.50). */
  tier1InclusionRate: z.number().gte(0).lte(1),
  /** Max share of benefits ever taxable (0.85). */
  tier2InclusionRate: z.number().gte(0).lte(1),
  citation: CitationSchema,
});
export type SocialSecurityTaxationData = z.infer<typeof SocialSecurityTaxationSchema>;

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
/**
 * IRC §530A "Trump accounts" and the §6434 pilot contribution.
 *
 * A savings account for a child under 18, added by the One Big Beautiful Bill
 * Act for taxable years after 2025. The figures are statutory rather than
 * indexed for now — §530A(c)(2)(C) starts the inflation adjustment only after
 * 2027 — so this shard is a transcription of the Code and changes by amendment.
 *
 * The dates are here as data because they are the two rules that decide whether
 * this tool applies to a reader at all: nothing could be contributed before
 * July 4, 2026 (§530A(b)(1)(C)(i), twelve months after enactment) and nothing
 * can be taken out before the calendar year the beneficiary turns 18.
 */
export const TrumpAccountSchema = z.object({
  taxYear: z.number().int(),
  /** §530A(c)(2)(A): the calendar-year cap on non-exempt contributions. */
  annualContributionLimit: z.number().gt(0),
  /** §6434: what the Secretary pays into an eligible child's account. */
  pilotContribution: z.number().gte(0),
  /** §6434's birth window, inclusive: born after 2024 and before 2029. */
  pilotBirthYearFirst: z.number().int(),
  pilotBirthYearLast: z.number().int(),
  /** §530A(b)(1)(C)(i): the first date any contribution could be accepted. */
  contributionsOpenFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** §530A(b)(1)(C)(ii): no distribution before the year the child turns this. */
  distributionAge: z.number().int().gt(0),
  citation: CitationSchema,
});
export type TrumpAccountData = z.infer<typeof TrumpAccountSchema>;

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
/**
 * Bill-triage consequence rules (SPEC-4 §A3). Not a table of numbers: a table of
 * *consequences*, which is what actually determines the order a household should
 * pay in when it cannot pay everything. Anything genuinely set by state law
 * (eviction timelines, utility shutoff notice periods, repossession rules) is
 * carried as `timing: "state"` plus a pointer, never as a specific number we
 * would be inventing for 50 different jurisdictions.
 */
export const BillTriageCategorySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  /** Coarse grouping used for headings: housing, job, insurance, court, unsecured. */
  group: z.enum(["housing", "job", "insurance", "court", "unsecured"]),
  /** Default priority; 1 is paid first. Ranks are unique and contiguous. */
  rank: z.number().int().positive(),
  /** What actually happens if this goes unpaid. The part that changes behavior. */
  consequence: z.string().min(1),
  /** Whether a clock exists, and who sets it. */
  timing: z.enum(["state", "federal", "none"]),
  timingNote: z.string().optional(),
  /** Categories of relief that exist, so a user knows a channel is there. */
  relief: z.array(z.string().min(1)),
});
export const BillTriageSchema = z.object({
  year: z.number().int(),
  categories: z.array(BillTriageCategorySchema).min(1),
  citation: CitationSchema,
});
export type BillTriageData = z.infer<typeof BillTriageSchema>;
export type BillTriageCategory = z.infer<typeof BillTriageCategorySchema>;

/**
 * Free tax-filing channels (SPEC-4 §A5). Eligibility is a small set of published
 * tests — an AGI ceiling, a minimum age, military status — so "do I have to pay
 * to file?" is answerable exactly. `omitted` records channels that were checked
 * and found unavailable, so an absence reads as a verified fact rather than an
 * oversight (IRS Direct File, ended for filing season 2026).
 */
export const FreeFilingChannelSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  /** AGI ceiling, or null when the channel has no income limit. */
  agiLimit: z.number().positive().nullable(),
  /** Minimum age, or null when age is irrelevant. */
  minAge: z.number().int().positive().nullable(),
  requiresMilitary: z.boolean(),
  /** Conditions that qualify a household regardless of the income ceiling. */
  alsoQualifies: z.array(z.enum(["disability", "limited-english"])),
  note: z.string().min(1),
  url: z.string().url(),
});
export const FreeFilingSchema = z.object({
  /** The filing season these thresholds govern (e.g. 2026). */
  filingSeason: z.number().int(),
  /** The tax year being filed in that season (e.g. 2025). */
  taxYear: z.number().int(),
  channels: z.array(FreeFilingChannelSchema).min(1),
  omitted: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        reason: z.string().min(1),
        url: z.string().url(),
      }),
    )
    .default([]),
  citation: CitationSchema,
});
export type FreeFilingData = z.infer<typeof FreeFilingSchema>;
export type FreeFilingChannel = z.infer<typeof FreeFilingChannelSchema>;

/**
 * No Surprises Act scope (SPEC-4-safety-net §B1). The Act sets **who may bill
 * you**, not what care costs — there is not a benchmark price anywhere in this
 * shard, and there must never be one: price-benchmarking would need data we
 * cannot bundle and judgment we should not make. Every entry is a situation, an
 * exclusion, or a channel, carried as text so the screener can name the rule
 * without ever concluding that a particular bill falls inside it.
 */
const NoSurprisesEntrySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  detail: z.string().min(1),
});
export const NoSurprisesSchema = z.object({
  /** ISO date the Act took effect. */
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** The situations the Act protects against a balance bill. */
  protections: z.array(NoSurprisesEntrySchema).min(1),
  /** Coverage and services the protections do not reach. Never empty: an
   * exclusion list nobody filled in is how a screener overstates its scope. */
  exclusions: z.array(NoSurprisesEntrySchema).min(1),
  /** The notice-and-consent form, which gives the protection up. */
  waiver: z.object({ label: z.string().min(1), detail: z.string().min(1) }),
  /** The uninsured / self-pay route: a good faith estimate and its dispute door. */
  uninsured: z.object({
    goodFaithEstimateAdvanceBusinessDays: z.number().int().positive(),
    disputeThresholdDollars: z.number().positive(),
    detail: z.string().min(1),
  }),
  /** Free channels to raise a bill through. Required by the Tier 3 bar. */
  channels: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        note: z.string().min(1),
        url: z.string().url(),
      }),
    )
    .min(1),
  citation: CitationSchema,
});
export type NoSurprisesData = z.infer<typeof NoSurprisesSchema>;

/**
 * Consumer Credit Protection Act Title III garnishment limits (SPEC-4-safety-net
 * §B2). Only the statutory *inputs* are stored: the federal minimum hourly wage
 * and the thirty-hour multiple that together set the protected floor, and the
 * caps as shares. The per-pay-period equivalents are derived in the engine from
 * the weekly figure rather than carried as four separate literals, so there is
 * one number to refresh when the minimum wage moves and no way for the four to
 * drift apart (SPEC-3 §A4, the magic-number rule).
 *
 * The shard is a **federal ceiling**. Every state may protect more, and where it
 * does, the state rule is the one that governs (§1677) — which is why the tile
 * that reads this renders that caveat above the figure, not beneath it.
 */
const GarnishmentNoteSchema = z.object({
  label: z.string().min(1),
  detail: z.string().min(1),
});
export const GarnishmentLimitsSchema = z.object({
  /** 29 U.S.C. §206(a)(1) — $7.25 since 2009. */
  federalMinimumHourlyWage: z.number().positive(),
  /** §1673(a)(2) — thirty times the minimum hourly wage is protected each week. */
  protectedHoursMultiple: z.number().positive(),
  /** §1673(a)(1) — the ordinary-debt ceiling, as a share of disposable earnings. */
  ordinaryDebtMaxShare: z.number().gt(0).lte(1),
  /** §1673(b)(2) — support orders have their own, higher caps. */
  supportOrder: z.object({
    supportingOtherDependentsShare: z.number().gt(0).lte(1),
    notSupportingOtherDependentsShare: z.number().gt(0).lte(1),
    /** The five points added where the order answers older arrears. */
    arrearsSurchargeShare: z.number().gte(0).lte(1),
    arrearsOlderThanWeeks: z.number().int().positive(),
  }),
  /** §1673(b)(1) — debts Title III's ceiling does not reach at all. Never empty:
   * a screener that omits them overstates the protection it is describing. */
  noFederalCeiling: z.array(GarnishmentNoteSchema.extend({ id: z.string().min(1) })).min(1),
  /** §1674 — no discharge over one indebtedness. */
  jobProtection: GarnishmentNoteSchema,
  /** §1677 — a more protective state law governs. */
  statePreemption: GarnishmentNoteSchema,
  /** What "disposable earnings" means, in the user's words. */
  disposableEarnings: GarnishmentNoteSchema,
  citation: CitationSchema,
});
export type GarnishmentLimitsData = z.infer<typeof GarnishmentLimitsSchema>;

/**
 * Statutory enrollment and appeal clocks (SPEC-4 §7.3, SPEC-4-safety-net §B4).
 *
 * These are the highest-harm numbers on the site: a missed COBRA election or
 * Medicare enrollment costs a household the coverage itself, and a missed appeal
 * window costs them the benefit. So every window carries **its own citation** to
 * the section that sets it — the shard-level citation names the set, it does not
 * stand in for the individual ones.
 *
 * `bound` is the distinction summaries routinely lose and this shard refuses to.
 * A **floor** is a period a plan or agency may exceed but never shorten (COBRA,
 * SNAP, the Marketplace). A **ceiling** is the most a state must allow, and it
 * may allow less — which is what 42 CFR §431.221(d) actually says about the
 * Medicaid fair hearing, and reading it as a guarantee is how someone misses it.
 */
const WindowDueSchema = z.union([
  /** A fixed calendar date. */
  z.object({ on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  /** A window in days from a named trigger. */
  z.object({ days: z.number().int().positive(), trigger: z.string().min(1) }),
  /** A window in whole calendar months, for the rules written that way. */
  z.object({ months: z.number().int().positive(), trigger: z.string().min(1) }),
]);
export const EnrollmentWindowsSchema = z.object({
  benefitYear: z.number().int(),
  windows: z
    .array(
      z.object({
        id: z.string().min(1),
        program: z.string().min(1),
        label: z.string().min(1),
        due: WindowDueSchema,
        bound: z.enum(["floor", "ceiling"]),
        detail: z.string().min(1),
        citation: CitationSchema,
      }),
    )
    .min(1),
  /** Clocks the states set, carried as pointers with **no figure in them** —
   * the 50-jurisdiction problem must not leak back in as a plausible default. */
  stateSet: z
    .array(
      z.object({
        id: z.string().min(1),
        program: z.string().min(1),
        label: z.string().min(1),
        note: z.string().min(1),
      }),
    )
    .min(1),
  /** Rule changes already published for a later year, so a figure that is about
   * to stop being true says so rather than quietly rotting. */
  upcomingChanges: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        detail: z.string().min(1),
        citation: CitationSchema,
      }),
    )
    .default([]),
  citation: CitationSchema,
});
export type EnrollmentWindowsData = z.infer<typeof EnrollmentWindowsSchema>;

/**
 * Life-event sequences (SPEC-4 §Phase 20b, SPEC-4-safety-net §B4).
 *
 * **This shard carries no figures at all**, and a schema test enforces it. A
 * dated step names a `windowId` in the `enrollment-windows` shard, which carries
 * its own citation to the statute that sets the clock — so no deadline is
 * duplicated here and none can drift out of step with the rule behind it.
 *
 * What this shard does contribute is the *ordering*: which step unlocks the
 * others, and which one has a clock on it that starts before anyone feels ready
 * to think about it. That is editorial judgment rather than a published
 * sequence, and the tile says so on screen rather than implying otherwise.
 */
export const LifeEventsSchema = z.object({
  sequences: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        /** What the clocks are counted from, in the user's words. */
        triggerLabel: z.string().min(1),
        lede: z.string().min(1),
        steps: z
          .array(
            z.object({
              id: z.string().min(1),
              label: z.string().min(1),
              detail: z.string().min(1),
              /** A window in the `enrollment-windows` shard. The clock lives
               * there, cited; this is only the reference to it. */
              windowId: z.string().min(1).optional(),
              channel: z.object({ label: z.string().min(1), url: z.string().url() }).optional(),
              /** A tile that does the arithmetic this step calls for. */
              tileId: z.string().min(1).optional(),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
  citation: CitationSchema,
});
export type LifeEventsData = z.infer<typeof LifeEventsSchema>;

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
  "social-security-taxation": SocialSecurityTaxationSchema,
  "ira-deduction": IraDeductionSchema,
  "gift-tax": GiftTaxSchema,
  "trump-accounts": TrumpAccountSchema,
  amt: AmtSchema,
  "child-tax": ChildTaxSchema,
  "education-credits": EducationCreditsSchema,
  "bill-triage": BillTriageSchema,
  "free-filing": FreeFilingSchema,
  "no-surprises": NoSurprisesSchema,
  "garnishment-limits": GarnishmentLimitsSchema,
  "enrollment-windows": EnrollmentWindowsSchema,
  "life-events": LifeEventsSchema,
} as const;

export type DatasetKind = keyof typeof DATASET_SCHEMAS;

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
