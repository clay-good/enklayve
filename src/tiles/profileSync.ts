/**
 * The bridge between tiles and My Situation (BUILD-SPEC-2 §3). Tiles resolve
 * their starting values with the precedence URL fragment > session profile >
 * built-in default, and write the fields they share — filing status, state, and
 * income — back to the profile so a value entered in one tile pre-fills the next.
 */
import type { FilingStatus } from "../data/schemas";
import type { SituationStore } from "../profile/situation";

export interface SharedFields {
  filingStatus?: FilingStatus;
  stateCode?: string;
  annualIncome?: number;
  /** W-2 box 12 code TP; see SituationValues for why it is not "qualified tips". */
  qualifiedTipsAnnual?: number;
  /** W-2 box 12 code TT. */
  qualifiedOvertimeAnnual?: number;
}

/** Write the shared fields back to the profile, marked as typed by the user. */
export function rememberShared(profile: SituationStore, fields: SharedFields): void {
  if (fields.filingStatus !== undefined) profile.set("filingStatus", fields.filingStatus);
  if (fields.stateCode) profile.set("stateCode", fields.stateCode);
  if (fields.annualIncome !== undefined) profile.set("annualIncome", fields.annualIncome);
  if (fields.qualifiedTipsAnnual !== undefined) {
    profile.set("qualifiedTipsAnnual", fields.qualifiedTipsAnnual);
  }
  if (fields.qualifiedOvertimeAnnual !== undefined) {
    profile.set("qualifiedOvertimeAnnual", fields.qualifiedOvertimeAnnual);
  }
}
