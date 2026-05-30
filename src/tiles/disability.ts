/**
 * Disability Insurance Needs tile (BUILD-SPEC-2 §6.6): the monthly income gap if
 * you couldn't work. Pick a share of income to replace (a labeled guideline,
 * often ~60% for group long-term disability), then subtract the coverage and
 * other income you'd still have. Deterministic from your inputs — information,
 * not advice, and no external rule to cite. Income defaults from My Situation.
 */
import { Money } from "../engine/money";
import { disabilityCoverageNeed } from "../engine/finance";
import { el } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import { rememberShared } from "./profileSync";
import type { SituationStore } from "../profile/situation";
import type { TileContext, TileDefinition } from "./types";

interface Fields {
  annualIncome: number;
  replacementRatePct: number;
  existingMonthlyBenefit: number;
  otherMonthlyIncome: number;
}

const EXAMPLE: Fields = {
  annualIncome: 90000,
  replacementRatePct: 60,
  existingMonthlyBenefit: 2000,
  otherMonthlyIncome: 500,
};

function readFields(p: URLSearchParams, profile: SituationStore): Fields {
  return {
    annualIncome: p.has("inc")
      ? parseNonNegative(p.get("inc"), 0)
      : (profile.get("annualIncome") ?? 0),
    replacementRatePct: parseNonNegative(p.get("r"), 60),
    existingMonthlyBenefit: parseNonNegative(p.get("cov"), 0),
    otherMonthlyIncome: parseNonNegative(p.get("oth"), 0),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("inc", String(f.annualIncome));
  if (f.replacementRatePct !== 60) p.set("r", String(f.replacementRatePct));
  if (f.existingMonthlyBenefit > 0) p.set("cov", String(f.existingMonthlyBenefit));
  if (f.otherMonthlyIncome > 0) p.set("oth", String(f.otherMonthlyIncome));
  return p;
}

export function mountDisability(ctx: TileContext): void {
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
  const incInput = mkNum("inc", "Annual income", fields.annualIncome, 1000);
  const rInput = mkNum("r", "Replacement rate (percent)", fields.replacementRatePct, 5);
  const covInput = mkNum("cov", "Existing monthly benefit", fields.existingMonthlyBenefit, 100);
  const othInput = mkNum("oth", "Other monthly income", fields.otherMonthlyIncome, 100);

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const r = disabilityCoverageNeed({
      annualIncome: fields.annualIncome,
      replacementRatePct: fields.replacementRatePct,
      existingMonthlyBenefit: fields.existingMonthlyBenefit,
      otherMonthlyIncome: fields.otherMonthlyIncome,
    });
    const fmt = (m: Money): string => m.format(ctx.locale);

    const lines: BreakdownLine[] = [
      {
        label: `Income to replace (${fields.replacementRatePct}%)`,
        value: `${fmt(r.targetMonthly)}/mo`,
      },
      { label: "Already covered", value: `${fmt(r.coveredMonthly)}/mo` },
      { label: "Monthly coverage gap", value: `${fmt(r.monthlyGap)}/mo`, emphasis: true },
      { label: "Annual coverage gap", value: fmt(r.annualGap) },
      {
        label: "About the rate",
        value:
          "Group long-term disability often replaces about 60% of pay, and benefits from a policy you pay for yourself are usually tax-free. The rate is yours to change.",
      },
    ];

    resultContainer.replaceChildren(
      resultCard({
        label: "Monthly disability coverage gap",
        value: r.monthlyGap,
        locale: ctx.locale,
        breakdown: lines,
        copyText: `${fmt(r.monthlyGap)}/mo`,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function recompute(): void {
    fields = {
      annualIncome: parseNonNegative(incInput.value, 0),
      replacementRatePct: parseNonNegative(rInput.value, 60),
      existingMonthlyBenefit: parseNonNegative(covInput.value, 0),
      otherMonthlyIncome: parseNonNegative(othInput.value, 0),
    };
    ctx.setParams(writeFields(fields));
    rememberShared(profile, { annualIncome: fields.annualIncome });
    compute();
  }

  for (const i of [incInput, rInput, covInput, othInput]) i.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    incInput.value = String(fields.annualIncome);
    rInput.value = String(fields.replacementRatePct);
    covInput.value = String(fields.existingMonthlyBenefit);
    othInput.value = String(fields.otherMonthlyIncome);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Annual income", incInput),
    field("Share of income to replace (%)", rInput),
    field("Existing monthly benefit", covInput),
    field("Other monthly income", othInput),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const disabilityTile: TileDefinition = {
  id: "disability-insurance",
  title: "Disability Insurance Needs",
  pillar: "protect",
  description: "The monthly income gap if you couldn't work.",
  keywords: [
    "disability",
    "insurance",
    "income protection",
    "long-term disability",
    "ltd",
    "protection",
  ],
  status: "ready",
  how: "A disability is more likely than an early death during your working years, and it threatens the same thing — your income. This sizes the gap: pick the share of pay you'd want to replace (group long-term disability commonly covers around 60%, and benefits you pay for yourself are usually tax-free), then subtract any coverage you already have and other income that would continue. What's left is the monthly benefit worth shopping for.\n\nIt's a starting estimate, not advice. Check your employer's plan first, then compare an individual policy for the gap. Definitions like 'own-occupation' coverage matter a lot — confirm specifics with a licensed agent.",
  resources: [
    {
      label: "CFPB, disability insurance basics",
      url: "https://www.consumerfinance.gov/",
    },
    { label: "SSA, disability benefits", url: "https://www.ssa.gov/disability/" },
  ],
  mount: mountDisability,
};
