import { describe, it, expect } from "vitest";
import { Money } from "../src/engine/money";

describe("Money rounding (ROUND_HALF_UP, documented in money.ts)", () => {
  it("rounds an exact half-cent away from zero", () => {
    expect(Money.from("0.005").roundToCents().toString()).toBe("0.01");
    expect(Money.from("0.015").roundToCents().toString()).toBe("0.02");
  });

  it("rounds negative half-cents away from zero", () => {
    expect(Money.from("-0.005").roundToCents().toString()).toBe("-0.01");
  });

  it("handles the classic 2.675 floating-point case exactly", () => {
    // Native JS: (2.675).toFixed(2) === "2.67" due to float error. Decimal is exact.
    expect(Money.from("2.675").roundToCents().toString()).toBe("2.68");
  });

  it("rounds below the half boundary toward zero", () => {
    expect(Money.from("0.004").roundToCents().toString()).toBe("0");
    expect(Money.from("1.234").roundToCents().toString()).toBe("1.23");
  });

  it("toCents returns integer cents", () => {
    expect(Money.from("19.995").toCents()).toBe(2000);
    expect(Money.from("19.99").toCents()).toBe(1999);
  });

  it("keeps full precision until explicitly rounded", () => {
    const third = Money.from(10).divide(3);
    expect(third.toString().startsWith("3.3333333333")).toBe(true);
    expect(third.roundToCents().toString()).toBe("3.33");
  });
});

describe("Money arithmetic", () => {
  it("adds and subtracts exactly", () => {
    // 0.1 + 0.2 !== 0.3 in float; must be exact here.
    expect(Money.from("0.1").add("0.2").toString()).toBe("0.3");
    expect(Money.from("0.3").subtract("0.1").toString()).toBe("0.2");
  });

  it("multiplies by a rate without drift", () => {
    expect(Money.from("100000").multiply("0.22").roundToCents().toString()).toBe("22000");
  });

  it("chains operations", () => {
    const result = Money.from("1000").multiply(12).subtract("500").divide(2);
    expect(result.toString()).toBe("5750");
  });

  it("negate and abs", () => {
    expect(Money.from("5").negate().toString()).toBe("-5");
    expect(Money.from("-5").abs().toString()).toBe("5");
  });

  it("rejects division by zero", () => {
    expect(() => Money.from("1").divide(0)).toThrow(/divide by zero/);
  });

  it("rejects non-finite numbers", () => {
    expect(() => Money.from(Number.NaN)).toThrow(RangeError);
    expect(() => Money.from(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("Money comparisons", () => {
  it("compares correctly", () => {
    expect(Money.from("10").greaterThan("9.99")).toBe(true);
    expect(Money.from("10").lessThan("10.01")).toBe(true);
    expect(Money.from("10").equals("10.00")).toBe(true);
    expect(Money.from("10").greaterThanOrEqual("10")).toBe(true);
    expect(Money.from("10").lessThanOrEqual("10")).toBe(true);
  });

  it("isNegative and isZero", () => {
    expect(Money.from("-0.01").isNegative()).toBe(true);
    expect(Money.zero().isNegative()).toBe(false);
    expect(Money.zero().isZero()).toBe(true);
    expect(Money.from("0.00").isZero()).toBe(true);
  });
});

describe("Money formatting", () => {
  it("formats US dollars", () => {
    expect(Money.from("1234.5").format()).toBe("$1,234.50");
    expect(Money.from("-1234.567").format()).toBe("-$1,234.57");
  });

  it("shows a sentinel instead of $NaN/$∞ when a value exceeds Number range", () => {
    // Decimal arithmetic on absurd inputs can produce a value beyond JS Number
    // range; its `.toNumber()` is Infinity, which must not render as "$∞".
    expect(Money.from("1e400").format()).toBe("(out of range)");
    expect(Money.from("1e400").multiply(10).format()).toBe("(out of range)");
  });
});
