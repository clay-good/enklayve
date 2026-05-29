/**
 * Your Plan — the deterministic guidance engine (BUILD-SPEC-2 §4).
 *
 * A rules-based, ordered plan that reads a normalized snapshot of Your Situation
 * and surfaces the single next right step, with the math shown and the rule
 * behind any statutory threshold cited. It uses no AI and makes no prediction:
 * every output is a pure function of the inputs and the (cited) bundled limits.
 *
 * The default sequence (§4.1) is encoded as DATA, not hard-coded control flow,
 * so steps can be reordered and turned off (§4.2). The tone follows the Safe
 * Harbor rules (SPEC §5.3): it surfaces the next right step and frames progress,
 * never "you are behind."
 */
import { Money } from "./money";
import type { CitationData } from "../data/schemas";
import type { Debt } from "../profile/situation";

export type PlanStepId =
  | "starter-cushion"
  | "employer-match"
  | "high-cost-debt"
  | "rainy-day-fund"
  | "retirement"
  | "sinking-funds"
  | "war-chest";

/** Smallest balance first or highest rate first for debt payoff (§4.2). */
export type DebtStrategy = "highest-rate" | "smallest-balance";

/** A named savings goal the user is funding toward (a sinking fund, §4.1). */
export interface SinkingGoal {
  name: string;
  target: number;
  saved: number;
}

/**
 * The normalized inputs the plan reads, derived from Your Situation plus the
 * cited retirement limit. All money fields are plain dollars.
 */
export interface PlanInput {
  liquidSavings: number;
  essentialMonthlyExpenses: number;
  employerMatchAnnual: number;
  employerMatchCaptured: number;
  debts: Debt[];
  retirementContributionsAnnual: number;
  /** The cited annual tax-advantaged contribution limit (e.g. the 401(k)
   * elective-deferral limit). Carries the IRS citation so the step is sourced. */
  retirementLimitAnnual: number;
  retirementLimitCitation: CitationData;
  sinkingGoals: SinkingGoal[];
  /** Total net worth counted toward Your Enough Number; defaults to liquidSavings. */
  netWorth?: number;
}

/** The adjustable settings (§4.2). Opinionated by default, never locked in. */
export interface PlanConfig {
  /** The starter rainy-day cushion (a labeled default the user can change). */
  starterCushion: number;
  /** The full rainy-day target, in months of essential expenses. */
  rainyDayMonths: number;
  /** A debt counts as "high cost" at or above this annual rate (percent). */
  highCostThresholdPct: number;
  /** Smallest balance first or highest rate first (§4.2). */
  debtStrategy: DebtStrategy;
  /** Your Enough Number as a multiple of annual essential expenses (SPEC §5.1). */
  enoughMultiple: number;
  /** Step order — the user can reorder (§4.2). */
  order: PlanStepId[];
  /** Steps turned off (§4.2). */
  disabled: PlanStepId[];
}

export const DEFAULT_ORDER: PlanStepId[] = [
  "starter-cushion",
  "employer-match",
  "high-cost-debt",
  "rainy-day-fund",
  "retirement",
  "sinking-funds",
  "war-chest",
];

export const DEFAULT_CONFIG: PlanConfig = {
  starterCushion: 1000,
  rainyDayMonths: 3,
  highCostThresholdPct: 8,
  debtStrategy: "highest-rate",
  enoughMultiple: 25,
  order: DEFAULT_ORDER,
  disabled: [],
};

/** One label/value line of a step's shown math. */
export interface StepLine {
  label: string;
  value: string;
}

/** Where a step stands and what it tells the user to do next. */
export interface StepResult {
  id: PlanStepId;
  title: string;
  /** The tile that performs this step (the registry id to link to). */
  tileId: string;
  /** Whether this step's goal is already met. */
  satisfied: boolean;
  /** Assigned by the orchestrator from order + satisfaction. */
  status: "complete" | "active" | "upcoming";
  /** The single concrete next action (empty when satisfied). */
  action: string;
  /** The dollar amount the action is about (the gap), when applicable. */
  amount: Money | null;
  /** The math behind the step, each a label/value line. */
  math: StepLine[];
  /** The cited rule behind a statutory threshold, when one applies. */
  citation: CitationData | null;
  /** Set when the step can't be evaluated for lack of an input. */
  needsInfo?: string;
}

export interface PlanResult {
  /** Every active (non-disabled) step, in the configured order. */
  steps: StepResult[];
  /** The current step: the first not-satisfied step in order, or null when
   * every active step is satisfied. */
  current: StepResult | null;
}

const usd = (n: number): string => Money.from(n).format("en-US");
const ratePct = (n: number): string => `${n}%`;
const positiveGap = (target: number, have: number): number => Math.max(0, target - have);

