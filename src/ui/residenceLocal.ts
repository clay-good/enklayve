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
import type { SituationStore } from "../profile/situation";
import { el, option } from "./dom";
import { field } from "./form";

/**
 * The local ids that apply to a resident, given what is already selected.
 *
 * Two rules, and the second was learned the same day this module was written.
 *
 * **A selection may only hold ids the current state actually offers.** Changing
 * state used to leave the previous one's id in place: pick Indiana, then
 * California, and `loc=in-marion` stayed in California's deep link. It charged
 * nothing — the evaluator matches by id and California has no such add-on —
 * which is exactly what made it quiet, and it still put a county of another
 * state into a URL somebody might share.
 *
 * **A state with a mandatory residence local always resolves to exactly one.**
 * The selected county if it is still a real one, otherwise the shard's default,
 * because "no county" is not a state a Maryland resident can be in. Everywhere
 * else the (now valid) selection stands, which for the opt-in locals is
 * whatever the reader ticked, and for most states is nothing at all.
 */
export function resolveResidenceLocal(
  state: Jurisdiction | null | undefined,
  selected: readonly string[],
): string[] {
  const valid = new Set((state?.localAddOns ?? []).map((a) => a.id));
  const kept = selected.filter((id) => valid.has(id));
  const residence = state?.residenceLocalTax;
  if (!residence) return kept;
  return [kept[0] ?? residence.defaultId];
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

/**
 * The county a tile should start on: the deep link if it named one, otherwise
 * the county already in My Situation, otherwise the shard's default.
 *
 * The precedence is the same one every other shared field uses (URL fragment >
 * session profile > built-in default), and it matters more here than elsewhere:
 * a household does not move counties between tiles, so being asked again in the
 * Paycheck Optimizer after answering in Take-Home is the tool forgetting
 * something it was told.
 */
export function seedResidenceLocal(
  state: Jurisdiction | null | undefined,
  fromUrl: readonly string[],
  profile: SituationStore,
): string[] {
  if (fromUrl.length > 0) return resolveResidenceLocal(state, fromUrl);
  // Only a state that HAS a mandatory local may read the remembered county.
  // Without this guard the id survives into a state that has none — where
  // `resolveResidenceLocal` passes any selection through untouched, so a
  // Maryland county rode into Michigan, charged nothing (the evaluator matches
  // by id and Michigan has no such add-on) and still landed in the deep link
  // and the shared permalink: a URL saying the reader lives somewhere they do
  // not. Charging nothing is what made it quiet.
  if (!state?.residenceLocalTax) return [];
  const remembered = profile.get("county");
  return resolveResidenceLocal(state, remembered ? [remembered] : []);
}

/**
 * The id to remember as the household's county, or `""` — which clears it.
 *
 * Only a MANDATORY local is a fact about where someone lives, so only that is
 * remembered. Take-Home's selection can also hold opt-in ids (New York City,
 * Detroit, Columbus), and storing one of those as "county" would carry a
 * choice the reader made about *themselves* into four other tiles that never
 * asked, and charge them for it.
 */
export function rememberableCounty(
  state: Jurisdiction | null | undefined,
  selected: readonly string[],
): string {
  if (!state?.residenceLocalTax) return "";
  const valid = new Set((state.localAddOns ?? []).map((a) => a.id));
  return selected.find((id) => valid.has(id)) ?? "";
}
