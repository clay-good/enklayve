/**
 * Sinking Fund Planner tile (BUILD-SPEC-2 §6.3): save for a named goal by a
 * date. We solve for the level monthly contribution that reaches your target,
 * counting what you've already saved and an assumed return (a clearly-labeled
 * assumption, never a forecast). This is the "sinking funds" step of My Plan,
 * made concrete for one goal at a time.
 */
import { Money } from "../engine/money";
import { requiredMonthlyContribution } from "../engine/finance";
import { el } from "../ui/dom";
import { field, parseNonNegative, parseNumber, pct, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import type { TileContext, TileDefinition } from "./types";

interface Fields {
  goal: string;
  target: number;
  currentSaved: number;
  months: number;
  returnPct: number;
}

const EXAMPLE: Fields = {
  goal: "New car",
  target: 25000,
  currentSaved: 5000,
  months: 36,
  returnPct: 4,
};

function readFields(p: URLSearchParams): Fields {
  return {
    goal: p.get("g") ?? "My goal",
    target: parseNonNegative(p.get("t"), 0),
    currentSaved: parseNonNegative(p.get("c"), 0),
    months: Math.max(1, Math.round(parseNonNegative(p.get("m"), 12))),
    returnPct: parseNumber(p.get("r"), 4),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  if (f.goal && f.goal !== "My goal") p.set("g", f.goal);
  p.set("t", String(f.target));
  if (f.currentSaved > 0) p.set("c", String(f.currentSaved));
  p.set("m", String(f.months));
  if (f.returnPct !== 4) p.set("r", String(f.returnPct));
  return p;
}

export function mountSinkingFund(ctx: TileContext): void {
  const { root } = ctx;
  root.replaceChildren();
  let fields = readFields(ctx.params);

  const goalInput = el("input", {
    type: "text",
    name: "g",
    value: fields.goal,
    attrs: { "aria-label": "Goal name" },
  });
  const mkNum = (name: string, label: string, value: number, step: number): HTMLInputElement =>
    el("input", {
      type: "number",
      name,
      min: 0,
      step,
      value,
      attrs: { "aria-label": label, inputmode: "decimal" },
    });
  const targetInput = mkNum("t", "Target amount", fields.target, 500);
  const savedInput = mkNum("c", "Saved so far", fields.currentSaved, 500);
  const monthsInput = mkNum("m", "Months until the goal", fields.months, 1);
  const returnInput = mkNum("r", "Assumed annual return (percent)", fields.returnPct, 0.25);

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    resultContainer.replaceChildren();
    if (fields.target <= 0) {
      resultContainer.append(
        el("p", { class: "ph-empty", text: "Enter a target amount to plan your sinking fund." }),
      );
      return;
    }
    const r = requiredMonthlyContribution({
      currentSaved: fields.currentSaved,
      target: fields.target,
      months: fields.months,
      annualReturnPct: fields.returnPct,
    });
    const fmt = (m: Money): string => m.format(ctx.locale);

    if (r.alreadyOnTrack) {
      const lines: BreakdownLine[] = [
        { label: "Target", value: fmt(Money.from(fields.target)) },
        { label: "Saved so far", value: fmt(Money.from(fields.currentSaved)) },
        {
          label: `Projected in ${fields.months} months at ${pct(fields.returnPct / 100)}`,
          value: fmt(r.projectedFromCurrent),
        },
        {
          label: "Where you stand",
          value: "You're already on track — your savings alone reach the goal. 🎉",
          emphasis: true,
        },
      ];
      resultContainer.append(
        resultCard({
          label: `Saving for ${fields.goal}`,
          value: Money.zero(),
          locale: ctx.locale,
          breakdown: lines,
          permalink: () => ctx.permalink(writeFields(fields)),
        }),
      );
      return;
    }

    const lines: BreakdownLine[] = [
      { label: "Target", value: fmt(Money.from(fields.target)) },
      { label: "Saved so far", value: fmt(Money.from(fields.currentSaved)) },
      { label: "Months to goal", value: String(fields.months) },
      {
        label: "Assumed annual return",
        value: `${pct(fields.returnPct / 100)} (your assumption)`,
      },
      { label: "Save each month", value: fmt(r.monthlyContribution), emphasis: true },
      { label: "Total you'll contribute", value: fmt(r.totalContributed) },
    ];

    resultContainer.append(
      resultCard({
        label: `Save for ${fields.goal}: monthly target`,
        value: r.monthlyContribution,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function recompute(): void {
    fields = {
      goal: goalInput.value.trim() || "My goal",
      target: parseNonNegative(targetInput.value, 0),
      currentSaved: parseNonNegative(savedInput.value, 0),
      months: Math.max(1, Math.round(parseNonNegative(monthsInput.value, 12))),
      returnPct: parseNumber(returnInput.value, 4),
    };
    ctx.setParams(writeFields(fields));
    compute();
  }

  goalInput.addEventListener("input", recompute);
  for (const i of [targetInput, savedInput, monthsInput, returnInput]) {
    i.addEventListener("input", recompute);
  }

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    goalInput.value = fields.goal;
    targetInput.value = String(fields.target);
    savedInput.value = String(fields.currentSaved);
    monthsInput.value = String(fields.months);
    returnInput.value = String(fields.returnPct);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Goal", goalInput),
    field("Target amount", targetInput),
    field("Saved so far", savedInput),
    field("Months until the goal", monthsInput),
    field("Assumed annual return (%)", returnInput),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const sinkingFundTile: TileDefinition = {
  id: "sinking-fund",
  title: "Sinking Fund Planner",
  pillar: "budget",
  description: "Save for a goal by a date: your monthly target.",
  keywords: ["sinking fund", "savings goal", "save for", "goal", "down payment", "college"],
  status: "ready",
  how: "A sinking fund is money you set aside steadily for a known future expense, a car, a wedding, a down payment, so it doesn't become debt. We solve for the level monthly amount that reaches your target by the date, counting what you've already saved and growing both at the return you assume.\n\nThe return is your assumption, clearly labeled. For a near-term goal, keep it conservative (savings rates), since the money shouldn't be at risk if you need it soon.",
  resources: [
    {
      label: "CFPB, saving for a goal",
      url: "https://www.consumerfinance.gov/about-us/blog/budgeting-how-to-create-a-budget-and-stick-with-it/",
    },
    {
      label: "Investor.gov, savings goal calculator",
      url: "https://www.investor.gov/financial-tools-calculators/calculators/savings-goal-calculator",
    },
  ],
  mount: mountSinkingFund,
};
