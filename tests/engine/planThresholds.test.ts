import { describe, it, expect } from "vitest";
import {
  DEFAULT_CONFIG,
  evaluatePlan,
  type PlanInput,
  type PlanStepId,
} from "../../src/engine/plan";
import type { CitationData } from "../../src/data/schemas";

/**
 * Standing exactly on a goal.
 *
 * The plan is a ladder of "are you there yet" comparisons, and every one of
 * them was written `have >= target` and held by nothing. Landing *exactly* on a
 * target is not a curiosity here — it is what happens to anyone who followed the
 * plan's own advice, because the advice is a dollar figure ("set aside $340 to
 * reach a $1,000 starter cushion") and someone who transfers exactly that lands
 * exactly there.
 *
 * Flipped to `>`, that person is told the step is *not* satisfied and handed an
 * action reading "set aside $0.00" — the plan's own instruction, followed
 * precisely, produces a task it cannot let you finish. That is the failure this
 * file exists to prevent, and it applies identically to all four thresholds.
 */
const citation: CitationData = {
  sourceUrl:
    "https://www.irs.gov/retirement-plans/plan-participant-employee/retirement-topics-401k-and-profit-sharing-plan-contribution-limits",
  sourceDocument: "IRS 401(k) elective-deferral limit",
  effectiveYear: 2026,
  dateRetrieved: "2026-08-31",
};

const base: PlanInput = {
  liquidSavings: 0,
  essentialMonthlyExpenses: 3_000,
  employerMatchAnnual: 0,
  employerMatchCaptured: 0,
  debts: [],
  retirementContributionsAnnual: 0,
  retirementLimitAnnual: 24_500,
  retirementLimitCitation: citation,
  sinkingGoals: [],
};

const step = (input: Partial<PlanInput>, id: PlanStepId) => {
  const r = evaluatePlan({ ...base, ...input });
  return r.steps.find((s) => s.id === id)!;
};

describe("a plan step at exactly its target", () => {
  it("counts a starter cushion of exactly $1,000 as done", () => {
    const s = step({ liquidSavings: 1_000 }, "starter-cushion");
    expect(DEFAULT_CONFIG.starterCushion).toBe(1_000);
    expect(s.satisfied).toBe(true);
    expect(s.status).toBe("complete");
    // A satisfied step carries no action and no amount, which is the tone rule
    // the orchestrator enforces — and the reason the flipped comparison is so
    // visibly wrong: it would produce an *active* step whose action is $0.00.
    expect(s.action).toBe("");
    expect(s.amount).toBeNull();
  });

  it("still asks for the last cent below the cushion", () => {
    const s = step({ liquidSavings: 999.99 }, "starter-cushion");
    expect(s.satisfied).toBe(false);
    expect(s.amount!.toNumber()).toBeCloseTo(0.01, 6);
  });

  it("counts a rainy-day fund of exactly three months of essentials as done", () => {
    // $3,000 a month × 3 months = $9,000.
    const s = step({ liquidSavings: 9_000 }, "rainy-day-fund");
    expect(s.satisfied).toBe(true);
    expect(s.amount).toBeNull();
  });

  it("counts a war chest of exactly My Enough Number as done", () => {
    // $3,000 × 12 × 25 = $900,000.
    const s = step({ liquidSavings: 0, netWorth: 900_000 }, "war-chest");
    expect(s.satisfied).toBe(true);
    const short = step({ liquidSavings: 0, netWorth: 899_999 }, "war-chest");
    expect(short.satisfied).toBe(false);
    expect(short.amount!.toNumber()).toBe(1);
  });
});

describe("a debt at exactly the high-cost rate", () => {
  it("treats a debt at exactly the threshold as high cost", () => {
    expect(DEFAULT_CONFIG.highCostThresholdPct).toBe(8);
    const s = step(
      { liquidSavings: 1_000, debts: [{ name: "Card", balance: 4_000, ratePct: 8 }] },
      "high-cost-debt",
    );
    // "A debt counts as high cost AT OR ABOVE this annual rate", says the config's
    // own doc comment. Flipped to `>`, a debt sitting exactly on the line the
    // user chose is dropped from the step entirely and the plan reports nothing
    // to do about it.
    expect(s.satisfied).toBe(false);
    expect(s.action).not.toBe("");
  });

  it("leaves a debt a tenth of a point below it alone", () => {
    const s = step(
      { liquidSavings: 1_000, debts: [{ name: "Card", balance: 4_000, ratePct: 7.9 }] },
      "high-cost-debt",
    );
    expect(s.satisfied).toBe(true);
  });
});

describe("a war chest with no expenses to measure it against", () => {
  it("asks for the expenses rather than declaring the number reached", () => {
    // `essential <= 0` is the guard. Flipped to `<`, essential expenses of
    // exactly zero give a target of exactly zero, and any net worth at all —
    // including none — clears it. The step would report that work is already
    // optional, to someone who has told it nothing about their expenses.
    const s = step({ essentialMonthlyExpenses: 0, netWorth: 0 }, "war-chest");
    expect(s.satisfied).toBe(false);
    expect(s.needsInfo ?? s.action).toBeTruthy();
  });

  it("does the same for the rainy-day fund, which needs the same input", () => {
    const s = step({ essentialMonthlyExpenses: 0, liquidSavings: 50_000 }, "rainy-day-fund");
    expect(s.satisfied).toBe(false);
  });
});
