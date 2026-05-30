/**
 * Sabbatical & Big-Purchase Planner tile (BUILD-SPEC.md §5.2): can I afford a
 * break (or a big one-time purchase), and what does it leave me? Deterministic
 * arithmetic on your own numbers — the cost of the break, whether savings cover
 * it, and the runway left afterward. Defaults pull savings and essentials from My
 * Situation. Tone is calm and non-shaming (§5.3): red is used only for a genuine
 * shortfall warning.
 */
import { Money } from "../engine/money";
import { sabbaticalPlan } from "../engine/finance";
import { el } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import type { SituationStore } from "../profile/situation";
import type { TileContext, TileDefinition } from "./types";

interface Fields {
  savings: number;
  monthlyBurn: number;
  breakMonths: number;
  monthlyIncome: number;
  oneTimeCost: number;
}

const EXAMPLE: Fields = {
  savings: 30000,
  monthlyBurn: 4000,
  breakMonths: 6,
  monthlyIncome: 0,
  oneTimeCost: 0,
};

function readFields(p: URLSearchParams, profile: SituationStore): Fields {
  return {
    savings: p.has("s") ? parseNonNegative(p.get("s"), 0) : (profile.get("liquidSavings") ?? 0),
    monthlyBurn: p.has("burn")
      ? parseNonNegative(p.get("burn"), 0)
      : (profile.get("essentialMonthlyExpenses") ?? 0),
    breakMonths: Math.max(0, Math.round(parseNonNegative(p.get("m"), 6))),
    monthlyIncome: parseNonNegative(p.get("inc"), 0),
    oneTimeCost: parseNonNegative(p.get("buy"), 0),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("s", String(f.savings));
  p.set("burn", String(f.monthlyBurn));
  p.set("m", String(f.breakMonths));
  if (f.monthlyIncome > 0) p.set("inc", String(f.monthlyIncome));
  if (f.oneTimeCost > 0) p.set("buy", String(f.oneTimeCost));
  return p;
}

const monthsLabel = (n: number): string => `${n.toFixed(1)} month${n === 1 ? "" : "s"}`;

export function mountSabbatical(ctx: TileContext): void {
  const { root, profile } = ctx;
  root.replaceChildren();
  let fields = readFields(ctx.params, profile);

  const mkNum = (
    name: string,
    label: string,
    value: number,
    step: number,
    mode = "decimal",
  ): HTMLInputElement =>
    el("input", {
      type: "number",
      name,
      min: 0,
      step,
      value,
      attrs: { "aria-label": label, inputmode: mode },
    });
  const sInput = mkNum("s", "Savings set aside", fields.savings, 500);
  const burnInput = mkNum("burn", "Essential monthly spending", fields.monthlyBurn, 100);
  const mInput = mkNum("m", "Break length in months", fields.breakMonths, 1, "numeric");
  const incInput = mkNum("inc", "Income during the break (monthly)", fields.monthlyIncome, 100);
  const buyInput = mkNum("buy", "One-time purchase cost", fields.oneTimeCost, 500);

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    resultContainer.replaceChildren();
    const r = sabbaticalPlan({
      savings: fields.savings,
      monthlyEssentialBurn: fields.monthlyBurn,
      breakMonths: fields.breakMonths,
      monthlyIncomeDuringBreak: fields.monthlyIncome,
      oneTimeCost: fields.oneTimeCost,
    });
    const fmt = (m: Money): string => m.format(ctx.locale);

    const status: BreakdownLine = r.affordable
      ? {
          label: "Can you afford it?",
          value: `Yes: you'd have ${fmt(r.remaining)} left, about ${monthsLabel(r.runwayAfterMonths)} of runway.`,
          emphasis: true,
        }
      : {
          label: "Can you afford it?",
          value: `Not quite: you'd be ${fmt(r.remaining.abs())} short. A little more saved, a shorter break, or some income during it would close the gap.`,
          emphasis: true,
        };

    const lines: BreakdownLine[] = [
      { label: "Net monthly draw on savings", value: fmt(r.netMonthlyDraw) },
      { label: "Total cost of the plan", value: fmt(r.totalCost) },
      { label: "Savings left afterward", value: fmt(r.remaining) },
      status,
    ];

    resultContainer.append(
      resultCard({
        label: "Cost of your break",
        value: r.totalCost,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );

    // A genuine shortfall is the one place red belongs here (§5.3).
    if (!r.affordable) {
      resultContainer.append(
        el("div", {
          class: "verify-banner",
          attrs: { role: "alert" },
          text: `This plan costs ${fmt(r.totalCost)} but you've set aside ${fmt(Money.from(fields.savings))}. You're ${fmt(r.remaining.abs())} short, no rush, it just isn't covered yet.`,
        }),
      );
    }
  }

  function recompute(): void {
    fields = {
      savings: parseNonNegative(sInput.value, 0),
      monthlyBurn: parseNonNegative(burnInput.value, 0),
      breakMonths: Math.max(0, Math.round(parseNonNegative(mInput.value, 0))),
      monthlyIncome: parseNonNegative(incInput.value, 0),
      oneTimeCost: parseNonNegative(buyInput.value, 0),
    };
    ctx.setParams(writeFields(fields));
    profile.set("liquidSavings", fields.savings);
    if (fields.monthlyBurn > 0) profile.set("essentialMonthlyExpenses", fields.monthlyBurn);
    compute();
  }

  for (const i of [sInput, burnInput, mInput, incInput, buyInput]) {
    i.addEventListener("input", recompute);
  }

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    sInput.value = String(fields.savings);
    burnInput.value = String(fields.monthlyBurn);
    mInput.value = String(fields.breakMonths);
    incInput.value = String(fields.monthlyIncome);
    buyInput.value = String(fields.oneTimeCost);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Savings set aside", sInput),
    field("Essential monthly spending", burnInput),
    field("Break length (months)", mInput),
    field("Income during the break (monthly)", incInput),
    field("One-time purchase cost", buyInput),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const sabbaticalTile: TileDefinition = {
  id: "sabbatical",
  title: "Sabbatical Planner",
  pillar: "stand",
  description: "Can I afford a break, and what does it cost?",
  keywords: ["sabbatical", "break", "big purchase", "career break", "time off", "leave"],
  status: "ready",
  how: "We add up what a break costs: your essential monthly spending minus any income you'd still earn, times the number of months, plus any one-time cost. Then we compare it to the savings you've set aside and show what's left and how many months of runway that leaves.\n\nIt's a calm what-if, not a verdict. If it isn't covered yet, we say by how much, no shame, just the number, so you can adjust the length, save a bit more, or line up some income during the break.",
  resources: [
    {
      label: "CFPB, building an emergency fund",
      url: "https://www.consumerfinance.gov/an-essential-guide-to-building-an-emergency-fund/",
    },
    { label: "Investor.gov, saving & investing", url: "https://www.investor.gov/" },
  ],
  mount: mountSabbatical,
};
