/**
 * Life Insurance Needs tile (BUILD-SPEC-2 §6.6): a transparent, needs-based
 * estimate (the "DIME" method) — replace years of income, clear Debts and the
 * Mortgage, cover final expenses and future obligations (Education), then
 * subtract coverage already in force and liquid assets. Deterministic from your
 * inputs, and explicitly information, not advice. Income defaults from My Situation.
 */
import { Money } from "../engine/money";
import { lifeInsuranceNeed } from "../engine/finance";
import { el } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import { rememberShared } from "./profileSync";
import type { SituationStore } from "../profile/situation";
import type { TileContext, TileDefinition } from "./types";

interface Fields {
  annualIncome: number;
  yearsToReplace: number;
  debts: number;
  mortgageBalance: number;
  finalExpenses: number;
  futureObligations: number;
  existingCoverage: number;
  liquidAssets: number;
}

const EXAMPLE: Fields = {
  annualIncome: 80000,
  yearsToReplace: 10,
  debts: 20000,
  mortgageBalance: 250000,
  finalExpenses: 15000,
  futureObligations: 100000,
  existingCoverage: 100000,
  liquidAssets: 50000,
};

function readFields(p: URLSearchParams, profile: SituationStore): Fields {
  const debtsTotal = (profile.get("debts") ?? []).reduce((s, d) => s + d.balance, 0);
  return {
    annualIncome: p.has("inc")
      ? parseNonNegative(p.get("inc"), 0)
      : (profile.get("annualIncome") ?? 0),
    yearsToReplace: Math.max(0, Math.round(parseNonNegative(p.get("yrs"), 10))),
    debts: p.has("debt") ? parseNonNegative(p.get("debt"), 0) : debtsTotal,
    mortgageBalance: parseNonNegative(p.get("mort"), 0),
    finalExpenses: parseNonNegative(p.get("final"), 15000),
    futureObligations: parseNonNegative(p.get("edu"), 0),
    existingCoverage: parseNonNegative(p.get("cov"), 0),
    liquidAssets: p.has("assets")
      ? parseNonNegative(p.get("assets"), 0)
      : (profile.get("liquidSavings") ?? 0),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("inc", String(f.annualIncome));
  if (f.yearsToReplace !== 10) p.set("yrs", String(f.yearsToReplace));
  if (f.debts > 0) p.set("debt", String(f.debts));
  if (f.mortgageBalance > 0) p.set("mort", String(f.mortgageBalance));
  if (f.finalExpenses !== 15000) p.set("final", String(f.finalExpenses));
  if (f.futureObligations > 0) p.set("edu", String(f.futureObligations));
  if (f.existingCoverage > 0) p.set("cov", String(f.existingCoverage));
  if (f.liquidAssets > 0) p.set("assets", String(f.liquidAssets));
  return p;
}

export function mountLifeInsurance(ctx: TileContext): void {
  const { root, profile } = ctx;
  root.replaceChildren();
  let fields = readFields(ctx.params, profile);

  const mkNum = (name: string, label: string, value: number, step: number): HTMLInputElement =>
    el("input", {
      type: "number",
      name,
      min: 0,
      step,
      value,
      attrs: { "aria-label": label, inputmode: "decimal" },
    });
  const incInput = mkNum("inc", "Annual income to replace", fields.annualIncome, 1000);
  const yrsInput = mkNum("yrs", "Years to replace", fields.yearsToReplace, 1);
  const debtInput = mkNum("debt", "Non-mortgage debts", fields.debts, 1000);
  const mortInput = mkNum("mort", "Mortgage balance", fields.mortgageBalance, 1000);
  const finalInput = mkNum("final", "Final expenses", fields.finalExpenses, 1000);
  const eduInput = mkNum("edu", "Future obligations (education)", fields.futureObligations, 1000);
  const covInput = mkNum("cov", "Existing coverage", fields.existingCoverage, 1000);
  const assetsInput = mkNum("assets", "Liquid assets", fields.liquidAssets, 1000);

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const r = lifeInsuranceNeed({
      annualIncome: fields.annualIncome,
      yearsToReplace: fields.yearsToReplace,
      debts: fields.debts,
      mortgageBalance: fields.mortgageBalance,
      finalExpenses: fields.finalExpenses,
      futureObligations: fields.futureObligations,
      existingCoverage: fields.existingCoverage,
      liquidAssets: fields.liquidAssets,
    });
    const fmt = (m: Money): string => m.format(ctx.locale);

    const lines: BreakdownLine[] = [
      {
        label: `Income replacement (${fields.yearsToReplace} yr)`,
        value: fmt(r.incomeReplacement),
      },
      { label: "+ Non-mortgage debts", value: fmt(Money.from(fields.debts)) },
      { label: "+ Mortgage balance", value: fmt(Money.from(fields.mortgageBalance)) },
      { label: "+ Final expenses", value: fmt(Money.from(fields.finalExpenses)) },
      { label: "+ Future obligations", value: fmt(Money.from(fields.futureObligations)) },
      { label: "Total need", value: fmt(r.totalNeed) },
      { label: "− Existing coverage", value: fmt(Money.from(fields.existingCoverage)) },
      { label: "− Liquid assets", value: fmt(Money.from(fields.liquidAssets)) },
      { label: "Recommended new coverage", value: fmt(r.recommendedCoverage), emphasis: true },
    ];

    resultContainer.replaceChildren(
      resultCard({
        label: "Life insurance coverage to consider",
        value: r.recommendedCoverage,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function recompute(): void {
    fields = {
      annualIncome: parseNonNegative(incInput.value, 0),
      yearsToReplace: Math.max(0, Math.round(parseNonNegative(yrsInput.value, 10))),
      debts: parseNonNegative(debtInput.value, 0),
      mortgageBalance: parseNonNegative(mortInput.value, 0),
      finalExpenses: parseNonNegative(finalInput.value, 0),
      futureObligations: parseNonNegative(eduInput.value, 0),
      existingCoverage: parseNonNegative(covInput.value, 0),
      liquidAssets: parseNonNegative(assetsInput.value, 0),
    };
    ctx.setParams(writeFields(fields));
    rememberShared(profile, { annualIncome: fields.annualIncome });
    compute();
  }

  for (const i of [
    incInput,
    yrsInput,
    debtInput,
    mortInput,
    finalInput,
    eduInput,
    covInput,
    assetsInput,
  ]) {
    i.addEventListener("input", recompute);
  }

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    incInput.value = String(fields.annualIncome);
    yrsInput.value = String(fields.yearsToReplace);
    debtInput.value = String(fields.debts);
    mortInput.value = String(fields.mortgageBalance);
    finalInput.value = String(fields.finalExpenses);
    eduInput.value = String(fields.futureObligations);
    covInput.value = String(fields.existingCoverage);
    assetsInput.value = String(fields.liquidAssets);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Annual income to replace", incInput),
    field("Years to replace", yrsInput),
    field("Non-mortgage debts", debtInput),
    field("Mortgage balance", mortInput),
    field("Final expenses", finalInput),
    field("Future obligations (education)", eduInput),
    field("Existing life coverage", covInput),
    field("Liquid assets", assetsInput),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const lifeInsuranceTile: TileDefinition = {
  id: "life-insurance",
  title: "Life Insurance Needs",
  pillar: "protect",
  description: "A transparent, needs-based coverage estimate.",
  keywords: ["life insurance", "coverage", "dime", "needs", "protection", "term life"],
  status: "ready",
  how: "We use the transparent 'DIME' needs method: replace several years of your income for your dependents, clear your Debts and your Mortgage, and cover final expenses plus future obligations like a child's Education. That's the gross need. We then subtract the coverage you already have and your liquid assets to get the new coverage worth considering.\n\nIt's a starting estimate, not advice. Term life is usually the low-cost way to cover a need that fades as debts shrink and kids grow up. Verify specifics with a licensed agent or fee-only planner.",
  resources: [
    {
      label: "CFPB, life insurance basics",
      url: "https://www.consumerfinance.gov/ask-cfpb/what-is-life-insurance-en-1352/",
    },
    { label: "Investor.gov, insurance", url: "https://www.investor.gov/" },
  ],
  mount: mountLifeInsurance,
};
