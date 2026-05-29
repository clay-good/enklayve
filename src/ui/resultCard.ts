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

function citationLink(citation: CitationData): HTMLElement {
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

  const details = el(
    "details",
    { class: "breakdown" },
    el("summary", { text: "Show the math" }),
    table,
  );

  return el(
    "section",
    { class: "result-card", attrs: { "aria-label": options.label } },
    el("p", { class: "result-label", text: options.label }),
    valueNode,
    el("div", { class: "result-actions" }, copyBtn, linkBtn),
    details,
  );
}
