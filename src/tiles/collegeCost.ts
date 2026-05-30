/**
 * College Cost Planner tile (BUILD-SPEC-2 §6.7): projects the future cost of
 * college at an assumed education-inflation rate and solves for the level
 * monthly amount to fund it by the start date, counting what's already saved.
 * Deterministic; the inflation and return rates are the user's clearly labeled
 * assumptions, never a forecast. Pairs with the FAFSA Student Aid Index estimator
 * (a later wave) for the aid side. Information, not advice.
 */
import { Money } from "../engine/money";
import { collegeCostPlan } from "../engine/finance";
import { el } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import type { TileContext, TileDefinition } from "./types";

interface Fields {
  annualCostToday: number;
  yearsUntilStart: number;
  yearsOfCollege: number;
  costInflationPct: number;
  currentSavings: number;
  expectedReturnPct: number;
}

const EXAMPLE: Fields = {
  annualCostToday: 28000,
  yearsUntilStart: 10,
  yearsOfCollege: 4,
  costInflationPct: 5,
  currentSavings: 10000,
  expectedReturnPct: 5,
};

function readFields(p: URLSearchParams): Fields {
  return {
    annualCostToday: parseNonNegative(p.get("cost"), 0),
    yearsUntilStart: Math.max(0, Math.round(parseNonNegative(p.get("yrs"), 10))),
    yearsOfCollege: Math.max(1, Math.round(parseNonNegative(p.get("dur"), 4))),
    costInflationPct: parseNonNegative(p.get("ci"), 5),
    currentSavings: parseNonNegative(p.get("c"), 0),
    expectedReturnPct: parseNonNegative(p.get("r"), 5),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("cost", String(f.annualCostToday));
  p.set("yrs", String(f.yearsUntilStart));
  if (f.yearsOfCollege !== 4) p.set("dur", String(f.yearsOfCollege));
  if (f.costInflationPct !== 5) p.set("ci", String(f.costInflationPct));
  if (f.currentSavings > 0) p.set("c", String(f.currentSavings));
  if (f.expectedReturnPct !== 5) p.set("r", String(f.expectedReturnPct));
  return p;
}

export function mountCollegeCost(ctx: TileContext): void {
  const { root } = ctx;
  root.replaceChildren();
  let fields = readFields(ctx.params);

  const mkNum = (name: string, label: string, value: number, step: number): HTMLInputElement =>
    el("input", {
      type: "number",
      name,
      min: 0,
      step,
      value,
      attrs: { "aria-label": label, inputmode: "decimal" },
    });
  const costInput = mkNum("cost", "Annual college cost today", fields.annualCostToday, 1000);
  const yrsInput = mkNum("yrs", "Years until college starts", fields.yearsUntilStart, 1);
  const durInput = mkNum("dur", "Years of college", fields.yearsOfCollege, 1);
  const ciInput = mkNum("ci", "College cost inflation (percent)", fields.costInflationPct, 0.5);
  const cInput = mkNum("c", "Already saved", fields.currentSavings, 1000);
  const rInput = mkNum("r", "Expected return (percent)", fields.expectedReturnPct, 0.5);

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    resultContainer.replaceChildren();
    if (fields.annualCostToday <= 0) {
      resultContainer.append(
        el("p", { class: "ph-empty", text: "Enter today's annual college cost to plan for it." }),
      );
      return;
    }
    const r = collegeCostPlan({
      annualCostToday: fields.annualCostToday,
      yearsUntilStart: fields.yearsUntilStart,
      yearsOfCollege: fields.yearsOfCollege,
      costInflationPct: fields.costInflationPct,
      currentSavings: fields.currentSavings,
      expectedReturnPct: fields.expectedReturnPct,
    });
    const fmt = (m: Money): string => m.format(ctx.locale);

    const lines: BreakdownLine[] = [
      {
        label: `Projected cost (${fields.yearsOfCollege} yr, in ${fields.yearsUntilStart} yr)`,
        value: fmt(r.projectedTotalCost),
      },
      { label: "Your savings grow to", value: fmt(r.projectedFromCurrent) },
      {
        label: "Where you stand",
        value: r.alreadyOnTrack
          ? "Your current savings are on track to cover the projected cost."
          : `Save ${fmt(r.monthlyContribution)}/mo to fully fund it by the start date.`,
        emphasis: true,
      },
      {
        label: "Assumptions",
        value: `${fields.costInflationPct}% college inflation, ${fields.expectedReturnPct}% return — both yours to change. Targets the full cost by freshman year.`,
      },
    ];

    resultContainer.append(
      resultCard({
        label: "Save each month for college",
        value: r.monthlyContribution,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function recompute(): void {
    fields = {
      annualCostToday: parseNonNegative(costInput.value, 0),
      yearsUntilStart: Math.max(0, Math.round(parseNonNegative(yrsInput.value, 10))),
      yearsOfCollege: Math.max(1, Math.round(parseNonNegative(durInput.value, 4))),
      costInflationPct: parseNonNegative(ciInput.value, 5),
      currentSavings: parseNonNegative(cInput.value, 0),
      expectedReturnPct: parseNonNegative(rInput.value, 5),
    };
    ctx.setParams(writeFields(fields));
    compute();
  }

  for (const i of [costInput, yrsInput, durInput, ciInput, cInput, rInput])
    i.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    costInput.value = String(fields.annualCostToday);
    yrsInput.value = String(fields.yearsUntilStart);
    durInput.value = String(fields.yearsOfCollege);
    ciInput.value = String(fields.costInflationPct);
    cInput.value = String(fields.currentSavings);
    rInput.value = String(fields.expectedReturnPct);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Annual college cost today", costInput),
    field("Years until college starts", yrsInput),
    field("Years of college", durInput),
    field("College cost inflation (%)", ciInput),
    field("Already saved", cInput),
    field("Expected return (%)", rInput),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const collegeCostTile: TileDefinition = {
  id: "college-cost",
  title: "College Cost Planner",
  pillar: "protect",
  description: "Project college costs and the monthly savings to fund them.",
  keywords: ["college", "529", "education", "tuition", "savings", "cost"],
  status: "ready",
  how: "College costs tend to rise faster than general inflation, so a price today understates the bill years from now. This grows each future year of college at the inflation rate you choose, adds them up, and solves for the level monthly amount that would fully fund the total by the time college starts — counting what you've already saved and an assumed return on it.\n\nThe inflation and return rates are your assumptions, shown so you can change them; we never forecast markets. To keep it simple and a touch conservative, it targets having the whole cost saved by freshman year, though in reality you draw it down across the college years. Pair it with the FAFSA Student Aid Index estimator (coming in a later wave) to weigh grants and aid against the sticker price.",
  resources: [
    { label: "Federal Student Aid", url: "https://studentaid.gov/" },
    {
      label: "SEC, saving for college (529 plans)",
      url: "https://www.investor.gov/introduction-investing/investing-basics/investment-products/529-plans",
    },
  ],
  mount: mountCollegeCost,
};
