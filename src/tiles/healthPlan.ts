/**
 * Health Plan Chooser tile (BUILD-SPEC-2 §6.4): compare two plans deterministically
 * for an expected year of medical spend. Each plan's all-in cost is premiums plus
 * out-of-pocket on claims (the deductible, then coinsurance, capped at the
 * out-of-pocket maximum). The lower total wins. A note flags the HSA tradeoff for
 * high-deductible plans. All figures are the user's own — nothing to cite.
 */
import { Money } from "../engine/money";
import { healthPlanAnnualCost } from "../engine/finance";
import { el } from "../ui/dom";
import { field, parseNonNegative, parseNumber, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import type { TileContext, TileDefinition } from "./types";

interface PlanFields {
  name: string;
  premium: number;
  deductible: number;
  coinsurancePct: number;
  oopMax: number;
}

interface Fields {
  expectedSpend: number;
  a: PlanFields;
  b: PlanFields;
}

const EXAMPLE: Fields = {
  expectedSpend: 8000,
  a: { name: "PPO", premium: 450, deductible: 1500, coinsurancePct: 20, oopMax: 5000 },
  b: { name: "HDHP", premium: 250, deductible: 4000, coinsurancePct: 20, oopMax: 7000 },
};

function readPlan(p: URLSearchParams, k: "a" | "b", fallback: PlanFields): PlanFields {
  return {
    name: p.get(`${k}n`) ?? fallback.name,
    premium: parseNonNegative(p.get(`${k}p`), fallback.premium),
    deductible: parseNonNegative(p.get(`${k}d`), fallback.deductible),
    coinsurancePct: parseNumber(p.get(`${k}c`), fallback.coinsurancePct),
    oopMax: parseNonNegative(p.get(`${k}o`), fallback.oopMax),
  };
}

function readFields(p: URLSearchParams): Fields {
  return {
    expectedSpend: parseNonNegative(p.get("spend"), 0),
    a: readPlan(p, "a", EXAMPLE.a),
    b: readPlan(p, "b", EXAMPLE.b),
  };
}

function writePlan(p: URLSearchParams, k: "a" | "b", plan: PlanFields): void {
  p.set(`${k}n`, plan.name);
  p.set(`${k}p`, String(plan.premium));
  p.set(`${k}d`, String(plan.deductible));
  p.set(`${k}c`, String(plan.coinsurancePct));
  p.set(`${k}o`, String(plan.oopMax));
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("spend", String(f.expectedSpend));
  writePlan(p, "a", f.a);
  writePlan(p, "b", f.b);
  return p;
}

export function mountHealthPlan(ctx: TileContext): void {
  const { root } = ctx;
  root.replaceChildren();
  let fields = readFields(ctx.params);

  const spendInput = el("input", {
    type: "number",
    name: "spend",
    min: 0,
    step: 500,
    value: fields.expectedSpend,
    attrs: { "aria-label": "Expected annual medical spend", inputmode: "decimal" },
  });

  function planInputs(
    k: "a" | "b",
    plan: PlanFields,
  ): {
    fieldset: HTMLElement;
    read: () => PlanFields;
    set: (p: PlanFields) => void;
  } {
    const nameI = el("input", {
      type: "text",
      name: `${k}n`,
      value: plan.name,
      attrs: { "aria-label": `Plan ${k.toUpperCase()} name` },
    });
    const mk = (suffix: string, label: string, value: number, step: number): HTMLInputElement =>
      el("input", {
        type: "number",
        name: `${k}${suffix}`,
        min: 0,
        step,
        value,
        attrs: { "aria-label": `${label} (plan ${k.toUpperCase()})`, inputmode: "decimal" },
      });
    const premiumI = mk("p", "Monthly premium", plan.premium, 25);
    const dedI = mk("d", "Deductible", plan.deductible, 250);
    const coinsI = mk("c", "Coinsurance percent", plan.coinsurancePct, 5);
    const oopI = mk("o", "Out-of-pocket maximum", plan.oopMax, 500);
    const fieldset = el(
      "div",
      { class: "local-addons" },
      el("p", { class: "field-group-label", text: `Plan ${k.toUpperCase()}` }),
      field("Name", nameI),
      field("Monthly premium", premiumI),
      field("Deductible", dedI),
      field("Coinsurance (%)", coinsI),
      field("Out-of-pocket max", oopI),
    );
    return {
      fieldset,
      read: () => ({
        name: nameI.value.trim() || `Plan ${k.toUpperCase()}`,
        premium: parseNonNegative(premiumI.value, 0),
        deductible: parseNonNegative(dedI.value, 0),
        coinsurancePct: parseNumber(coinsI.value, 0),
        oopMax: parseNonNegative(oopI.value, 0),
      }),
      set: (pl) => {
        nameI.value = pl.name;
        premiumI.value = String(pl.premium);
        dedI.value = String(pl.deductible);
        coinsI.value = String(pl.coinsurancePct);
        oopI.value = String(pl.oopMax);
      },
    };
  }

  const planA = planInputs("a", fields.a);
  const planB = planInputs("b", fields.b);

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function costOf(plan: PlanFields): ReturnType<typeof healthPlanAnnualCost> {
    return healthPlanAnnualCost({
      monthlyPremium: plan.premium,
      deductible: plan.deductible,
      coinsuranceRate: plan.coinsurancePct / 100,
      outOfPocketMax: plan.oopMax,
      expectedAnnualSpend: fields.expectedSpend,
    });
  }

  function compute(): void {
    const a = costOf(fields.a);
    const b = costOf(fields.b);
    const fmt = (m: Money): string => m.format(ctx.locale);
    const cheaper = a.totalAnnualCost.lessThanOrEqual(b.totalAnnualCost) ? fields.a : fields.b;
    const cheaperCost = a.totalAnnualCost.lessThanOrEqual(b.totalAnnualCost) ? a : b;
    const diff = a.totalAnnualCost.subtract(b.totalAnnualCost).abs();

    const verdict = diff.isZero()
      ? "Both plans cost about the same at this level of spending."
      : `${cheaper.name} is cheaper by ${fmt(diff)} at this level of spending.`;

    const lines: BreakdownLine[] = [
      { label: `${fields.a.name}: premiums`, value: fmt(a.annualPremium) },
      { label: `${fields.a.name}: out-of-pocket on care`, value: fmt(a.memberCost) },
      { label: `${fields.a.name}: total for the year`, value: fmt(a.totalAnnualCost) },
      { label: `${fields.b.name}: premiums`, value: fmt(b.annualPremium) },
      { label: `${fields.b.name}: out-of-pocket on care`, value: fmt(b.memberCost) },
      { label: `${fields.b.name}: total for the year`, value: fmt(b.totalAnnualCost) },
      { label: "Verdict", value: verdict, emphasis: true },
      {
        label: "HSA note",
        value:
          "A high-deductible plan may let you contribute to a triple-tax-advantaged HSA — worth weighing beyond the costs here.",
      },
    ];

    resultContainer.replaceChildren(
      resultCard({
        label: `Lower-cost plan: ${cheaper.name}`,
        value: cheaperCost.totalAnnualCost,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function recompute(): void {
    fields = {
      expectedSpend: parseNonNegative(spendInput.value, 0),
      a: planA.read(),
      b: planB.read(),
    };
    ctx.setParams(writeFields(fields));
    compute();
  }

  spendInput.addEventListener("input", recompute);
  for (const input of [
    ...planA.fieldset.querySelectorAll("input"),
    ...planB.fieldset.querySelectorAll("input"),
  ]) {
    input.addEventListener("input", recompute);
  }

  const tryExample = tryExampleButton(() => {
    fields = { expectedSpend: EXAMPLE.expectedSpend, a: { ...EXAMPLE.a }, b: { ...EXAMPLE.b } };
    spendInput.value = String(fields.expectedSpend);
    planA.set(fields.a);
    planB.set(fields.b);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Expected medical spend this year", spendInput),
    planA.fieldset,
    planB.fieldset,
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const healthPlanTile: TileDefinition = {
  id: "health-plan",
  title: "Health Plan Chooser",
  pillar: "take-home",
  description: "Compare two health plans for a year of expected care.",
  keywords: ["health plan", "open enrollment", "hdhp", "ppo", "deductible", "hsa", "insurance"],
  status: "ready",
  how: "For the medical spending you expect this year, each plan costs its premiums (monthly × 12) plus your share of the care: you pay in full up to the deductible, then the coinsurance percentage above it, with your total out-of-pocket on care capped at the out-of-pocket maximum. We total both plans and show which is cheaper at that level of spending.\n\nTry a low and a high spend year to see how the answer changes — a low-premium high-deductible plan often wins in a healthy year and loses in an expensive one. A high-deductible plan may also unlock a tax-advantaged HSA, which can tip the decision.",
  resources: [
    {
      label: "HealthCare.gov, choosing a plan",
      url: "https://www.healthcare.gov/choose-a-plan/comparing-plans/",
    },
    { label: "IRS, Health Savings Accounts", url: "https://www.irs.gov/publications/p969" },
  ],
  mount: mountHealthPlan,
};
