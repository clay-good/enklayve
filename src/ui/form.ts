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

/**
 * A calm, non-blocking hint shown when a labeled user assumption (a rate of
 * return, an inflation rate, a fee %) leaves any defensible band (SPEC-3 §2.4 /
 * hardening B2). It never clamps — the user is free to model an extreme
 * scenario, which is the point — it only signposts that the output is a stress
 * case, not a recommendation. It is a pure function of the value, so
 * determinism holds (the same input always yields the same hint). Returns null
 * when the value sits inside `[low, high]` (inclusive), so the caller can append
 * it unconditionally. `valuePct` and the band are in percentage points (6 = 6%).
 */
export function assumptionHint(
  valuePct: number,
  band: { low: number; high: number; label: string },
): HTMLElement | null {
  if (!Number.isFinite(valuePct) || (valuePct >= band.low && valuePct <= band.high)) return null;
  const direction = valuePct < band.low ? "low" : "high";
  return el("p", {
    class: "assumption-hint",
    attrs: { role: "note" },
    text: `${band.label} of ${pct(valuePct / 100, 1)} is unusually ${direction} — treat the result as a stress scenario, not a recommendation.`,
  });
}

interface AssumptionSpec {
  valuePct: number;
  band: { low: number; high: number; label: string };
}

/**
 * The multi-assumption form of {@link assumptionHint}, for a tile whose result
 * rests on several unbounded rates at once (e.g. Rent vs Buy: appreciation,
 * rent growth, investment return — the trio B2 named). Rather than stack a
 * separate note per rate, it folds every out-of-band assumption into one calm
 * line. A single out-of-band rate reuses the singular wording verbatim, so a
 * tile reads identically to the one-assumption tiles in the common case; only
 * when two or more are extreme does it name them together. Pure and
 * deterministic; returns null when every assumption sits inside its band.
 */
export function assumptionHints(specs: AssumptionSpec[]): HTMLElement | null {
  const out = specs.filter(
    (s) => Number.isFinite(s.valuePct) && (s.valuePct < s.band.low || s.valuePct > s.band.high),
  );
  const [first, second] = out;
  if (!first) return null;
  if (!second) return assumptionHint(first.valuePct, first.band);
  const parts = out.map((s) => `${s.band.label.toLowerCase()} (${pct(s.valuePct / 100, 1)})`);
  const list = `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return el("p", {
    class: "assumption-hint",
    attrs: { role: "note" },
    text: `${list.charAt(0).toUpperCase()}${list.slice(1)} are outside the usual range — treat the result as a stress scenario, not a recommendation.`,
  });
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
