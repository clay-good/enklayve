/**
 * The result card (BUILD-SPEC.md §10): the answer shown large, a collapsible
 * breakdown, a one-tap copy of the headline number, and a permalink button.
 * Every breakdown line can carry its citation, honoring "every numeric output
 * shows its source" (§2 principle 5) — no orphan numbers reach the screen.
 */
import type { Money } from "../engine/money";
import type { CitationData } from "../data/schemas";
import { el, copyToClipboard } from "./dom";
import { countUp } from "./countup";

export interface BreakdownLine {
  label: string;
  /** Pre-formatted display value (e.g. a currency string or a percentage). */
  value: string;
  citation?: CitationData | null;
  /** Emphasize totals/subtotals. */
  emphasis?: boolean;
}

export interface ResultCardOptions {
  /** Label above the headline number (e.g. "Annual take-home pay"). */
  label: string;
  /** The headline figure. */
  value: Money;
  locale: string;
  breakdown: BreakdownLine[];
  /** Returns the current shareable URL — read lazily so it reflects edits. */
  permalink: () => string;
  /**
   * Override the headline formatting (default: USD currency). Safe Harbor tiles
   * use this for answers that are a duration ("3.2 months") rather than dollars.
   * Receives the counted-up number each frame.
   */
  format?: (n: number) => string;
  /** Text the copy button copies (default: the currency-formatted value). */
  copyText?: string;
}

/**
 * The inline "source" link every cited line carries. Exported so the single
 * deadline render path (`ui/deadline.ts`) uses the same affordance rather than
 * growing a second, drifting one.
 */
export function citationLink(citation: CitationData): HTMLElement {
  const label = `${citation.sourceDocument} (${citation.effectiveYear})`;
  return el(
    "a",
    {
      class: "cite-link",
      href: citation.sourceUrl,
      attrs: { rel: "noopener noreferrer", target: "_blank", title: `Source: ${label}` },
    },
    "source",
  );
}

/**
 * The source notes for a card's breakdown, deduplicated and in first-seen order.
 *
 * A `sourceNote` is the prose a shard carries about where its figures came from
 * and — the part that matters on screen — what they do NOT include. Until now it
 * reached only the exported Readout Report's citation appendix, which means a
 * Detroit resident could read a Michigan take-home figure with no hint that
 * Michigan's 24 city income taxes are outside this engine, or a Pennsylvanian
 * one with no hint about the local Earned Income Tax that most municipalities
 * levy. Those are material to the number being looked at, so they belong under
 * it.
 *
 * Deduplicated by source document, because a breakdown cites the same
 * jurisdiction on several lines and the same paragraph three times is noise.
 */
export function sourceNotesFor(
  breakdown: readonly BreakdownLine[],
): { label: string; note: string }[] {
  const seen = new Set<string>();
  const out: { label: string; note: string }[] = [];
  for (const line of breakdown) {
    const c = line.citation;
    if (!c?.sourceNote) continue;
    const key = `${c.sourceDocument}|${c.effectiveYear}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label: `${c.sourceDocument} (${c.effectiveYear})`, note: c.sourceNote });
  }
  return out;
}

function breakdownRow(line: BreakdownLine): HTMLTableRowElement {
  const cells: HTMLElement[] = [
    el("th", { class: "bd-label", attrs: { scope: "row" }, text: line.label }),
    el("td", { class: "bd-value", text: line.value }),
    el("td", { class: "bd-cite" }, line.citation ? citationLink(line.citation) : null),
  ];
  const row = el("tr", { class: line.emphasis ? "bd-row bd-row--total" : "bd-row" }, ...cells);
  return row;
}

/**
 * Build a result card element. The headline animates with a gentle count-up
 * (reduced-motion aware) and is announced via aria-live so screen readers hear
 * the result. The breakdown is a real <details>/<summary> so it is keyboard
 * operable and collapsible with no JavaScript needed for the toggle itself.
 */
export function resultCard(options: ResultCardOptions): HTMLElement {
  const valueNode = el("output", {
    class: "result-value",
    attrs: { "aria-live": "polite" },
    text: "",
  });

  // Count up to the headline number, formatting every frame. Currency by
  // default; a tile can override `format` for a duration or other unit.
  const currency = (n: number): string =>
    new Intl.NumberFormat(options.locale, { style: "currency", currency: "USD" }).format(n);
  const formatHeadline = options.format ?? currency;
  const target = options.format
    ? options.value.toNumber()
    : options.value.roundToCents().toNumber();
  countUp(valueNode, target, formatHeadline);

  const copyBtn = el("button", {
    type: "button",
    class: "btn btn--ghost",
    text: "Copy number",
    on: {
      click: () => {
        void copyToClipboard(options.copyText ?? options.value.format(options.locale));
      },
    },
  });

  const linkBtn = el("button", {
    type: "button",
    class: "btn btn--ghost",
    text: "Copy link",
    on: {
      click: () => {
        void copyToClipboard(options.permalink());
      },
    },
  });

  const table = el(
    "table",
    { class: "breakdown-table" },
    el(
      "thead",
      {},
      el(
        "tr",
        {},
        el("th", { attrs: { scope: "col" }, text: "Line" }),
        el("th", { attrs: { scope: "col" }, text: "Amount" }),
        el("th", { attrs: { scope: "col" }, text: "Source" }),
      ),
    ),
    el("tbody", {}, ...options.breakdown.map(breakdownRow)),
  );

  // Open by default so the math is front and center, not hidden behind a tap.
  // The summary reads as a neutral label ("The math") since it's shown, not hidden.
  const details = el(
    "details",
    { class: "breakdown", attrs: { open: "" } },
    el("summary", { text: "The math" }),
    table,
  );

  // The source notes, collapsed. Closed by default because they are long and
  // most readers want the number; present because for some of them the caveat
  // changes the answer — a city income tax this engine does not model, a credit
  // that could zero the figure out, a year the state has not published yet.
  const notes = sourceNotesFor(options.breakdown);
  const notesBlock =
    notes.length === 0
      ? null
      : el(
          "details",
          { class: "source-notes" },
          el("summary", { text: "What these figures leave out" }),
          ...notes.flatMap((n) => [
            el("h4", { class: "source-note-head", text: n.label }),
            el("p", { class: "source-note", text: n.note }),
          ]),
        );

  return el(
    "section",
    { class: "result-card", attrs: { "aria-label": options.label } },
    el("p", { class: "result-label", text: options.label }),
    valueNode,
    el("div", { class: "result-actions" }, copyBtn, linkBtn),
    details,
    notesBlock,
  );
}
