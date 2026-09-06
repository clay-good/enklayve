import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluatePlan, type PlanInput } from "../../src/engine/plan";

/**
 * Every field the plan engine reads is a field its caller sets.
 *
 * `situationFieldsWritten.test.ts` holds that no field of My Situation is read
 * by the site and written by nothing. This is the same rule one layer in, on
 * the boundary between the guidance engine and the one document that drives
 * it, and it exists because that boundary had the more expensive version of the
 * bug.
 *
 * `PlanInput.netWorth` is declared, documented as "total net worth counted
 * toward My Enough Number", read by the war-chest step, and — until 2026-09-06
 * — set by nobody. TypeScript could not say so: the field is optional, because
 * the step has a sane fallback to liquid savings. So the last step on the
 * ladder counted a household's gross savings and ignored every debt, in the
 * same document whose snapshot four lines above says "Net worth (savings −
 * debts)". A household with $900,000 saved, $400,000 of debt and $3,000 a month
 * of essentials has an Enough Number of $900,000 and a net worth of $500,000,
 * and My Plan marked that step **satisfied** — this product telling somebody
 * work is now optional while they are $400,000 short of a figure it printed
 * itself.
 *
 * An optional field with a fallback is exactly the shape that goes unnoticed:
 * nothing crashes, nothing is blank, and the number is merely wrong. So the
 * check is on the names rather than on the types.
 */
const ROOT = resolve(__dirname, "..", "..");
const PLAN_SRC = readFileSync(resolve(ROOT, "src", "engine", "plan.ts"), "utf8");
const REPORT_SRC = readFileSync(resolve(ROOT, "src", "readout", "report.ts"), "utf8");

/** The declared fields of `PlanInput`, read off the interface itself. */
function planInputFields(): string[] {
  const body = PLAN_SRC.match(/export interface PlanInput \{([\s\S]*?)\n\}/)?.[1];
  expect(body, "PlanInput is no longer declared where this test looks").toBeTruthy();
  return [...body!.matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]!);
}

describe("the plan engine's input", () => {
  it("is an interface this test can still read", () => {
    const fields = planInputFields();
    // A parse that quietly returns nothing would pass every check below.
    expect(fields).toContain("liquidSavings");
    expect(fields).toContain("netWorth");
    expect(fields.length).toBeGreaterThan(6);
  });

  it("has exactly one caller, which is what makes the check below sufficient", () => {
    // If a second surface starts running the plan, this rule has to grow to
    // cover it rather than keep pinning the one it was written for.
    const callers = ["src/readout/report.ts"];
    expect(REPORT_SRC).toContain("evaluatePlan(");
    expect(callers).toEqual(["src/readout/report.ts"]);
  });

  it("is fully supplied by that caller", () => {
    const supplier = REPORT_SRC.match(/function planInputFrom\([\s\S]*?\n\}/)?.[0] ?? "";
    expect(supplier, "planInputFrom is no longer where this test looks").not.toBe("");
    const missing = planInputFields().filter((f) => !new RegExp(`\\b${f}:`).test(supplier));
    expect(
      missing,
      "these are read by a plan step and set by nobody — an optional field with a" +
        " fallback is wrong quietly, which is how netWorth stayed missing",
    ).toEqual([]);
  });

  /**
   * The one field supplied as an empty value on purpose, named here so that it
   * is a decision rather than an oversight. Nothing on the site records a named
   * savings goal — there is no `sinkingGoals` in My Situation — so the step
   * degrades to "none yet" and reports satisfied. Closing it properly means a
   * new profile field and a portable-format version, which is the same call
   * `ages` gets in `situationFieldsWritten.test.ts`.
   */
  it("supplies sinking goals as empty, deliberately, and the step survives it", () => {
    expect(REPORT_SRC).toMatch(/sinkingGoals: \[\]/);
    const step = evaluatePlan({
      liquidSavings: 0,
      essentialMonthlyExpenses: 0,
      employerMatchAnnual: null,
      employerMatchCaptured: 0,
      debts: [],
      retirementContributionsAnnual: 0,
      retirementLimitAnnual: null,
      retirementLimitCitation: null,
      sinkingGoals: [],
    } as PlanInput).steps.find((s) => s.id === "sinking-funds");
    expect(step?.satisfied).toBe(true);
  });

  /**
   * And the arithmetic the missing field changed, held directly: the war chest
   * counts what the household is worth, not what it holds.
   */
  it("counts debts against My Enough Number", () => {
    const base: PlanInput = {
      liquidSavings: 900_000,
      essentialMonthlyExpenses: 3_000,
      employerMatchAnnual: 0,
      employerMatchCaptured: 0,
      debts: [{ name: "Loan", balance: 400_000, ratePct: 3 }],
      retirementContributionsAnnual: 24_500,
      retirementLimitAnnual: 24_500,
      retirementLimitCitation: null,
      sinkingGoals: [],
    };
    const gross = evaluatePlan(base).steps.find((s) => s.id === "war-chest");
    expect(gross?.satisfied, "gross savings alone reach the Enough Number").toBe(true);

    const net = evaluatePlan({ ...base, netWorth: 500_000 }).steps.find(
      (s) => s.id === "war-chest",
    );
    expect(net?.satisfied).toBe(false);
    expect(net?.action).toContain("$400,000.00");
  });
});