interface StepEval {
  satisfied: boolean;
  action: string;
  amount: Money | null;
  math: StepLine[];
  citation: CitationData | null;
  needsInfo?: string;
}

interface StepDef {
  id: PlanStepId;
  title: string;
  tileId: string;
  evaluate(input: PlanInput, config: PlanConfig): StepEval;
}

/**
 * Pick the debt to attack next under the chosen strategy, deterministically.
 * Called only with a non-empty list, so reduce needs no seed.
 */
function pickTargetDebt(highCost: Debt[], strategy: DebtStrategy): Debt {
  return highCost.reduce((best, d) => {
    const score =
      strategy === "highest-rate"
        ? // Highest rate first; ties broken by the larger balance.
          d.ratePct - best.ratePct || d.balance - best.balance
        : // Smallest balance first; ties broken by the higher rate.
          best.balance - d.balance || d.ratePct - best.ratePct;
    return score > 0 ? d : best;
  });
}

/** The default ordered plan (§4.1), encoded as data. */
export const PLAN_STEPS: StepDef[] = [
  {
    id: "starter-cushion",
    title: "Starter cushion",
    tileId: "peace-of-mind",
    evaluate(input, config) {
      const target = config.starterCushion;
      const have = input.liquidSavings;
      const gap = positiveGap(target, have);
      return {
        satisfied: have >= target,
        action: `Set aside ${usd(gap)} to reach a ${usd(target)} starter cushion, so a surprise doesn't become a crisis.`,
        amount: Money.from(gap),
        math: [
          { label: "Starter cushion target", value: usd(target) },
          { label: "Your liquid savings", value: usd(have) },
          { label: "Still to set aside", value: usd(gap) },
        ],
        citation: null,
      };
    },
  },
  {
    id: "employer-match",
    title: "Capture the full employer match",
    tileId: "retirement-optimizer",
    evaluate(input) {
      const available = input.employerMatchAnnual;
      const captured = input.employerMatchCaptured;
      const gap = positiveGap(available, captured);
      return {
        satisfied: captured >= available,
        action: `Contribute enough to capture the remaining ${usd(gap)} of employer match — it's money your employer is offering.`,
        amount: Money.from(gap),
        math: [
          { label: "Employer match available", value: usd(available) },
          { label: "Match you're capturing", value: usd(captured) },
          { label: "Match left on the table", value: usd(gap) },
        ],
        citation: null,
      };
    },
  },
  {
    id: "high-cost-debt",
    title: "Clear high-cost debt",
    tileId: "freedom-date",
    evaluate(input, config) {
      const threshold = config.highCostThresholdPct;
      const highCost = input.debts.filter((d) => d.ratePct >= threshold && d.balance > 0);
      if (highCost.length === 0) {
        return {
          satisfied: true,
          action: "",
          amount: null,
          math: [
            { label: `Debts at or above ${ratePct(threshold)}`, value: "none" },
            { label: "Debts entered", value: String(input.debts.length) },
          ],
          citation: null,
        };
      }
      const target = pickTargetDebt(highCost, config.debtStrategy);
      const total = highCost.reduce((s, d) => s + d.balance, 0);
      const strategyLabel =
        config.debtStrategy === "highest-rate" ? "highest rate first" : "smallest balance first";
      return {
        satisfied: false,
        action: `Attack your ${target.name} next — ${usd(target.balance)} at ${ratePct(target.ratePct)} (${strategyLabel}).`,
        amount: Money.from(target.balance),
        math: [
          ...highCost.map((d) => ({
            label: `${d.name} (${ratePct(d.ratePct)})`,
            value: usd(d.balance),
          })),
          { label: `Total high-cost debt (≥ ${ratePct(threshold)})`, value: usd(total) },
        ],
        citation: null,
      };
    },
  },
  {
    id: "rainy-day-fund",
    title: "Full rainy-day fund",
    tileId: "peace-of-mind",
    evaluate(input, config) {
      const essential = input.essentialMonthlyExpenses;
      if (essential <= 0) {
        return {
          satisfied: false,
          action:
            "Add your essential monthly expenses in Your Situation so we can size your rainy-day fund.",
          amount: null,
          math: [{ label: "Essential monthly expenses", value: "not set" }],
          citation: null,
          needsInfo: "essentialMonthlyExpenses",
        };
      }
      const target = essential * config.rainyDayMonths;
      const have = input.liquidSavings;
      const gap = positiveGap(target, have);
      return {
        satisfied: have >= target,
        action: `Build ${usd(gap)} more to reach ${config.rainyDayMonths} months of essentials (${usd(target)}).`,
        amount: Money.from(gap),
        math: [
          { label: "Monthly essentials", value: usd(essential) },
          { label: `Target (${config.rainyDayMonths} months)`, value: usd(target) },
          { label: "Your liquid savings", value: usd(have) },
          { label: "Still to build", value: usd(gap) },
        ],
        citation: null,
      };
    },
  },
  {
    id: "retirement",
    title: "Fund tax-advantaged retirement",
    tileId: "retirement-optimizer",
    evaluate(input) {
      const limit = input.retirementLimitAnnual;
      const contributing = input.retirementContributionsAnnual;
      const gap = positiveGap(limit, contributing);
      return {
        satisfied: contributing >= limit,
        action: `Increase tax-advantaged retirement by ${usd(gap)} to move toward the ${usd(limit)} annual limit.`,
        amount: Money.from(gap),
        math: [
          { label: "Annual contribution limit", value: usd(limit) },
          { label: "You're contributing", value: usd(contributing) },
          { label: "Room remaining", value: usd(gap) },
        ],
        // The one statutory threshold in the plan: cite the IRS limit (§4.2).
        citation: input.retirementLimitCitation,
      };
    },
  },
  {
    id: "sinking-funds",
    title: "Sinking funds for known expenses",
    tileId: "sabbatical",
    evaluate(input) {
      const goals = input.sinkingGoals;
      const underfunded = goals.filter((g) => g.saved < g.target);
      if (goals.length === 0) {
        return {
          satisfied: true,
          action: "",
          amount: null,
          math: [{ label: "Named goals", value: "none yet" }],
          citation: null,
        };
      }
      const next = underfunded[0];
      return {
        satisfied: underfunded.length === 0,
        action: next
          ? `Set aside ${usd(positiveGap(next.target, next.saved))} more for ${next.name}.`
          : "",
        amount: next ? Money.from(positiveGap(next.target, next.saved)) : null,
        math: goals.map((g) => ({
          label: g.name,
          value: `${usd(g.saved)} / ${usd(g.target)}`,
        })),
        citation: null,
      };
    },
  },
  {
    id: "war-chest",
    title: "Build the war chest",
    tileId: "peace-of-mind",
    evaluate(input, config) {
      const essential = input.essentialMonthlyExpenses;
      if (essential <= 0) {
        return {
          satisfied: false,
          action:
            "Add your essential monthly expenses in Your Situation so we can compute Your Enough Number.",
          amount: null,
          math: [{ label: "Essential monthly expenses", value: "not set" }],
          citation: null,
          needsInfo: "essentialMonthlyExpenses",
        };
      }
      const target = essential * 12 * config.enoughMultiple;
      const have = input.netWorth ?? input.liquidSavings;
      const gap = positiveGap(target, have);
      return {
        satisfied: have >= target,
        action: `Grow ${usd(gap)} more toward Your Enough Number of ${usd(target)} — the point where work becomes optional.`,
        amount: Money.from(gap),
        math: [
          { label: "Annual essentials", value: usd(essential * 12) },
          { label: `Your Enough Number (${config.enoughMultiple}×)`, value: usd(target) },
          { label: "Counted toward it", value: usd(have) },
          { label: "Still to grow", value: usd(gap) },
        ],
        citation: null,
      };
    },
  },
];

