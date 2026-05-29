import { describe, it, expect } from "vitest";
import {
  evaluatePlan,
  DEFAULT_CONFIG,
  DEFAULT_ORDER,
  PLAN_STEPS,
  type PlanInput,
  type PlanConfig,
  type PlanStepId,
} from "../../src/engine/plan";
import type { CitationData } from "../../src/data/schemas";

/**
 * Golden cases for Your Plan (BUILD-SPEC-2 §4). The guidance engine is fully
 * deterministic: a given situation + config always selects the same current
 * step. These cases pin that selection across a range of situations and assert
 * the §4.2 adjustability (debt strategy, reorder, toggle, rainy-day months) and
 * that the one statutory threshold — the retirement limit — is cited.
 */
const CITATION: CitationData = {
  sourceUrl: "https://www.irs.gov/pub/irs-drop/n-23-75.pdf",
  sourceDocument: "IRS Notice 2023-75 (2024 retirement plan limits)",
  effectiveYear: 2024,
  dateRetrieved: "2024-02-01",
};

/** A maxed-out situation; tweak fields per case to expose a single active step. */
function base(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    liquidSavings: 1_000_000,
    essentialMonthlyExpenses: 3000,
    employerMatchAnnual: 5000,
    employerMatchCaptured: 5000,
    debts: [],
    retirementContributionsAnnual: 23000,
    retirementLimitAnnual: 23000,
    retirementLimitCitation: CITATION,
    sinkingGoals: [],
    netWorth: 5_000_000,
    ...overrides,
  };
}

function currentId(input: PlanInput, config: PlanConfig = DEFAULT_CONFIG): PlanStepId | null {
  return evaluatePlan(input, config).current?.id ?? null;
}

describe("Your Plan — current-step selection", () => {
  it("picks the starter cushion when there's no savings", () => {
    expect(currentId(base({ liquidSavings: 0 }))).toBe("starter-cushion");
  });

  it("picks the employer match once the cushion is met", () => {
    expect(currentId(base({ liquidSavings: 2000, employerMatchCaptured: 0 }))).toBe(
      "employer-match",
    );
  });

  it("picks high-cost debt once cushion and match are handled", () => {
    expect(
      currentId(
        base({ liquidSavings: 2000, debts: [{ name: "Card", balance: 6000, ratePct: 23 }] }),
      ),
    ).toBe("high-cost-debt");
  });

  it("ignores debt below the high-cost threshold", () => {
    // A 5% loan is below the 8% default threshold, so it does not trigger the step.
    expect(
      currentId(
        base({
          liquidSavings: 2000,
          debts: [{ name: "Mortgage", balance: 300000, ratePct: 5 }],
          essentialMonthlyExpenses: 3000,
          retirementContributionsAnnual: 23000,
        }),
      ),
    ).not.toBe("high-cost-debt");
  });

  it("picks the full rainy-day fund when savings fall short of the target", () => {
    // 3 months × $3,000 = $9,000 target; $2,000 saved is short.
    expect(currentId(base({ liquidSavings: 2000 }))).toBe("rainy-day-fund");
  });

  it("picks retirement once the rainy-day fund is full", () => {
    expect(currentId(base({ liquidSavings: 20000, retirementContributionsAnnual: 0 }))).toBe(
      "retirement",
    );
  });

  it("picks the war chest once everything earlier is satisfied", () => {
    expect(currentId(base({ netWorth: 100000 }))).toBe("war-chest");
  });

  it("returns no current step when every step is satisfied", () => {
    expect(currentId(base())).toBeNull();
  });

  it("prompts for essentials instead of guessing when they're unset", () => {
    const result = evaluatePlan(base({ liquidSavings: 2000, essentialMonthlyExpenses: 0 }));
    expect(result.current?.id).toBe("rainy-day-fund");
    expect(result.current?.needsInfo).toBe("essentialMonthlyExpenses");
  });
});

