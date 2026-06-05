/**
 * What Should I Charge? (BUILD-SPEC-2 §6.4). The rate trap of working for yourself:
 * people copy their old salary's hourly wage and quietly go broke, because that
 * number ignores self-employment taxes, business expenses, and the unpaid hours
 * (admin, marketing, invoicing) that aren't billable. This works backward from the
 * take-home you actually want to the rate you must bill, accounting for all three.
 * Pure arithmetic; the tax set-aside is a labeled assumption you can tune (use the
 * Quarterly Taxes tool for a precise figure).
 */
import { Money } from "../engine/money";
import { el } from "../ui/dom";
import { field, parseNonNegative, pct, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import type { TileContext, TileDefinition } from "./types";

const HOURS_PER_DAY = 8;

interface Fields {
  takeHome: number;
  billableHoursPerWeek: number;
  weeksPerYear: number;
  expenses: number;
  taxPct: number;
}

const EXAMPLE: Fields = {
  takeHome: 60000,
  billableHoursPerWeek: 25,
  weeksPerYear: 48,
  expenses: 6000,
  taxPct: 28,
};

function readFields(p: URLSearchParams): Fields {
  return {
    takeHome: parseNonNegative(p.get("th"), 0),
    billableHoursPerWeek: parseNonNegative(p.get("bh"), 25),
    weeksPerYear: Math.min(52, parseNonNegative(p.get("wk"), 48)),
    expenses: parseNonNegative(p.get("ex"), 0),
    taxPct: Math.min(90, parseNonNegative(p.get("tx"), 28)),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("th", String(f.takeHome));
  p.set("bh", String(f.billableHoursPerWeek));
  p.set("wk", String(f.weeksPerYear));
  if (f.expenses > 0) p.set("ex", String(f.expenses));
  if (f.taxPct !== 28) p.set("tx", String(f.taxPct));
  return p;
}

export function mountFreelanceRate(ctx: TileContext): void {
  const { root } = ctx;
  root.replaceChildren();
  let fields = readFields(ctx.params);

  const mkNum = (
    name: string,
    label: string,
    value: number,
    step: number,
    max?: number,
  ): HTMLInputElement =>
    el("input", {
      type: "number",
      name,
      min: 0,
      max,
      step,
      value,
      attrs: { "aria-label": label, inputmode: "decimal" },
    });
  const thInput = mkNum("th", "Take-home you want for the year", fields.takeHome, 1000);
  const bhInput = mkNum("bh", "Billable hours per week", fields.billableHoursPerWeek, 1);
  const wkInput = mkNum("wk", "Weeks worked per year", fields.weeksPerYear, 1, 52);
  const exInput = mkNum("ex", "Annual business expenses", fields.expenses, 500);
  const txInput = mkNum("tx", "Tax set-aside percent", fields.taxPct, 1, 90);

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const taxRate = Math.min(0.9, fields.taxPct / 100);
    // Take-home is what's left after tax; gross it up to the pre-tax profit needed.
    const profitNeeded = taxRate < 1 ? fields.takeHome / (1 - taxRate) : 0;
    const revenueNeeded = profitNeeded + fields.expenses;
    const billableHours = fields.billableHoursPerWeek * fields.weeksPerYear;
    const hourly = billableHours > 0 ? revenueNeeded / billableHours : 0;
    const fmt = (m: Money): string => m.format(ctx.locale);

    const lines: BreakdownLine[] = [
      { label: "Take-home you want", value: fmt(Money.from(fields.takeHome)) },
      {
        label: `Pre-tax profit needed (after a ${pct(taxRate, 0)} set-aside)`,
        value: fmt(Money.from(profitNeeded)),
      },
      { label: "Business expenses", value: fmt(Money.from(fields.expenses)) },
      { label: "Revenue you must bill for the year", value: fmt(Money.from(revenueNeeded)) },
      {
        label: "Billable hours per year",
        // toLocaleString renders Infinity as "∞"; guard it like the money fields.
        value: `${Number.isFinite(billableHours) ? billableHours.toLocaleString(ctx.locale) : "(out of range)"} (${fields.billableHoursPerWeek}/wk × ${fields.weeksPerYear} wks)`,
      },
      { label: "Rate to bill per hour", value: fmt(Money.from(hourly)), emphasis: true },
      { label: "Day rate (8 hours)", value: fmt(Money.from(hourly * HOURS_PER_DAY)) },
      {
        label: "Remember",
        value:
          "Billable hours are only the hours you can invoice. Admin, marketing, and downtime aren't billable, so set billable hours well below the hours you actually work.",
      },
    ];

    resultContainer.replaceChildren(
      resultCard({
        label: "Bill at least this per hour",
        value: Money.from(hourly),
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function recompute(): void {
    fields = {
      takeHome: parseNonNegative(thInput.value, 0),
      billableHoursPerWeek: parseNonNegative(bhInput.value, 25),
      weeksPerYear: Math.min(52, parseNonNegative(wkInput.value, 48)),
      expenses: parseNonNegative(exInput.value, 0),
      taxPct: Math.min(90, parseNonNegative(txInput.value, 28)),
    };
    if (Number(wkInput.value) !== fields.weeksPerYear) wkInput.value = String(fields.weeksPerYear);
    if (Number(txInput.value) !== fields.taxPct) txInput.value = String(fields.taxPct);
    ctx.setParams(writeFields(fields));
    compute();
  }

  for (const i of [thInput, bhInput, wkInput, exInput, txInput])
    i.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    thInput.value = String(fields.takeHome);
    bhInput.value = String(fields.billableHoursPerWeek);
    wkInput.value = String(fields.weeksPerYear);
    exInput.value = String(fields.expenses);
    txInput.value = String(fields.taxPct);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Take-home you want for the year", thInput),
    field("Billable hours per week", bhInput),
    field("Weeks worked per year", wkInput),
    field("Annual business expenses", exInput),
    field("Tax set-aside (%)", txInput),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const freelanceRateTile: TileDefinition = {
  id: "freelance-rate",
  title: "What Should I Charge?",
  pillar: "paycheck",
  description: "Work backward from the take-home you want to the hourly rate to bill.",
  keywords: [
    "self employed",
    "1099",
    "freelance",
    "contractor",
    "gig",
    "hourly rate",
    "what to charge",
    "pricing",
    "day rate",
  ],
  status: "ready",
  how: "A salaried worker's hourly wage is a terrible guide for what to charge on your own, because as a freelancer you also pay self-employment tax, cover your own business expenses, and can only bill a fraction of the hours you work. So we go the other way: start from the take-home you want for the year, gross it up by your tax set-aside to find the pre-tax profit you need, add your business expenses to get the revenue you must bill, and divide by your billable hours.\n\nThe key honesty is in 'billable hours.' If you work 40 hours but only 25 are billable client work, your rate has to cover the other 15 (admin, marketing, invoicing, downtime) too. Enter the hours you can actually invoice, not the hours you sit at your desk.\n\nThe tax set-aside is a labeled assumption you can tune; for a precise figure use the Quarterly Taxes & Set-Aside tool, which computes your real self-employment plus income tax.",
  resources: [
    {
      label: "SBA, pricing your products & services",
      url: "https://www.sba.gov/business-guide/manage-your-business/pricing-your-products-services",
    },
  ],
  mount: mountFreelanceRate,
};
