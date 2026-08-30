/**
 * Tiny, framework-free, accessible chart primitives (BUILD-SPEC.md §10). The
 * budgeting tools show a breakdown table for the exact numbers; these add a
 * plain-language *picture* on top so a first-time user grasps the shape at a
 * glance. Two shapes cover every budget/cash-flow tile:
 *
 *   - donutChart    — share of a whole (budget categories, 50/30/20 split)
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

export interface CurvePoint {
  /** X value: gross income. */
  income: number;
  /** Y value: total resources at that income. */
  resources: number;
  /** True when this point sits inside a cliff (resources not rising). */
  inCliff?: boolean;
  /** Marker text for a discrete status change at this income, if any. */
  marker?: string;
}

/** Widest column count the curve draws before thinning; keeps the DOM small. */
export const MAX_CURVE_COLUMNS = 120;

/**
 * Thin a series to at most {@link MAX_CURVE_COLUMNS} columns for display, always
 * keeping the last point so the axis label matches the data. Points flagged
 * `inCliff` or carrying a `marker` are **never** dropped: the fine sweep is what
 * finds a narrow cliff, and thinning it away would hide the very thing the chart
 * exists to show.
 */
export function downsampleCurve(points: CurvePoint[]): CurvePoint[] {
  if (points.length <= MAX_CURVE_COLUMNS) return points;
  const stride = Math.ceil(points.length / MAX_CURVE_COLUMNS);
  return points.filter(
    (p, i) => i % stride === 0 || i === points.length - 1 || p.inCliff || p.marker !== undefined,
  );
}

export interface ResourceCurveOptions {
  points: CurvePoint[];
  locale: string;
  ariaLabel: string;
  /** Income to highlight as "you are here", if the user gave one. */
  highlightIncome?: number;
}

/**
 * Which drawn column is "you are here" — the nearest one, or none.
 *
 * Exact matching cannot work and quietly did not: the sweep puts its points on
 * computed steps, so the reader's income lands between two of them, and
 * {@link downsampleCurve} would have thinned their exact column away in any
 * case, since it keeps only cliff columns, markers, and every stride'th point.
 * The honest question a chart can answer is "which drawn column is nearest",
 * and the answer is one column or, outside the plotted range, none — an
 * income beyond the sweep highlighted at an endpoint would put the reader
 * somewhere they are not.
 */
export function highlightIndex(points: readonly CurvePoint[], income: number | undefined): number {
  if (income === undefined || !Number.isFinite(income) || points.length === 0) return -1;
  const first = points[0]!.income;
  const last = points[points.length - 1]!.income;
  if (income < Math.min(first, last) || income > Math.max(first, last)) return -1;
  let best = -1;
  let bestGap = Infinity;
  for (let i = 0; i < points.length; i += 1) {
    const gap = Math.abs(points[i]!.income - income);
    if (gap < bestGap) {
      bestGap = gap;
      best = i;
    }
  }
  return best;
}

/**
 * Total resources plotted against gross income (SPEC-4 §A1) — the shape of the
 * benefit cliff. Columns rather than a line, matching the rest of this
 * framework-free chart layer.
 *
 * The y-axis is deliberately **zero-based**: a truncated axis exaggerates every
 * wobble into a chasm, and this chart's whole job is to be believed. Cliff
 * columns take the warning color so a fall reads instantly, and a status change
 * (losing Medicaid) gets a marker rather than a bar, because it is not a dollar
 * amount and must never look like one.
 *
 * Callers should pass a display-sized series (see {@link downsampleCurve}); the
 * underlying analysis can sweep far more finely than a chart needs to draw.
 */
export function resourceCurve(opts: ResourceCurveOptions): HTMLElement {
  const { points, locale } = opts;
  const max = points.reduce((m, p) => Math.max(m, p.resources), 0) || 1;

  const here = highlightIndex(points, opts.highlightIncome);

  const cols = points.map((p, i) => {
    const height = Math.max(0, (p.resources / max) * 100);
    const bar = el("div", {
      class: `curve-bar${p.inCliff ? " curve-bar--cliff" : ""}`,
      attrs: { "aria-hidden": "true" },
    });
    bar.style.height = `${height}%`;

    const isHere = i === here;

    // One wrapper per column, not two: at a couple of hundred columns the extra
    // nesting is a measurable cost in layout and in assistive-tech tree walks.
    return el(
      "div",
      {
        class: `curve-col${isHere ? " curve-col--here" : ""}`,
        attrs: {
          // The tint is a color cue and nothing else, so it says which column is
          // the reader's here too — a hover title reaches a keyboard and a
          // screen reader where a background colour does not.
          title: `${isHere ? "You are about here: " : ""}${currency(locale, p.income)} earned → ${currency(locale, p.resources)} in hand${p.marker ? ` · ${p.marker}` : ""}`,
        },
      },
      bar,
      p.marker
        ? el("span", { class: "curve-marker", attrs: { "aria-hidden": "true" }, text: "!" })
        : null,
    );
  });

  const first = points[0];
  const last = points[points.length - 1];
  const axis = el(
    "div",
    { class: "curve-axis", attrs: { "aria-hidden": "true" } },
    el("span", { text: first ? currency(locale, first.income) : "" }),
    el("span", { text: last ? currency(locale, last.income) : "" }),
  );

  // The chart is one `role="img"`, so its label is the whole of what a screen
  // reader gets. A tinted column it never mentions is a cue only sighted
  // readers receive.
  const hereLabel =
    here >= 0 ? ` Your current income, ${currency(locale, points[here]!.income)}, is marked.` : "";

  return el(
    "figure",
    {
      class: "chart chart--curve",
      attrs: { role: "img", "aria-label": `${opts.ariaLabel}${hereLabel}` },
    },
    el("div", { class: "curve-plot" }, ...cols),
    axis,
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
