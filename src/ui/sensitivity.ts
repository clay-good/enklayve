/**
 * Sensitivity bands (SPEC-3 §4.9). The principled answer to "an extreme assumption
 * renders as fact" (invariant §2.4): instead of guard-railing the input, let the
 * user opt into a low/base/high range computed by re-running the SAME deterministic
 * function at their assumption ±a labeled delta. Three pure evaluations, never a
 * simulation — so determinism and the no-market-prediction rule both hold.
 *
 * This module owns only the presentation (a toggle and a small table); each tile
 * supplies the three already-computed scenarios, so the math stays in the engine.
 */
import { el } from "./dom";

export interface SensitivityScenario {
  /** e.g. "Conservative", "Your assumption", "Optimistic". */
  label: string;
  /** The assumption value shown, e.g. "4%". */
  assumption: string;
  /** The formatted result at that assumption. */
  result: string;
  /** Emphasize the base (middle) row. */
  base?: boolean;
}

/** The opt-in checkbox that turns the range on. The tile owns the URL state. */
export function sensitivityToggle(
  label: string,
  checked: boolean,
  onChange: (on: boolean) => void,
): HTMLElement {
  const box = el("input", {
    type: "checkbox",
    name: "band",
    checked,
    attrs: { "aria-label": label },
  });
  box.addEventListener("change", () => onChange(box.checked));
  return el("label", { class: "checkbox sensitivity-toggle" }, box, el("span", { text: label }));
}

/** A labeled low/base/high table, shown only when the toggle is on. */
export function sensitivityTable(note: string, scenarios: SensitivityScenario[]): HTMLElement {
  const rows = scenarios.map((s) =>
    el(
      "tr",
      { class: s.base ? "bd-row bd-row--total" : "bd-row" },
      el("th", { class: "bd-label", attrs: { scope: "row" }, text: s.label }),
      el("td", { class: "bd-value", text: s.assumption }),
      el("td", { class: "bd-value", text: s.result }),
    ),
  );
  const table = el(
    "table",
    { class: "breakdown-table sensitivity-table" },
    el(
      "thead",
      {},
      el(
        "tr",
        {},
        el("th", { attrs: { scope: "col" }, text: "Scenario" }),
        el("th", { attrs: { scope: "col" }, text: "Assumption" }),
        el("th", { attrs: { scope: "col" }, text: "Result" }),
      ),
    ),
    el("tbody", {}, ...rows),
  );
  return el(
    "section",
    { class: "sensitivity", attrs: { "aria-label": "Sensitivity range" } },
    el("p", { class: "sensitivity-note", text: note }),
    table,
  );
}
