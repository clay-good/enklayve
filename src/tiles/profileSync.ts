/**
 * The bridge between tiles and My Situation (BUILD-SPEC-2 §3). Tiles resolve
 * their starting values with the precedence URL fragment > session profile >
 * built-in default, and write the fields they share — filing status, state,
 * income, and the county where a state makes a local income tax mandatory —
 * back to the profile so a value entered in one tile pre-fills the next.
 */
import type { FilingStatus } from "../data/schemas";
import type { SituationStore } from "../profile/situation";

export interface SharedFields {
  filingStatus?: FilingStatus;
  /**
   * Children meeting the qualifying-child test, as a count. Four tiles ask for
   * it — the EITC tile, the Child Tax Estimator, the What Am I Owed screener
   * and the cliff explorer — and each of them used to keep it, which is how the
   * Report came to size both credits for a household it assumed had none.
   */
  qualifyingChildren?: number;
  stateCode?: string;
  /**
   * A `localAddOns` id for a mandatory residence-based local tax (Maryland,
   * Indiana). Shared for the same reason the state is: five tiles charge it,
   * and asking which county someone lives in five times is asking four times
   * too many.
   */
  county?: string;
  annualIncome?: number;
  /**
   * Net self-employment profit. A different quantity from `annualIncome`,
   * which every reader of it treats as wages — see `SituationValues`. The two
   * tiles that ask for profit wrote it there until 2026-09-09.
   */
  selfEmploymentProfitAnnual?: number;
  /**
   * Annual pre-tax contributions (401(k), HSA, and the rest) — the number
   * Take-Home asks for as "Pre-tax adjustments".
   *
   * Deliberately NOT written by the Paycheck Optimizer, which asks for the
   * 401(k) and the HSA separately and is right to: an HSA dollar taken through
   * payroll leaves the FICA wage base as well as taxable income, and a 401(k)
   * dollar does not. Summing them into one figure here would hand Take-Home an
   * adjustment that is correct for income tax and too small for FICA, which is
   * a wrong take-home number arriving through a convenience.
   */
  preTaxContributions?: number;
  /** W-2 box 12 code TP; see SituationValues for why it is not "qualified tips". */
  qualifiedTipsAnnual?: number;
  /** W-2 box 12 code TT. */
  qualifiedOvertimeAnnual?: number;
}

/** Write the shared fields back to the profile, marked as typed by the user. */
export function rememberShared(profile: SituationStore, fields: SharedFields): void {
  if (fields.filingStatus !== undefined) profile.set("filingStatus", fields.filingStatus);
  // An empty state is written through for the same reason an empty county is,
  // and for a bigger number. Every state dropdown on the site offers "Federal
  // and FICA only (no state)", `SituationValues.stateCode` reads `""` as that
  // choice, and every tile resolves the profile with `?? default` so `""`
  // survives. This line tested truthiness from Phase 12 -- written before the
  // blank option meant anything -- so the choice reached the screen and never
  // reached the profile: once any state was remembered it was permanent for the
  // session, and the next tile, My Situation, My Plan and the Report all went
  // on charging a state the reader had explicitly deselected.
  if (fields.stateCode !== undefined) profile.set("stateCode", fields.stateCode);
  // An empty county is written through: moving from Maryland to Texas must
  // clear the county, not leave Montgomery behind for the next tile to charge.
  if (fields.county !== undefined) profile.set("county", fields.county);
  if (fields.annualIncome !== undefined) profile.set("annualIncome", fields.annualIncome);
  if (fields.selfEmploymentProfitAnnual !== undefined) {
    profile.set("selfEmploymentProfitAnnual", fields.selfEmploymentProfitAnnual);
  }
  if (fields.qualifyingChildren !== undefined) {
    profile.set("qualifyingChildren", fields.qualifyingChildren);
  }
  if (fields.preTaxContributions !== undefined) {
    profile.set("preTaxContributions", fields.preTaxContributions);
  }
  if (fields.qualifiedTipsAnnual !== undefined) {
    profile.set("qualifiedTipsAnnual", fields.qualifiedTipsAnnual);
  }
  if (fields.qualifiedOvertimeAnnual !== undefined) {
    profile.set("qualifiedOvertimeAnnual", fields.qualifiedOvertimeAnnual);
  }
}
