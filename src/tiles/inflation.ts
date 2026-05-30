/**
 * CPI Inflation Adjuster tile (BUILD-SPEC.md §3.4): what an amount in one year is
 * worth in another year's dollars, computed straight from the bundled BLS CPI-U
 * annual averages. Deterministic and cited, never a forecast. The year pickers
 * are populated from the dataset, so we only offer years we actually have.
 */
import { Money } from "../engine/money";
import { adjustForInflation, availableYears } from "../engine/inflation";
import { el, option } from "../ui/dom";
import { field, parseNonNegative, pct, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import type { TileContext, TileDefinition } from "./types";

interface Fields {
  amount: number;
  fromYear: number;
  toYear: number;
}

function readFields(p: URLSearchParams, years: number[]): Fields {
  const latest = years[years.length - 1]!;
  const earliest = years[0]!;
  const clampYear = (raw: string | null, fallback: number): number => {
    const n = raw !== null ? Number(raw) : NaN;
    return Number.isFinite(n) && years.includes(n) ? n : fallback;
  };
  return {
    amount: parseNonNegative(p.get("amt"), 100),
    fromYear: clampYear(p.get("from"), Math.max(earliest, 2000)),
    toYear: clampYear(p.get("to"), latest),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("amt", String(f.amount));
  p.set("from", String(f.fromYear));
  p.set("to", String(f.toYear));
  return p;
}

export function mountInflation(ctx: TileContext): void {
  const { root, data } = ctx;
  root.replaceChildren();
  const cpi = data?.cpi();
  if (!cpi) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "Inflation (CPI) data is unavailable, verify before relying on any figure.",
      }),
    );
    return;
  }

  const years = availableYears(cpi);
  let fields = readFields(ctx.params, years);

  const amtInput = el("input", {
    type: "number",
    name: "amt",
    min: 0,
    step: 100,
    value: fields.amount,
    attrs: { "aria-label": "Amount in dollars", inputmode: "decimal" },
  });
  const yearOptions = (selected: number): HTMLOptionElement[] =>
    years.map((y) => option(String(y), String(y), y === selected));
  const fromSelect = el(
    "select",
    { name: "from", attrs: { "aria-label": "From year" } },
    ...yearOptions(fields.fromYear),
  );
  const toSelect = el(
    "select",
    { name: "to", attrs: { "aria-label": "To year" } },
    ...yearOptions(fields.toYear),
  );

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const result = adjustForInflation(fields.amount, fields.fromYear, fields.toYear, cpi!);
    if (!result) return;
    const fmt = (m: Money): string => m.format(ctx.locale);

    const lines: BreakdownLine[] = [
      {
        label: `Value in ${fields.fromYear}`,
        value: fmt(Money.from(fields.amount)),
      },
      {
        label: `Equivalent in ${fields.toYear} dollars`,
        value: fmt(result.adjusted),
        citation: cpi!.citation,
        emphasis: true,
      },
      {
        label: "Cumulative price change",
        value: pct(result.totalChange),
        citation: cpi!.citation,
      },
      {
        label: "Average annual inflation",
        value: pct(result.annualizedRate),
      },
    ];

    resultContainer.replaceChildren(
      resultCard({
        label: `$${fields.amount.toLocaleString(ctx.locale)} in ${fields.fromYear}, in ${fields.toYear} dollars`,
        value: result.adjusted,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function collect(): void {
    fields = {
      amount: parseNonNegative(amtInput.value, 0),
      fromYear: Number(fromSelect.value),
      toYear: Number(toSelect.value),
    };
  }

  function recompute(): void {
    collect();
    ctx.setParams(writeFields(fields));
    compute();
  }

  for (const c of [fromSelect, toSelect]) c.addEventListener("change", recompute);
  amtInput.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { amount: 100, fromYear: Math.max(years[0]!, 1990), toYear: years[years.length - 1]! };
    amtInput.value = String(fields.amount);
    fromSelect.value = String(fields.fromYear);
    toSelect.value = String(fields.toYear);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Amount ($)", amtInput),
    field("From year", fromSelect),
    field("To year", toSelect),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const inflationTile: TileDefinition = {
  id: "inflation",
  title: "CPI Inflation Adjuster",
  pillar: "investing",
  description: "What a past dollar is worth today, from BLS data.",
  keywords: ["inflation", "cpi", "purchasing power", "dollar value", "bls"],
  status: "ready",
  how: "We use the Consumer Price Index for All Urban Consumers (CPI-U) annual averages from the Bureau of Labor Statistics. The value of an amount from one year in another year's dollars is the amount times the ratio of the two years' index values.\n\nThis is a measured, historical figure, never a forecast. The average annual inflation is the constant rate that would compound from one year's prices to the other over the span between them. Only years present in the bundled BLS data are offered.",
  resources: [
    { label: "BLS, Consumer Price Index", url: "https://www.bls.gov/cpi/" },
    {
      label: "BLS CPI inflation calculator",
      url: "https://www.bls.gov/data/inflation_calculator.htm",
    },
  ],
  mount: mountInflation,
};
