/**
 * Small shared helpers for the Pillar 2 (What You're Owed) tiles: a consistent
 * "married filing jointly" control and its default from My Situation.
 */
import { el } from "../ui/dom";
import type { SituationStore } from "../profile/situation";
import type { FilingStatus } from "../data/schemas";

/** Whether the profile's filing status implies married-filing-jointly. */
export function marriedDefault(profile: SituationStore): boolean {
  return profile.get("filingStatus") === "married_jointly";
}

/** A labeled "married filing jointly" checkbox (caller wraps it in a label). */
export function marriedCheckbox(checked: boolean): HTMLInputElement {
  return el("input", {
    type: "checkbox",
    name: "mfj",
    checked,
    attrs: { "aria-label": "Married filing jointly" },
  });
}

/**
 * The filing status a joint / not-joint checkbox is entitled to speak for.
 *
 * The checkbox has two values and the field has five, and treating it as if it
 * had five costs something in both directions.
 *
 * **Writing.** The Education Credits tile passed `married ? "married_jointly" :
 * "single"` to `rememberShared`, so a head-of-household filer who typed a MAGI
 * into that tile had their shared profile silently rewritten to `single` — and
 * that field is read by Take-Home, the federal tax tile, and everything else,
 * where head of household is a different standard deduction and a different
 * schedule. The tile knew one bit and overwrote five.
 *
 * **Reading.** The Owed screener passed the same collapse to the Saver's Credit,
 * whose Form 8880 table has a head-of-household column of its own at 1.5× the
 * single ceilings. A head-of-household filer between $40,250 and $60,375 of AGI
 * was told the credit was zero when it is 10% — the screener's whole job, in
 * reverse.
 *
 * So: checked means a joint return and nothing else does. Unchecked means "not
 * a joint return", which four of the five statuses satisfy, so a stored status
 * that already agrees with it survives; only one that contradicts it — a stored
 * `married_jointly` against an unchecked box — is narrowed, and `single` is the
 * only thing that bit can mean.
 */
export function checkboxFilingStatus(married: boolean, profile: SituationStore): FilingStatus {
  if (married) return "married_jointly";
  const stored = profile.get("filingStatus");
  return stored && stored !== "married_jointly" ? stored : "single";
}
