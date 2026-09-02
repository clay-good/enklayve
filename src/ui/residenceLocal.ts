/**
 * The mandatory, residence-based local income tax, as one control.
 *
 * Two states levy a local income tax that a resident does not opt into: every
 * Maryland resident pays a county (or Baltimore City) tax, and every Indiana
 * resident pays the tax of the county they lived in on Jan. 1. It is not a
 * garnish on the state figure — it is 2.25%–3.30% in Maryland and 0.50%–3.00%
 * in Indiana, on the same taxable income the state rate uses.
 *
 * The Take-Home tile has rendered that as a required dropdown since Maryland
 * shipped. The Marginal Rate Explorer and the Paycheck Optimizer did not, and
 * so answered the two questions a resident of those states is most likely to
 * ask — what does my next $1,000 cost, and what does another $1,000 into the
 * 401(k) save — with up to 3.3 points of their real marginal rate missing. That
 * was a disclosed omission when no state had a mandatory local modeled; with
 * 51 jurisdictions and ~13M people behind those two, it stopped being one.
 *
 * This module is the shared answer, so the three tiles cannot drift apart: the
 * same resolution rule, the same label, the same default. Opt-in locals (New
 * York City, Yonkers, Columbus, Detroit) are deliberately NOT handled here —
 * they are a question the reader answers, not a fact about where they live, and
 * only the Take-Home tile asks it.
 */
import type { Jurisdiction } from "../data/schemas";
import { el, option } from "./dom";
import { field } from "./form";

/**
 * The local ids that apply to a resident, given what is already selected.
 *
 * For a state with a mandatory residence local this is exactly one id — the
 * selected county if it is still a real one, otherwise the shard's default —
 * because "no county" is not a state a Maryland resident can be in. For every
 * other state it is the selection unchanged, which for these two tiles is
 * nothing at all.
 */
export function resolveResidenceLocal(
  state: Jurisdiction | null | undefined,
  selected: readonly string[],
): string[] {
  const residence = state?.residenceLocalTax;
  if (!residence) return [...selected];
  const valid = new Set((state?.localAddOns ?? []).map((a) => a.id));
  const current = selected.find((id) => valid.has(id));
  return [current ?? residence.defaultId];
}

/**
 * The county dropdown, or `null` when this state has no mandatory local — which
 * is the case everywhere but Maryland and Indiana, so the caller renders nothing.
 */
export function residenceLocalField(
  state: Jurisdiction | null | undefined,
  selectedId: string | undefined,
  onChange: () => void,
): HTMLElement | null {
  const residence = state?.residenceLocalTax;
  const addOns = state?.localAddOns ?? [];
  if (!residence || addOns.length === 0) return null;
  const selected = selectedId ?? residence.defaultId;
  const select = el(
    "select",
    { name: "loc-select", attrs: { "aria-label": residence.label } },
    ...addOns.map((a) => option(a.id, a.name, a.id === selected)),
  );
  // Set the value explicitly so the right county is selected regardless of
  // option-attribute timing (a pre-set `selected` on a detached option).
  select.value = selected;
  select.addEventListener("change", onChange);
  return field(residence.label, select);
}
