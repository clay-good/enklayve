/**
 * Shared tile-form helpers (BUILD-SPEC.md §10, Phase 5). Each Pillar 1 tile
 * builds the same kind of labeled controls and parses the same kind of numeric
 * input, so the wiring lives here once: a labeled field, non-negative number
 * parsing, a percentage formatter, and the "Try an example" button.
 */
import { el } from "./dom";

/** Wrap a control in a labeled `.field`, linking the label via a derived id. */
export function field(labelText: string, control: HTMLElement): HTMLElement {
  // The slug must be a valid CSS identifier, not just a lowercased label:
  // punctuation in a label ("Your plan's deductible", "Coinsurance (%)") used to
  // land verbatim in the id, producing a selector nothing could query — which
  // is how it surfaced, as axe-core failing to build a selector for the node.
  const slug =
    control.getAttribute("name") ??
    labelText
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const id = `f-${slug}`;
  control.id = id;
  return el(
    "div",
    { class: "field" },
    el("label", { attrs: { for: id }, text: labelText }),
    control,
  );
}

/**
 * The largest magnitude a parsed input may carry (SPEC-3 §2.3, "inputs are
 * clamped at the boundary").
 *
 * A quadrillion is many orders of magnitude past any real figure a household
 * enters, and it leaves enough headroom below `Number.MAX_VALUE` that no product
 * or sum downstream can overflow to Infinity. Without it, a *finite* input like
 * `?bal=1e308` parsed cleanly, overflowed one multiplication later, and threw a
 * `RangeError` out of `Money.from` — which rendered a blank page rather than a
 * bad number. Sixteen tiles were reachable that way through a crafted or stale
 * deep link.
 *
 * The clamp lives here rather than in each engine because this is the boundary:
 * every tile reads its URL params through these two helpers, so one guard
 * covers the catalog and covers tiles that do not exist yet.
 */
/**
 * The label for the blank entry in a state dropdown, in one place.
 *
 * Five tiles offered this choice and described it two different ways, and both
 * were wrong about what it does. "No state tax modeled" reads as a claim about
 * coverage — a reader who could not immediately find their state could take it
 * as the option for people this site does not serve — and every one of the 50
 * states and DC has been modeled since before that label was written. "No state
 * income tax" reads as a fact about a place, but the nine states that levy none
 * are first-class records in the same dropdown, by name, showing $0.
 *
 * What the blank entry actually means is neither: compute the federal and FICA
 * halves and leave the state out. So that is what it says now, once.
 */
export const NO_STATE_OPTION_LABEL = "Federal and FICA only (no state)";

export const MAX_INPUT_MAGNITUDE = 1e15;

/** Clamp a parsed number to the bounded range. */
function bounded(n: number): number {
  return Math.max(-MAX_INPUT_MAGNITUDE, Math.min(MAX_INPUT_MAGNITUDE, n));
}

/** Parse a non-negative finite number, falling back when blank or invalid. */
export function parseNonNegative(value: string | null, fallback: number): number {
  if (value === null || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? bounded(n) : fallback;
}

/** Parse a finite number (any sign), falling back when blank or invalid. */
export function parseNumber(value: string | null, fallback: number): number {
  if (value === null || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? bounded(n) : fallback;
}

/** Format a 0–1 rate as a percentage string (e.g. 0.2235 -> "22.35%"). A
 *  non-finite rate (only reachable via nonsensical input) shows a sentinel
 *  rather than "NaN%"/"Infinity%". */
export function pct(rate: number, digits = 2): string {
  if (!Number.isFinite(rate)) return "(out of range)";
  // "-0.00%" is the same non-number as "-$0.00": a sign in front of nothing.
  // Dropped after rounding to the displayed digits, not before, so a rate that
  // is genuinely negative at the printed precision keeps its sign.
  // Grouped for the same reason `fplPercentText` is: `toFixed` is not a
  // formatter, and every percentage on the site runs through here. The Child
  // Tax tile's effective rate on unearned income reached the screen as
  // "3699999999500002304.0%" — computed, not typed, and one unbroken run of
  // digits. Rounding happens first, so a rate that is genuinely negative at the
  // printed precision keeps its sign and one that is not loses it.
  const shown = Number((rate * 100).toFixed(digits));
  return `${(shown === 0 ? 0 : shown).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

/**
 * Format a percentage-of-a-line figure without rounding it onto a line it is
 * not on.
 *
 * A household of one earning $63,900 is at 400.38% of the poverty line, which
 * `toFixed(0)` renders as "400%" — printed directly above a sentence saying
 * that above 400% of the poverty line there is no premium tax credit. The page
 * contradicted itself, and the reader's only way to tell which half was right
 * was to redo the division. The same rounding puts $15,900 (99.62%) on "100%"
 * beside a note explaining that below 100% the credit does not reach them, and
 * $22,100 (138.47%) on "138%" beside a Medicaid row that is missing because the
 * true figure is over the line.
 *
 * So a figure that rounds *onto* a threshold this surface decides with, without
 * being on it, is shown with a decimal instead. Everything else keeps the whole
 * number, because two decimal places on every figure to save three edge cases
 * is a worse page. The caller passes the thresholds that actually decide its
 * answer; a surface that decides nothing passes none and always rounds.
 *
 * `fplPercentDigits` is the same decision without the formatting, for the
 * animated headline: the count-up runs the format over every frame between zero
 * and the answer, and asking this question per frame would make the digit count
 * flicker on the way past 100 and 138. The decision is made once from the value
 * the animation is heading for, and every frame is printed to that precision.
 */
export function fplPercentDigits(value: number, decisive: readonly number[] = []): 0 | 1 {
  if (!Number.isFinite(value)) return 0;
  const whole = Math.round(value);
  return decisive.some((t) => whole === t && value !== t) ? 1 : 0;
}

export function fplPercentText(value: number, decisive: readonly number[] = []): string {
  if (!Number.isFinite(value)) return "(out of range)";
  // Grouped, because `toFixed` is not a formatter. A household whose income is
  // a rounding error above zero has an FPL percentage in the trillions, and
  // this printed it as "6265664160401% FPL" — one unbroken run of digits, on
  // four surfaces at once, since the ACA tile, the poverty-line tile, the
  // Medicaid tile and the screener all render through here. The figure is
  // computed rather than typed, so it is this helper's to format.
  const digits = fplPercentDigits(value, decisive);
  return `${value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
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
