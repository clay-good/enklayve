/**
 * Small shared helpers for the Pillar 2 (What You're Owed) tiles: a consistent
 * "married filing jointly" control and its default from My Situation.
 */
import { el } from "../ui/dom";
import type { SituationStore } from "../profile/situation";

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
