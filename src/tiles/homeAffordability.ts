/**
 * Home Buying Readiness tile (BUILD-SPEC-2 §6.3). How much house you can afford,
 * all-in, using the conventional 28/36 debt-to-income guideline: housing ≤ 28%
 * of gross monthly income, and total debt ≤ 36%. The binding budget, minus the
 * taxes-and-insurance you enter, is the payment that backs out a maximum loan
 * (the engine's loanPrincipalFromPayment) and thus a maximum home price. The
 * 28/36 rule is a lending guideline, shown as a labeled assumption, not cited.
 */
import { Money } from "../engine/money";
import { loanPrincipalFromPayment } from "../engine/finance";
import { el } from "../ui/dom";
import { field, parseNonNegative, parseNumber, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import { rememberShared } from "./profileSync";
import type { SituationStore } from "../profile/situation";
import type { TileContext, TileDefinition } from "./types";

const HOUSING_RATIO = 0.28;
const TOTAL_DEBT_RATIO = 0.36;

interface Fields {
  annualIncome: number;
  monthlyDebts: number;
  downPayment: number;
  ratePct: number;
  termYears: number;
  monthlyTaxesInsurance: number;
}

const EXAMPLE: Fields = {
  annualIncome: 90000,
  monthlyDebts: 400,
  downPayment: 40000,
  ratePct: 6.5,
  termYears: 30,
  monthlyTaxesInsurance: 350,
};

function readFields(p: URLSearchParams, profile: SituationStore): Fields {
  return {
    annualIncome: p.has("inc")
      ? parseNonNegative(p.get("inc"), 0)
      : (profile.get("annualIncome") ?? 0),
    monthlyDebts: parseNonNegative(p.get("debts"), 0),
    downPayment: parseNonNegative(p.get("dp"), 0),
    ratePct: parseNumber(p.get("rate"), 6.5),
    termYears: Math.max(1, parseNonNegative(p.get("term"), 30)),
    monthlyTaxesInsurance: parseNonNegative(p.get("ti"), 0),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("inc", String(f.annualIncome));
  if (f.monthlyDebts > 0) p.set("debts", String(f.monthlyDebts));
  p.set("dp", String(f.downPayment));
  p.set("rate", String(f.ratePct));
  if (f.termYears !== 30) p.set("term", String(f.termYears));
  if (f.monthlyTaxesInsurance > 0) p.set("ti", String(f.monthlyTaxesInsurance));
  return p;
}

interface Affordability {
  grossMonthly: number;
  maxHousing: number;
  maxTotalLessDebts: number;
  housingBudget: number;
  binding: "28% housing" | "36% total debt";
  maxMonthlyPI: number;
  maxLoan: Money;
  maxPrice: Money;
}

function affordability(f: Fields): Affordability {
  const grossMonthly = f.annualIncome / 12;
  const maxHousing = grossMonthly * HOUSING_RATIO;
  const maxTotalLessDebts = grossMonthly * TOTAL_DEBT_RATIO - f.monthlyDebts;
  const housingBudget = Math.max(0, Math.min(maxHousing, maxTotalLessDebts));
  const binding = maxTotalLessDebts < maxHousing ? "36% total debt" : "28% housing";
  const maxMonthlyPI = Math.max(0, housingBudget - f.monthlyTaxesInsurance);
  const maxLoan = loanPrincipalFromPayment(maxMonthlyPI, f.ratePct, f.termYears);
  const maxPrice = maxLoan.add(f.downPayment);
  return {
    grossMonthly,
    maxHousing,
    maxTotalLessDebts,
    housingBudget,
    binding,
    maxMonthlyPI,
    maxLoan,
    maxPrice,
  };
}

export function mountHomeAffordability(ctx: TileContext): void {
  const { root, profile } = ctx;
  root.replaceChildren();
  let fields = readFields(ctx.params, profile);

  const incInput = el("input", {
    type: "number",
    name: "inc",
    min: 0,
    step: 1000,
    value: fields.annualIncome,
    attrs: { "aria-label": "Annual gross income", inputmode: "decimal" },
  });
  const debtsInput = el("input", {
    type: "number",
    name: "debts",
    min: 0,
    step: 50,
    value: fields.monthlyDebts,
    attrs: { "aria-label": "Other monthly debt payments", inputmode: "decimal" },
  });
  const dpInput = el("input", {
    type: "number",
    name: "dp",
    min: 0,
    step: 1000,
    value: fields.downPayment,
    attrs: { "aria-label": "Down payment", inputmode: "decimal" },
  });
  const rateInput = el("input", {
    type: "number",
    name: "rate",
    min: 0,
    step: 0.125,
    value: fields.ratePct,
    attrs: { "aria-label": "Mortgage interest rate (percent)", inputmode: "decimal" },
  });
  const termInput = el("input", {
    type: "number",
    name: "term",
    min: 1,
    step: 1,
    value: fields.termYears,
    attrs: { "aria-label": "Loan term in years", inputmode: "decimal" },
  });
  const tiInput = el("input", {
    type: "number",
    name: "ti",
    min: 0,
    step: 25,
    value: fields.monthlyTaxesInsurance,
    attrs: { "aria-label": "Monthly property tax, insurance, and HOA", inputmode: "decimal" },
  });

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const a = affordability(fields);
    const fmt = (m: Money): string => m.format(ctx.locale);
    const dollars = (n: number): string => Money.from(n).format(ctx.locale);

    const lines: BreakdownLine[] = [
      { label: "Gross monthly income", value: dollars(a.grossMonthly) },
      { label: "Max housing (28% rule)", value: dollars(a.maxHousing) },
      { label: "Max total debt (36% rule), less your debts", value: dollars(a.maxTotalLessDebts) },
      { label: `Monthly housing budget (${a.binding} binds)`, value: dollars(a.housingBudget) },
      { label: "− taxes, insurance & HOA", value: dollars(fields.monthlyTaxesInsurance) },
      { label: "Max principal + interest payment", value: dollars(a.maxMonthlyPI) },
      { label: "Supports a loan of", value: fmt(a.maxLoan) },
      { label: "+ your down payment", value: dollars(fields.downPayment) },
      { label: "Max home price", value: fmt(a.maxPrice), emphasis: true },
      { label: "Guideline", value: "28/36 is a common lending rule of thumb, lenders vary." },
    ];

    resultContainer.replaceChildren(
      resultCard({
        label: "Home you can afford, all-in",
        value: a.maxPrice,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function collect(): void {
    fields = {
      annualIncome: parseNonNegative(incInput.value, 0),
      monthlyDebts: parseNonNegative(debtsInput.value, 0),
      downPayment: parseNonNegative(dpInput.value, 0),
      ratePct: parseNumber(rateInput.value, 6.5),
      termYears: Math.max(1, parseNonNegative(termInput.value, 30)),
      monthlyTaxesInsurance: parseNonNegative(tiInput.value, 0),
    };
  }

  function recompute(): void {
    collect();
    ctx.setParams(writeFields(fields));
    rememberShared(ctx.profile, { annualIncome: fields.annualIncome });
    compute();
  }

  for (const i of [incInput, debtsInput, dpInput, rateInput, termInput, tiInput]) {
    i.addEventListener("input", recompute);
  }

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    incInput.value = String(fields.annualIncome);
    debtsInput.value = String(fields.monthlyDebts);
    dpInput.value = String(fields.downPayment);
    rateInput.value = String(fields.ratePct);
    termInput.value = String(fields.termYears);
    tiInput.value = String(fields.monthlyTaxesInsurance);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Annual gross income", incInput),
    field("Other monthly debt payments", debtsInput),
    field("Down payment", dpInput),
    field("Mortgage rate (%)", rateInput),
    field("Term (years)", termInput),
    field("Monthly taxes, insurance & HOA", tiInput),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const homeAffordabilityTile: TileDefinition = {
  id: "home-affordability",
  title: "Home Buying Readiness",
  pillar: "protect",
  description: "How much house you can afford, all-in, on the 28/36 rule.",
  keywords: ["home", "house", "mortgage affordability", "28/36", "down payment", "buying"],
  status: "ready",
  how: "Lenders commonly cap housing at 28% of your gross monthly income and total debt (housing plus other payments) at 36%, the '28/36 rule'. We take the smaller of those two budgets, subtract the monthly taxes, insurance, and HOA you enter, and the remainder is the principal-and-interest payment you can support.\n\nFrom that payment, your rate, and the term, we back out the largest mortgage (the present value of those payments) and add your down payment to get a maximum home price. Lenders vary, so treat it as a starting point.",
  resources: [
    { label: "CFPB, buying a house", url: "https://www.consumerfinance.gov/owning-a-home/" },
    { label: "HUD, buying a home", url: "https://www.hud.gov/buying" },
  ],
  mount: mountHomeAffordability,
};
