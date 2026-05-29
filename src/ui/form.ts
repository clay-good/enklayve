/**
 * Shared tile-form helpers (BUILD-SPEC.md §10, Phase 5). Each Pillar 1 tile
 * builds the same kind of labeled controls and parses the same kind of numeric
 * input, so the wiring lives here once: a labeled field, non-negative number
 * parsing, a percentage formatter, and the "Try an example" button.
 */
import { el } from "./dom";

/** Wrap a control in a labeled `.field`, linking the label via a derived id. */
export function field(labelText: string, control: HTMLElement): HTMLElement {
  const id = `f-${control.getAttribute("name") ?? labelText.toLowerCase().replace(/\s+/g, "-")}`;
  control.id = id;
  return el(
    "div",
    { class: "field" },
    el("label", { attrs: { for: id }, text: labelText }),
    control,
  );
}

/** Parse a non-negative finite number, falling back when blank or invalid. */
export function parseNonNegative(value: string | null, fallback: number): number {
  if (value === null || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Parse a finite number (any sign), falling back when blank or invalid. */
export function parseNumber(value: string | null, fallback: number): number {
  if (value === null || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Format a 0–1 rate as a percentage string (e.g. 0.2235 -> "22.35%"). */
export function pct(rate: number, digits = 2): string {
  return `${(rate * 100).toFixed(digits)}%`;
}

/** The gold "Try an example" button that prefills a realistic worked case. */
export function tryExampleButton(onClick: () => void): HTMLButtonElement {
  return el("button", {
    type: "button",
    class: "btn btn--accent",
    text: "Try an example",
    on: { click: onClick },
  });
}
