/**
 * Treasury I Bond tile (BUILD-SPEC.md §3.4: Treasury I-bond and savings bond
 * fixed and inflation rates). Values a Series I savings bond from the bundled
 * TreasuryDirect rate history: the fixed rate is locked at purchase and the
 * semiannual inflation rate rotates through each published period. Deterministic
 * and cited — we only value the bond through the last published period and never
 * forecast a future inflation rate (BUILD-SPEC.md §2.1).
 */
import { Money } from "../engine/money";
import { projectIBond, ratePeriods, type IBondProjection } from "../engine/savingsBond";
import { el, option } from "../ui/dom";
import { field, parseNonNegative, pct, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import type { TileContext, TileDefinition } from "./types";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "2024-05" -> "May 2024". Falls back to the raw period if it's unexpected. */
function periodLabel(period: string): string {
  const [year, month] = period.split("-");
  const idx = Number(month) - 1;
  return year && MONTHS[idx] ? `${MONTHS[idx]} ${year}` : period;
}

interface Fields {
  amount: number;
  period: string;
}

function readFields(p: URLSearchParams, periods: string[]): Fields {
  const earliest = periods[0]!;
  const raw = p.get("period");
  return {
    amount: parseNonNegative(p.get("amt"), 10000),
    period: raw && periods.includes(raw) ? raw : earliest,
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("amt", String(f.amount));
  p.set("period", f.period);
  return p;
}

export function mountSavingsBond(ctx: TileContext): void {
  const { root, data } = ctx;
  root.replaceChildren();
  const bonds = data?.treasuryBonds();
  if (!bonds) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "Treasury I-bond rate data is unavailable, verify before relying on any figure.",
      }),
    );
    return;
  }

  const periods = ratePeriods(bonds).map((r) => r.period);
  let fields = readFields(ctx.params, periods);

  const amtInput = el("input", {
    type: "number",
    name: "amt",
    min: 0,
    step: 1000,
    value: fields.amount,
    attrs: { "aria-label": "Purchase amount in dollars", inputmode: "decimal" },
  });
  const periodSelect = el(
    "select",
    { name: "period", attrs: { "aria-label": "Purchase month" } },
    ...periods.map((p) => option(p, periodLabel(p), p === fields.period)),
  );

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const result: IBondProjection | null = projectIBond(fields.amount, fields.period, bonds!);
    if (!result) return;
    const fmt = (m: Money): string => m.format(ctx.locale);
    const cite = bonds!.citation;
    const latestPeriod = periods[periods.length - 1]!;

    const lines: BreakdownLine[] = [
      { label: "Purchase amount", value: fmt(result.purchaseAmount) },
      {
        label: "Fixed rate (locked at purchase)",
        value: pct(result.fixedRate),
        citation: cite,
      },
      {
        label: `Current composite rate (${periodLabel(latestPeriod)})`,
        value: `${pct(result.latestCompositeRate)} annualized`,
        citation: cite,
      },
      {
        label: `Six-month periods held (through ${periodLabel(latestPeriod)})`,
        value: String(result.periodsHeld),
      },
      { label: "Interest earned", value: fmt(result.interestEarned), citation: cite },
      { label: "Value now", value: fmt(result.currentValue), emphasis: true },
    ];

    resultContainer.replaceChildren(
      resultCard({
        label: `A ${fmt(result.purchaseAmount)} I bond bought ${periodLabel(fields.period)}, valued ${periodLabel(latestPeriod)}`,
        value: result.currentValue,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function collect(): void {
    fields = {
      amount: parseNonNegative(amtInput.value, 0),
      period: periodSelect.value,
    };
  }

  function recompute(): void {
    collect();
    ctx.setParams(writeFields(fields));
    compute();
  }

  periodSelect.addEventListener("change", recompute);
  amtInput.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { amount: 10000, period: periods[0]! };
    amtInput.value = String(fields.amount);
    periodSelect.value = fields.period;
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Purchase amount ($)", amtInput),
    field("Purchase month", periodSelect),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const savingsBondTile: TileDefinition = {
  id: "savings-bond",
  title: "Treasury I Bond",
  pillar: "investing",
  description: "What a Series I savings bond earns and is worth.",
  keywords: ["i bond", "ibond", "savings bond", "series i", "treasury", "inflation bond", "tips"],
  status: "ready",
  how: "A Series I savings bond earns a composite rate that combines a fixed rate, set when you buy and locked for the life of the bond, with a semiannual inflation rate the Treasury resets every six months.\n\nThe composite (annualized) rate is fixed + (2 × the semiannual inflation rate) + (fixed × the semiannual inflation rate), floored at zero. We grow your purchase one six-month period at a time, applying half the composite rate each period, straight from the bundled TreasuryDirect rates.\n\nThis is a measured value through the last published rate period, never a forecast: we don't guess a future inflation rate. I bonds can't be cashed for the first 12 months, and cashing before 5 years gives up the last 3 months of interest. The interest is subject to federal income tax but exempt from state and local tax. Verify any figure on TreasuryDirect.",
  resources: [
    {
      label: "TreasuryDirect, I bonds",
      url: "https://www.treasurydirect.gov/savings-bonds/i-bonds/",
    },
    {
      label: "TreasuryDirect, I bond interest rates",
      url: "https://www.treasurydirect.gov/savings-bonds/i-bonds/i-bonds-interest-rates/",
    },
  ],
  mount: mountSavingsBond,
};