const STEP_BY_ID = new Map(PLAN_STEPS.map((s) => [s.id, s]));

/**
 * Evaluate the whole plan: walk the configured order (minus disabled steps),
 * evaluate each, and mark the first not-satisfied step as the current one.
 * Deterministic: same input + config always yields the same current step.
 */
export function evaluatePlan(input: PlanInput, config: PlanConfig = DEFAULT_CONFIG): PlanResult {
  const disabled = new Set(config.disabled);
  const ordered = config.order.filter((id) => !disabled.has(id));

  let currentAssigned = false;
  const steps: StepResult[] = [];
  for (const id of ordered) {
    const def = STEP_BY_ID.get(id);
    if (!def) continue;
    const e = def.evaluate(input, config);
    let status: StepResult["status"];
    if (e.satisfied) {
      status = "complete";
    } else if (!currentAssigned) {
      status = "active";
      currentAssigned = true;
    } else {
      status = "upcoming";
    }
    steps.push({
      id: def.id,
      title: def.title,
      tileId: def.tileId,
      satisfied: e.satisfied,
      status,
      // A satisfied step has nothing to do — frame it as progress, not a task
      // (tone rule, SPEC §5.3). Only open steps carry an action and an amount.
      action: e.satisfied ? "" : e.action,
      amount: e.satisfied ? null : e.amount,
      math: e.math,
      citation: e.citation,
      needsInfo: e.needsInfo,
    });
  }

  const current = steps.find((s) => s.status === "active") ?? null;
  return { steps, current };
}
