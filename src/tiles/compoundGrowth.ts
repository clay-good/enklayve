/**
 * Compound Growth tile (BUILD-SPEC.md §3.4). Deterministic time-value-of-money:
 * the user supplies the rate of return as a clearly labeled assumption (we never
 * predict markets, §2.1), and we show the resulting math exactly. There is no
 * external rule to cite here — the inputs are the user's own assumptions — so
 * the tile labels the assumption instead of linking a source.
 */
import { Money } from "../engine/money";
import { compoundGrowth } from "../engine/finance";
import { el, option } from "../ui/dom";
import { field, parseNonNegative, parseNumber, pct, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import type { TileContext, TileDefinition } from "./types";

const FREQUENCIES: { value: string; label: string; perYear: number }[] = [
  { value: "monthly", label: "Monthly", perYear: 12 },
  { value: "annually", label: "Annually", perYear: 1 },
];

interface Fields {
  principal: number;
  contribution: number;
  /** Annual rate as a percentage, e.g. 6 for 6%. */
  ratePct: number;
  years: number;
  freq: string;
}

const EXAMPLE: Fields = {
  principal: 10000,
  contribution: 500,
  ratePct: 6,
  years: 30,
  freq: "monthly",
};

function perYearOf(freq: string): number {
  return FREQUENCIES.find((f) => f.value === freq)?.perYear ?? 12;
}

function readFields(p: URLSearchParams): Fields {
  const freq = p.get("freq");
  return {
    principal: parseNonNegative(p.get("p"), 0),
    contribution: parseNonNegative(p.get("c"), 0),
    ratePct: parseNumber(p.get("r"), 6),
    years: Math.max(0, parseNonNegative(p.get("y"), 0)),
    freq: freq && FREQUENCIES.some((f) => f.value === freq) ? freq : "monthly",
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("p", String(f.principal));
  p.set("c", String(f.contribution));
  p.set("r", String(f.ratePct));
  p.set("y", String(f.years));
  if (f.freq !== "monthly") p.set("freq", f.freq);
  return p;
}

export function mountCompoundGrowth(ctx: TileContext): void {
  const { root } = ctx;
  root.replaceChildren();
  let fields = readFields(ctx.params);

  const pInput = el("input", {
    type: "number",
    name: "p",
    min: 0,
    step: 1000,
    value: fields.principal,
    attrs: { "aria-label": "Starting balance", inputmode: "decimal" },
  });
  const cInput = el("input", {
    type: "number",
    name: "c",
    min: 0,
    step: 50,
    value: fields.contribution,
    attrs: { "aria-label": "Contribution each period", inputmode: "decimal" },
  });
  const freqSelect = el(
    "select",
    { name: "freq", attrs: { "aria-label": "Contribution frequency" } },
    ...FREQUENCIES.map((f) => option(f.value, f.label, f.value === fields.freq)),
  );
  const rInput = el("input", {
    type: "number",
    name: "r",
    step: 0.25,
    value: fields.ratePct,
    attrs: { "aria-label": "Assumed annual return rate (percent)", inputmode: "decimal" },
  });
  const yInput = el("input", {
    type: "number",
    name: "y",
    min: 0,
    step: 1,
    value: fields.years,
    attrs: { "aria-label": "Years", inputmode: "decimal" },
  });

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const perYear = perYearOf(fields.freq);
    const result = compoundGrowth({
      principal: fields.principal,
      contribution: fields.contribution,
      annualRate: fields.ratePct / 100,
      years: fields.years,
      periodsPerYear: perYear,
    });
    const fmt = (m: Money): string => m.format(ctx.locale);

    const lines: BreakdownLine[] = [
      { label: "Total contributed", value: fmt(result.totalContributed) },
      { label: "Growth", value: fmt(result.totalGrowth) },
      {
        label: "Assumed annual return",
        value: `${pct(fields.ratePct / 100)} (your assumption)`,
      },
      { label: "Future value", value: fmt(result.futureValue), emphasis: true },
    ];

    resultContainer.replaceChildren(
      resultCard({
        label: `Projected balance in ${fields.years} year${fields.years === 1 ? "" : "s"}`,
        value: result.futureValue,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function collect(): void {
    fields = {
      principal: parseNonNegative(pInput.value, 0),
      contribution: parseNonNegative(cInput.value, 0),
      ratePct: parseNumber(rInput.value, 6),
      years: Math.max(0, parseNonNegative(yInput.value, 0)),
      freq: freqSelect.value,
    };
  }

  function recompute(): void {
    collect();
    ctx.setParams(writeFields(fields));
    compute();
  }

  freqSelect.addEventListener("change", recompute);
  for (const i of [pInput, cInput, rInput, yInput]) i.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    pInput.value = String(fields.principal);
    cInput.value = String(fields.contribution);
    rInput.value = String(fields.ratePct);
    yInput.value = String(fields.years);
    freqSelect.value = fields.freq;
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Starting balance", pInput),
    field("Contribution", cInput),
    field("Frequency", freqSelect),
    field("Assumed annual return (%)", rInput),
    field("Years", yInput),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const compoundGrowthTile: TileDefinition = {
  id: "compound-growth",
  title: "Compound Growth",
  pillar: "take-home",
  description: "Contribution growth at a rate you choose.",
  keywords: ["compound", "interest", "growth", "savings", "investment", "future value"],
  status: "ready",
  how: "Future value = your starting balance grown at the rate you choose, plus each contribution grown for the periods it has left to compound. We compound every period exactly (no rounding drift).\n\nThe rate of return is your assumption, clearly labeled — never a prediction. We don't guess markets; change the rate to see optimistic and conservative cases.",
  resources: [
    {
      label: "Investor.gov — compound interest calculator",
      url: "https://www.investor.gov/financial-tools-calculators/calculators/compound-interest-calculator",
    },
    { label: "CFPB — saving & investing", url: "https://www.consumerfinance.gov/consumer-tools/" },
  ],
  mount: mountCompoundGrowth,
};
