import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { garnishmentCeiling, protectedFloor } from "../../src/engine/garnishment";
import { GarnishmentLimitsSchema, type GarnishmentLimitsData } from "../../src/data/schemas";
import type { PayPeriod } from "../../src/engine/garnishment";

/**
 * Consumer Credit Protection Act Title III (SPEC-4-safety-net §B2).
 *
 * Every figure below is hand-computed from the statute: §1673(a) caps ordinary
 * garnishment at the lesser of 25% of disposable earnings or the amount above
 * thirty times the $7.25 federal minimum hourly wage ($217.50 a week), §1673(b)
 * exempts support orders and substitutes 50/60% (55/65% for older arrears), and
 * removes the ceiling entirely for tax debt and chapter 13 orders.
 */
let limits: GarnishmentLimitsData;
beforeAll(() => {
  limits = GarnishmentLimitsSchema.parse(
    JSON.parse(
      readFileSync(resolve(__dirname, "..", "..", "data", "garnishment-limits-2026.json"), "utf8"),
    ),
  );
});

describe("the §1673(a)(2) protected floor", () => {
  it("is thirty times the federal minimum hourly wage, per week", () => {
    expect(protectedFloor(limits, "weekly").toNumber()).toBe(217.5);
  });

  it("derives every other pay period from that one weekly figure", () => {
    // 52 weeks spread over the period's count: 26 biweekly, 24 semi-monthly, 12 monthly.
    expect(protectedFloor(limits, "biweekly").toNumber()).toBe(435);
    expect(protectedFloor(limits, "semimonthly").toNumber()).toBe(471.25);
    expect(protectedFloor(limits, "monthly").toNumber()).toBe(942.5);
  });
});

describe("ordinary debt takes the lesser of the two tests", () => {
  it("is bound by the protected floor at low earnings", () => {
    // $300 weekly: 25% is $75, but only $82.50 sits above the $217.50 floor —
    // so the percentage binds. Just below, the floor is what protects them.
    const r = garnishmentCeiling(
      { disposableEarnings: 250, payPeriod: "weekly", kind: "ordinary" },
      limits,
    );
    expect(r.federalMaximum?.toNumber()).toBe(32.5);
    expect(r.binding).toBe("protected-floor");
    expect(r.remaining?.toNumber()).toBe(217.5);
  });

  it("protects everything at or below thirty times the minimum wage", () => {
    for (const earned of [0, 100, 217.5]) {
      const r = garnishmentCeiling(
        { disposableEarnings: earned, payPeriod: "weekly", kind: "ordinary" },
        limits,
      );
      expect(r.federalMaximum?.toNumber()).toBe(0);
      expect(r.remaining?.toNumber()).toBe(earned);
    }
  });

  it("is bound by the 25% share once earnings are well above the floor", () => {
    const r = garnishmentCeiling(
      { disposableEarnings: 1000, payPeriod: "weekly", kind: "ordinary" },
      limits,
    );
    expect(r.federalMaximum?.toNumber()).toBe(250);
    expect(r.binding).toBe("percentage");
    expect(r.shareApplied).toBe(0.25);
  });

  it("switches tests at the statutory crossover, $290 a week", () => {
    // 25% of $290 is $72.50, which equals $290 − $217.50 exactly.
    const at = garnishmentCeiling(
      { disposableEarnings: 290, payPeriod: "weekly", kind: "ordinary" },
      limits,
    );
    expect(at.federalMaximum?.toNumber()).toBe(72.5);
    const above = garnishmentCeiling(
      { disposableEarnings: 290.01, payPeriod: "weekly", kind: "ordinary" },
      limits,
    );
    expect(above.binding).toBe("percentage");
  });

  it("scales the same way on a monthly pay period", () => {
    // $1,200 a month against a $942.50 floor: $257.50 above it, against 25% = $300.
    const r = garnishmentCeiling(
      { disposableEarnings: 1200, payPeriod: "monthly", kind: "ordinary" },
      limits,
    );
    expect(r.federalMaximum?.toNumber()).toBe(257.5);
    expect(r.binding).toBe("protected-floor");
  });
});

describe("support orders carry their own, higher caps", () => {
  it("is 50% when the worker supports another spouse or child, 60% when not", () => {
    const supporting = garnishmentCeiling(
      {
        disposableEarnings: 1000,
        payPeriod: "weekly",
        kind: "support",
        supportingOtherDependents: true,
      },
      limits,
    );
    expect(supporting.federalMaximum?.toNumber()).toBe(500);
    const not = garnishmentCeiling(
      {
        disposableEarnings: 1000,
        payPeriod: "weekly",
        kind: "support",
        supportingOtherDependents: false,
      },
      limits,
    );
    expect(not.federalMaximum?.toNumber()).toBe(600);
  });

  it("adds five points for arrears older than twelve weeks", () => {
    const r = garnishmentCeiling(
      {
        disposableEarnings: 1000,
        payPeriod: "weekly",
        kind: "support",
        supportingOtherDependents: true,
        arrearsOlderThanTwelveWeeks: true,
      },
      limits,
    );
    expect(r.federalMaximum?.toNumber()).toBe(550);
    expect(r.shareApplied).toBeCloseTo(0.55, 10);
  });

  it("does not apply the protected floor, which §1673(b) exempts it from", () => {
    // $200 weekly is below the $217.50 floor, yet a support order still reaches it.
    const r = garnishmentCeiling(
      {
        disposableEarnings: 200,
        payPeriod: "weekly",
        kind: "support",
        supportingOtherDependents: true,
      },
      limits,
    );
    expect(r.federalMaximum?.toNumber()).toBe(100);
  });
});

describe("where Title III sets no ceiling", () => {
  it("reports the absence rather than inventing a number", () => {
    for (const kind of ["tax", "bankruptcy"] as const) {
      const r = garnishmentCeiling({ disposableEarnings: 1000, payPeriod: "weekly", kind }, limits);
      expect(r.federalMaximum).toBeNull();
      expect(r.remaining).toBeNull();
      expect(r.binding).toBe("no-federal-ceiling");
    }
  });

  it("names both categories in the shard, so neither can be quietly dropped", () => {
    expect(limits.noFederalCeiling.map((c) => c.id).sort()).toEqual([
      "bankruptcy-chapter-13",
      "tax-debt",
    ]);
  });
});

describe("robustness", () => {
  const periods: PayPeriod[] = ["weekly", "biweekly", "semimonthly", "monthly"];

  it("never returns a non-finite or negative figure for any input", () => {
    for (const bad of [NaN, Infinity, -Infinity, -50000, Number.MAX_VALUE, 1e308]) {
      for (const period of periods) {
        for (const kind of ["ordinary", "support", "tax", "bankruptcy"] as const) {
          const r = garnishmentCeiling(
            { disposableEarnings: bad, payPeriod: period, kind },
            limits,
          );
          for (const m of [r.federalMaximum, r.remaining, r.protectedFloor]) {
            if (m === null) continue;
            expect(Number.isFinite(m.toNumber())).toBe(true);
            expect(m.toNumber()).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });

  it("never lets the ceiling exceed the earnings it is taken from", () => {
    for (const earned of [0, 1, 217.5, 290, 1000, 100000]) {
      for (const kind of ["ordinary", "support"] as const) {
        const r = garnishmentCeiling(
          { disposableEarnings: earned, payPeriod: "weekly", kind },
          limits,
        );
        expect(r.federalMaximum!.toNumber()).toBeLessThanOrEqual(earned + 1e-9);
      }
    }
  });
});