describe("Your Plan — adjustability (§4.2)", () => {
  const debts = [
    { name: "Loan A", balance: 1000, ratePct: 10 },
    { name: "Loan B", balance: 9000, ratePct: 25 },
  ];
  const situation = base({ liquidSavings: 2000, debts });

  it("highest-rate first attacks the higher-rate debt", () => {
    const result = evaluatePlan(situation, { ...DEFAULT_CONFIG, debtStrategy: "highest-rate" });
    expect(result.current?.action).toContain("Loan B");
  });

  it("smallest-balance first attacks the smaller-balance debt", () => {
    const result = evaluatePlan(situation, { ...DEFAULT_CONFIG, debtStrategy: "smallest-balance" });
    expect(result.current?.action).toContain("Loan A");
  });

  it("reordering changes which step is current", () => {
    // Move retirement to the front; with nothing contributed it becomes current
    // even though the cushion is also unmet.
    const order: PlanStepId[] = [
      "retirement",
      ...DEFAULT_ORDER.filter((id) => id !== "retirement"),
    ];
    const result = evaluatePlan(base({ liquidSavings: 0, retirementContributionsAnnual: 0 }), {
      ...DEFAULT_CONFIG,
      order,
    });
    expect(result.current?.id).toBe("retirement");
  });

  it("turning a step off skips it entirely", () => {
    const result = evaluatePlan(base({ liquidSavings: 0, employerMatchCaptured: 0 }), {
      ...DEFAULT_CONFIG,
      disabled: ["starter-cushion"],
    });
    expect(result.steps.some((s) => s.id === "starter-cushion")).toBe(false);
    expect(result.current?.id).toBe("employer-match");
  });

  it("a larger rainy-day target raises the bar", () => {
    const sixMonths = evaluatePlan(base({ liquidSavings: 10000 }), {
      ...DEFAULT_CONFIG,
      rainyDayMonths: 6,
    });
    // 6 × $3,000 = $18,000 > $10,000, so the rainy-day fund is the current step.
    expect(sixMonths.current?.id).toBe("rainy-day-fund");
  });
});

describe("Your Plan — invariants and provenance", () => {
  it("is deterministic: the same input yields the same result", () => {
    const input = base({
      liquidSavings: 2000,
      debts: [{ name: "Card", balance: 6000, ratePct: 23 }],
    });
    expect(evaluatePlan(input)).toEqual(evaluatePlan(input));
  });

  it("never proposes a negative dollar amount", () => {
    const input = base({
      liquidSavings: 0,
      employerMatchCaptured: 0,
      retirementContributionsAnnual: 0,
    });
    for (const step of evaluatePlan(input).steps) {
      if (step.amount) expect(step.amount.greaterThanOrEqual(0)).toBe(true);
    }
  });

  it("cites the IRS limit on the retirement step and nowhere it shouldn't", () => {
    const steps = evaluatePlan(
      base({ liquidSavings: 20000, retirementContributionsAnnual: 0 }),
    ).steps;
    const retirement = steps.find((s) => s.id === "retirement");
    expect(retirement?.citation?.sourceUrl).toMatch(/irs\.gov/);
    // The opinionated defaults (cushion, rainy-day months, debt threshold) are
    // labeled assumptions, not cited external rules.
    expect(steps.find((s) => s.id === "starter-cushion")?.citation).toBeNull();
    expect(steps.find((s) => s.id === "rainy-day-fund")?.citation).toBeNull();
  });

  it("exposes all seven default steps", () => {
    expect(PLAN_STEPS.map((s) => s.id)).toEqual(DEFAULT_ORDER);
    expect(PLAN_STEPS).toHaveLength(7);
  });

  it("frames complete steps as progress, never failure", () => {
    const steps = evaluatePlan(base()).steps;
    // Tone rule (SPEC §5.3): every satisfied step has no scolding action text.
    for (const s of steps.filter((x) => x.satisfied)) {
      expect(s.action).toBe("");
    }
  });
});
