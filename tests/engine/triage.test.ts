import { describe, it, expect, beforeAll } from "vitest";
import { triageBills, type Bill } from "../../src/engine/triage";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import type { BillTriageData } from "../../src/data/schemas";

/**
 * Bill triage (SPEC-4 §A3). The behavior that matters is the sort key: this
 * orders by *consequence*, not by interest rate, which is the opposite of what
 * every debt calculator trains a user to do. The tests pin that inversion
 * explicitly, because a future "optimization" toward rate-first would look
 * reasonable in a diff and be actively harmful in a bad month.
 */
let data: BundledData;
let rules: BillTriageData;
beforeAll(async () => {
  data = await loadBundledData();
  rules = data.billTriage()!;
});

const bill = (name: string, categoryId: string, amount: number): Bill => ({
  name,
  categoryId,
  amount,
});

describe("the rules table itself", () => {
  it("is bundled, cited, and internally consistent", () => {
    expect(rules).toBeDefined();
    expect(rules.citation.sourceUrl).toContain("consumerfinance.gov");
    const ranks = rules.categories.map((c) => c.rank);
    expect(new Set(ranks).size).toBe(ranks.length);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it("puts housing, utilities, and getting to work above unsecured debt", () => {
    const rank = (id: string): number => rules.categories.find((c) => c.id === id)!.rank;
    expect(rank("housing")).toBeLessThan(rank("credit-cards"));
    expect(rank("utilities")).toBeLessThan(rank("credit-cards"));
    expect(rank("job-transport")).toBeLessThan(rank("credit-cards"));
    expect(rank("court-ordered")).toBeLessThan(rank("credit-cards"));
    expect(rank("medical")).toBeGreaterThan(rank("housing"));
  });

  it("states a consequence and at least one route to relief for every category", () => {
    for (const c of rules.categories) {
      expect(c.consequence.length, c.id).toBeGreaterThan(20);
      expect(c.relief.length, c.id).toBeGreaterThan(0);
    }
  });

  it("carries state-set timing as a pointer, never as a number", () => {
    for (const c of rules.categories.filter((c) => c.timing === "state")) {
      expect(c.timingNote, c.id).toBeDefined();
      // No "within 30 days"-style figures: we do not model 50 jurisdictions.
      expect(c.timingNote, c.id).not.toMatch(/\b\d+\s*(day|days|week|weeks|month|months)\b/);
    }
  });
});

describe("triageBills", () => {
  it("orders by consequence, not by interest rate", () => {
    // The card is the highest-rate debt and the *last* thing to pay in a month
    // you cannot cover: missing it costs a fee, missing rent costs the home.
    const result = triageBills(
      [
        bill("Visa 24.99% APR", "credit-cards", 300),
        bill("Rent", "housing", 1400),
        bill("Electric", "utilities", 180),
      ],
      600,
      rules,
    );
    expect(result.ordered.map((t) => t.bill.name)).toEqual(["Rent", "Electric", "Visa 24.99% APR"]);
  });

  it("funds down the list and reports a partial payment where the money runs out", () => {
    const result = triageBills(
      [bill("Rent", "housing", 1400), bill("Electric", "utilities", 180)],
      1500,
      rules,
    );
    expect(result.ordered[0]!.coverage).toBe("full");
    expect(result.ordered[1]!.coverage).toBe("partial");
    expect(result.ordered[1]!.funded.toNumber()).toBe(100);
    expect(result.ordered[1]!.short.toNumber()).toBe(80);
    expect(result.shortfall.toNumber()).toBe(80);
  });

  it("says plainly when nothing reaches a bill", () => {
    const result = triageBills(
      [bill("Rent", "housing", 1400), bill("Visa", "credit-cards", 300)],
      1400,
      rules,
    );
    expect(result.ordered[1]!.coverage).toBe("none");
    expect(result.ordered[1]!.funded.toNumber()).toBe(0);
  });

  it("recognizes when triage isn't needed at all", () => {
    const result = triageBills([bill("Rent", "housing", 1000)], 2000, rules);
    expect(result.coversEverything).toBe(true);
    expect(result.shortfall.toNumber()).toBe(0);
  });

  it("keeps the user's own order within a category", () => {
    const result = triageBills(
      [
        bill("Gas", "utilities", 90),
        bill("Water", "utilities", 60),
        bill("Electric", "utilities", 120),
      ],
      100,
      rules,
    );
    expect(result.ordered.map((t) => t.bill.name)).toEqual(["Gas", "Water", "Electric"]);
  });

  it("surfaces which categories have state-set timing, deduped", () => {
    const result = triageBills(
      [bill("Rent", "housing", 1000), bill("Gas", "utilities", 90), bill("Water", "utilities", 60)],
      0,
      rules,
    );
    const ids = result.stateVariable.map((c) => c.id);
    expect(ids).toContain("housing");
    expect(ids).toContain("utilities");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("degrades an unknown category to least-severe instead of jumping the queue", () => {
    const result = triageBills(
      [bill("Mystery", "not-a-category", 100), bill("Rent", "housing", 100)],
      200,
      rules,
    );
    expect(result.ordered[0]!.bill.name).toBe("Rent");
  });

  it("never produces a non-finite figure over adversarial input", () => {
    for (const [amount, available] of [
      [Number.NaN, Number.NaN],
      [-500, -500],
      [1e15, 1],
      [0, 0],
    ] as const) {
      const result = triageBills([bill("X", "housing", amount)], available, rules);
      for (const t of result.ordered) {
        expect(Number.isFinite(t.funded.toNumber())).toBe(true);
        expect(Number.isFinite(t.short.toNumber())).toBe(true);
        expect(t.funded.toNumber()).toBeGreaterThanOrEqual(0);
      }
      expect(Number.isFinite(result.shortfall.toNumber())).toBe(true);
    }
  });

  it("handles an empty list without inventing an answer", () => {
    const result = triageBills([], 500, rules);
    expect(result.ordered).toEqual([]);
    expect(result.coversEverything).toBe(true);
  });
});
