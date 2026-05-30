/**
 * Tiny, framework-free, accessible chart primitives (BUILD-SPEC.md §10). The
 * budgeting tools show a breakdown table for the exact numbers; these add a
 * plain-language *picture* on top so a first-time user grasps the shape at a
 * glance. Three shapes cover every budget/cash-flow tile:
 *
 *   - donutChart    — share of a whole (budget categories, 50/30/20 split)
 *   - flowBar       — a single bar split into segments (income → spent → left)
 *   - balanceTimeline — running balance across the month (cash-flow squeeze)
 *
 * Accessibility: the colored geometry is decorative (`aria-hidden`) and every
 * chart is a `role="img"` with a spoken `aria-label`, accompanied by a real
 * text legend. No `innerHTML` — colors are set on `element.style`, never markup
 * — keeping the shell's XSS-by-construction guarantee.
 */
import { el } from "./dom";

/** Cycle the themed chart palette (`--enk-chart-1..10`, defined per theme). */
export function paletteVar(index: number): string {
  return `var(--enk-chart-${(((index % 10) + 10) % 10) + 1})`;
}

export interface Slice {
  label: string;
  value: number;
  /** CSS color (defaults to a palette entry by position). */
  color?: string;
}

function currency(locale: string, n: number): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(n);
}

function pctOf(value: number, total: number): number {
  return total > 0 ? (value / total) * 100 : 0;
}

function swatch(color: string): HTMLElement {
  const s = el("span", { class: "legend-swatch", attrs: { "aria-hidden": "true" } });
  s.style.background = color;
  return s;
}

/** Build a shared legend: swatch + label + amount (+ percent of total). */
function legend(slices: Slice[], total: number, locale: string): HTMLElement {
  return el(
    "ul",
    { class: "chart-legend" },
    ...slices.map((s) =>
      el(
        "li",
        { class: "legend-item" },
        swatch(s.color ?? "var(--enk-border)"),
        el("span", { class: "legend-label", text: s.label }),
        el("span", { class: "legend-value", text: currency(locale, s.value) }),
        el("span", { class: "legend-pct", text: `${pctOf(s.value, total).toFixed(0)}%` }),
      ),
    ),
  );
}

export interface DonutOptions {
  slices: Slice[];
  locale: string;
  /** Spoken summary, e.g. "Budget allocation by category". */
  ariaLabel: string;
  /** Small label inside the hole (e.g. "Income"). */
  centerLabel?: string;
  /** Big figure inside the hole (e.g. the total, pre-formatted). */
  centerValue?: string;
}

/**
 * A donut (pie with a hole). The ring is a `conic-gradient` whose arcs are sized
 * by each slice's share; the hole shows an optional total. Zero-total renders a
 * calm muted ring rather than an empty/error state.
 */
export function donutChart(opts: DonutOptions): HTMLElement {
  const { slices, locale } = opts;
  const total = slices.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  const colored = slices.map((s, i) => ({ ...s, color: s.color ?? paletteVar(i) }));

  const ring = el("div", { class: "donut", attrs: { "aria-hidden": "true" } });
  if (total > 0) {
    let acc = 0;
    const stops = colored
      .filter((s) => s.value > 0)
      .map((s) => {
        const start = (acc / total) * 360;
        acc += s.value;
        const end = (acc / total) * 360;
        return `${s.color} ${start.toFixed(2)}deg ${end.toFixed(2)}deg`;
      });
    ring.style.background = `conic-gradient(${stops.join(", ")})`;
  } else {
    ring.style.background = "var(--enk-surface-2)";
  }

  const center = el(
    "div",
    { class: "donut-center", attrs: { "aria-hidden": "true" } },
    opts.centerValue ? el("span", { class: "donut-total", text: opts.centerValue }) : null,
    opts.centerLabel ? el("span", { class: "donut-cap", text: opts.centerLabel }) : null,
  );

  return el(
    "figure",
    { class: "chart chart--donut", attrs: { role: "img", "aria-label": opts.ariaLabel } },
    el("div", { class: "donut-wrap" }, ring, center),
    legend(colored, total, locale),
  );
}

export interface FlowOptions {
  segments: Slice[];
  locale: string;
  ariaLabel: string;
  /**
   * The width the segments are scaled against (e.g. monthly income). Segments
   * summing past it overflow visually; a remainder below it shows as open space.
   */
  total: number;
  /** Optional trailing segment for what's left (rendered after the segments). */
  remainder?: Slice;
  /** Show the text legend below the bar (default true; off when a sibling donut already lists the slices). */
  showLegend?: boolean;
}

/**
 * A single horizontal bar split into proportional segments — the budget's
 * "income → each category → what's left" cash-flow picture. When segments
 * exceed `total` (over-assigned), the bar fills and the remainder is shown red.
 */
