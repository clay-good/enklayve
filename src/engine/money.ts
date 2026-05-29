import Decimal from "decimal.js";

/**
 * Money — exact decimal currency for enklayve.
 *
 * BUILD-SPEC.md §6 mandates decimal.js for all money math: never floating
 * point arithmetic on currency. `Money` wraps a {@link Decimal} held at full
 * precision; rounding to cents happens explicitly and only where it belongs
 * (display, or a statutory rounding step), never silently mid-calculation.
 *
 * Rounding rule (documented, deterministic):
 *   - {@link Money.roundToCents} uses ROUND_HALF_UP — a value exactly on the
 *     half-cent boundary rounds away from zero (0.005 -> 0.01, -0.005 -> -0.01).
 *     This matches the IRS convention for rounding to whole cents and is the
 *     least-surprising rule for end users reading a paycheck.
 *
 * `Money` is immutable: every operation returns a new instance.
 */

// Configure decimal.js once for the whole engine. 34 significant digits is
// ample for any personal-finance figure and keeps intermediate products exact.
Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

export type MoneyInput = Money | Decimal | number | string;

export class Money {
  /** Full-precision underlying value, in dollars. */
  private readonly value: Decimal;

  private constructor(value: Decimal) {
    this.value = value;
  }

  /** Construct from a number, string, Decimal, or another Money. */
  static from(input: MoneyInput): Money {
    if (input instanceof Money) return input;
    if (input instanceof Decimal) return new Money(input);
    // Reject non-finite numbers early — a NaN paycheck is always a bug.
    if (typeof input === "number" && !Number.isFinite(input)) {
      throw new RangeError(`Money.from received a non-finite number: ${input}`);
    }
    return new Money(new Decimal(input));
  }

  static zero(): Money {
    return new Money(new Decimal(0));
  }

  add(other: MoneyInput): Money {
    return new Money(this.value.plus(Money.from(other).value));
  }

  subtract(other: MoneyInput): Money {
    return new Money(this.value.minus(Money.from(other).value));
  }

  /** Multiply by a scalar (e.g. a tax rate or a quantity). */
  multiply(factor: number | string | Decimal): Money {
    return new Money(this.value.times(new Decimal(factor)));
  }

  /** Divide by a non-zero scalar. */
  divide(divisor: number | string | Decimal): Money {
    const d = new Decimal(divisor);
    if (d.isZero()) throw new RangeError("Money.divide by zero");
    return new Money(this.value.dividedBy(d));
  }

  /** Negate the amount. */
  negate(): Money {
    return new Money(this.value.negated());
  }

  /** Absolute value. */
  abs(): Money {
    return new Money(this.value.abs());
  }

  /**
   * Round to whole cents using ROUND_HALF_UP. Returns a new Money whose value
   * has at most two decimal places.
   */
  roundToCents(): Money {
    return new Money(this.value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP));
  }

  /** Integer number of cents, after ROUND_HALF_UP rounding. */
  toCents(): number {
    return this.value.times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  }

  /** Lossy conversion to a JS number — use only at display boundaries. */
  toNumber(): number {
    return this.value.toNumber();
  }

  /** Exact decimal string at full precision. */
  toString(): string {
    return this.value.toString();
  }

  // --- comparisons ---
  equals(other: MoneyInput): boolean {
    return this.value.equals(Money.from(other).value);
  }
  greaterThan(other: MoneyInput): boolean {
    return this.value.greaterThan(Money.from(other).value);
  }
  greaterThanOrEqual(other: MoneyInput): boolean {
    return this.value.greaterThanOrEqualTo(Money.from(other).value);
  }
  lessThan(other: MoneyInput): boolean {
    return this.value.lessThan(Money.from(other).value);
  }
  lessThanOrEqual(other: MoneyInput): boolean {
    return this.value.lessThanOrEqualTo(Money.from(other).value);
  }
  isNegative(): boolean {
    return this.value.isNegative() && !this.value.isZero();
  }
  isZero(): boolean {
    return this.value.isZero();
  }

  /**
   * Locale-aware currency formatting via Intl. Rounds to cents first so the
   * displayed string always matches {@link roundToCents}. Defaults to US
   * dollars in the en-US locale (the launch locale, BUILD-SPEC.md §11).
   */
  format(locale = "en-US", currency = "USD"): string {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
    }).format(this.roundToCents().toNumber());
  }
}
