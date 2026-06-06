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

/** Format a 0–1 rate as a percentage string (e.g. 0.2235 -> "22.35%"). A
 *  non-finite rate (only reachable via nonsensical input) shows a sentinel
 *  rather than "NaN%"/"Infinity%". */
export function pct(rate: number, digits = 2): string {
  if (!Number.isFinite(rate)) return "(out of range)";
  return `${(rate * 100).toFixed(digits)}%`;
}

/**
 * Whether a fragment param was present but silently rewritten by a clamp — the
 * deep-link-reproducibility seam (SPEC-3 §2.3 / hardening B1). The clamps
 * themselves are correct and must stay (they prevent divide-by-zero); this only
 * detects the case so the tile can *disclose* it. `parsed` is the value the
 * fragment supplied before clamping, `applied` the value after.
 */
export function didClamp(
  params: URLSearchParams,
  key: string,
  parsed: number,
  applied: number,
): boolean {
  return params.has(key) && Number.isFinite(parsed) && parsed !== applied;
}

/**
 * A calm one-line note that a pasted link was adjusted to stay valid (B1). It
 * dismisses itself the instant the user edits any input under `host` — at that
 * point they are driving and the note is stale. Returns null when nothing was
 * clamped, so the caller can append it unconditionally.
 */
export function clampNote(host: HTMLElement, messages: string[]): HTMLElement | null {
  if (messages.length === 0) return null;
  const note = el("p", {
    class: "clamp-note",
    attrs: { role: "note" },
    text: `Heads up — this shared link was adjusted to stay valid: ${messages.join("; ")}.`,
  });
  host.addEventListener("input", () => note.remove(), { once: true });
  return note;
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