export function flowBar(opts: FlowOptions): HTMLElement {
  const { locale } = opts;
  const colored = opts.segments.map((s, i) => ({ ...s, color: s.color ?? paletteVar(i) }));
  const assigned = colored.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  // Scale to whichever is larger so an over-assigned bar still fits 0–100%.
  const scale = Math.max(opts.total, assigned, 1);

  const segs: HTMLElement[] = colored
    .filter((s) => s.value > 0)
    .map((s) => {
      const seg = el("div", {
        class: "flow-seg",
        attrs: { "aria-hidden": "true", title: `${s.label}: ${currency(locale, s.value)}` },
      });
      seg.style.width = `${pctOf(s.value, scale)}%`;
      seg.style.background = s.color!;
      return seg;
    });

  const remainder = opts.remainder;
  if (remainder && remainder.value > 0) {
    const seg = el("div", {
      class: "flow-seg flow-seg--rest",
      attrs: {
        "aria-hidden": "true",
        title: `${remainder.label}: ${currency(locale, remainder.value)}`,
      },
    });
    seg.style.width = `${pctOf(remainder.value, scale)}%`;
    if (remainder.color) seg.style.background = remainder.color;
    segs.push(seg);
  }

  const legendSlices = remainder ? [...colored, remainder] : colored;

  return el(
    "figure",
    { class: "chart chart--flow", attrs: { role: "img", "aria-label": opts.ariaLabel } },
    el("div", { class: "flow-bar" }, ...segs),
    opts.showLegend === false ? null : legend(legendSlices, scale, locale),
  );
}

export interface BalancePoint {
  day: number;
  balance: number;
}

export interface TimelineOptions {
  points: BalancePoint[];
  /** The day of the lowest balance (0 = never dipped below the start). */
  minDay: number;
  goesNegative: boolean;
  locale: string;
  ariaLabel: string;
  /** Day income lands; that column gets a payday marker so timing reads at a glance. */
  payday?: number;
}

/**
 * Running balance across the month as vertical bars, one per dated event. The
 * zero line floats to wherever the data needs it: bars grow up from it when the
 * balance is positive and hang below it when it goes negative, so the "rent's
 * due before payday" squeeze is literally a dip beneath the line. The tightest
 * day is highlighted, below-zero days use the warning color, and payday carries
 * a small marker.
 */
export function balanceTimeline(opts: TimelineOptions): HTMLElement {
  const { points, locale } = opts;
  const maxPos = points.reduce((m, p) => Math.max(m, p.balance), 0);
  const maxNeg = points.reduce((m, p) => Math.max(m, -p.balance), 0);
  const range = maxPos + maxNeg || 1;
  // Where the zero line sits, measured from the bottom of the track.
  const zeroPct = (maxNeg / range) * 100;

  const cols = points.map((p) => {
    const isLow = p.day === opts.minDay && opts.minDay !== 0;
    const isPayday = opts.payday !== undefined && p.day === opts.payday;
    const neg = p.balance < 0;
    const h = (Math.abs(p.balance) / range) * 100;
    const bar = el("div", {
      class: `balance-bar${neg ? " balance-bar--neg" : ""}${isLow ? " balance-bar--low" : ""}`,
      attrs: { "aria-hidden": "true" },
    });
    bar.style.height = `${h}%`;
    // Anchor at the zero line: positives rise above it, negatives hang below.
    if (neg) bar.style.bottom = `${Math.max(0, zeroPct - h)}%`;
    else bar.style.bottom = `${zeroPct}%`;

    const zeroLine = el("div", { class: "balance-zero", attrs: { "aria-hidden": "true" } });
    zeroLine.style.bottom = `${zeroPct}%`;

    return el(
      "div",
      {
        class: `balance-col${isLow ? " balance-col--low" : ""}${isPayday ? " balance-col--payday" : ""}`,
        attrs: { title: `Day ${p.day}: ${currency(locale, p.balance)}` },
      },
      el(
        "div",
        { class: "balance-track" },
        zeroLine,
        bar,
        isPayday
          ? el("span", { class: "balance-flag", attrs: { "aria-hidden": "true" }, text: "payday" })
          : null,
      ),
      el("span", { class: "balance-day", text: String(p.day) }),
    );
  });

  return el(
    "figure",
    { class: "chart chart--timeline", attrs: { role: "img", "aria-label": opts.ariaLabel } },
    el("div", { class: "balance-timeline" }, ...cols),
  );
}

export interface Stat {
  /** Small caption under the figure (e.g. "Income"). */
  label: string;
  /** The pre-formatted figure shown large. */
  value: string;
  /** One short line of context under the value (optional). */
  hint?: string;
  /** Color cue: ties the card to the result's meaning. */
  tone?: "neutral" | "good" | "warn" | "accent" | "primary";
}

/**
 * A row of stat cards: the month's headline numbers at a glance, each tinted by
 * meaning (a balanced budget glows good, an over-assigned one warns). A plain
 * list of label/value pairs, so it reads cleanly to a screen reader.
 */
export function statStrip(stats: Stat[], ariaLabel: string): HTMLElement {
  return el(
    "ul",
    { class: "stat-strip", attrs: { "aria-label": ariaLabel } },
    ...stats.map((s) =>
      el(
        "li",
        { class: `stat-card${s.tone && s.tone !== "neutral" ? ` stat-card--${s.tone}` : ""}` },
        el("span", { class: "stat-card__value", text: s.value }),
        el("span", { class: "stat-card__label", text: s.label }),
        s.hint ? el("span", { class: "stat-card__hint", text: s.hint }) : null,
      ),
    ),
  );
}
