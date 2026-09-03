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
   *
   * Decimal arithmetic on absurd inputs (e.g. a 999,999,999% growth rate) can
   * exceed JS `Number` range or produce NaN; rather than render "$NaN"/"$∞" we
   * show a neutral sentinel. Real figures are always finite, so this only ever
   * appears for nonsensical inputs — never a legitimate calculation.
   */
  format(locale = "en-US", currency = "USD"): string {
    const n = this.roundToCents().toNumber();
    if (!Number.isFinite(n)) return "(out of range)";
    // A minus sign in front of nothing. `Intl` formats both -0 and any amount
    // that rounds to it as "-$0.00", which is not a number a reader can do
    // anything with: it reads as either a bug or a debt of zero dollars. An
    // exact zero times -1 is enough to produce it, and so is any difference
    // that lands under half a cent below zero. Rounding is the last step before
    // display, so the sign is dropped after it, never before -- a real -$0.004
    // is still negative to every caller that asks for the number.
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
    }).format(n === 0 ? 0 : n);
  }
}

/**
 * Round a set of parts to cents so they add up to the rounded total.
 *
 * Rounding each part on its own is correct part by part and wrong as a column:
 * `sum(round(xᵢ))` and `round(sum(xᵢ))` differ by a cent often enough to matter.
 * On the Take-Home breakdown that happens in about one case in fourteen — a
 * reader adding federal, FICA, state and local gets a number the "Total tax"
 * line beside it does not agree with, on a site whose entire claim is that its
 * arithmetic can be checked.
 *
 * The total stays exact. Quantizing it instead was tried and is worse: the
 * combined marginal rate is measured over a $100 wage probe, so cents of noise
 * in the total become hundredths of a point in a printed rate, and a
 * hand-verified §68 identity stopped holding.
 *
 * So the residual is allocated the way every financial statement allocates one —
 * largest remainder: the cent goes to the part whose own rounding gave up the
 * most, which is the allocation that minimises the total displayed error.
 * Deterministic, and the parts must already sum to the total exactly; a caller
 * that hands over a set that does not gets its own residual spread the same way,
 * which is a bug in the caller rather than a silent lie here.
 */
export function allocateRounded(parts: readonly Money[], total: Money): Money[] {
  const rounded = parts.map((p) => p.roundToCents());
  const target = total.roundToCents().toCents();
  let residual = target - rounded.reduce((sum, p) => sum + p.toCents(), 0);
  if (residual === 0 || rounded.length === 0) return rounded;

  // Largest remainder: how much each part gave up (or gained) when it rounded.
  // A part rounded DOWN has a positive remainder and is first in line for a
  // cent; a part rounded UP is first to give one back.
  const order = parts
    .map((p, i) => ({ i, remainder: p.toNumber() * 100 - rounded[i]!.toCents() }))
    .sort((a, b) => (residual > 0 ? b.remainder - a.remainder : a.remainder - b.remainder));

  const step = residual > 0 ? 0.01 : -0.01;
  for (const { i } of order) {
    if (residual === 0) break;
    rounded[i] = rounded[i]!.add(step);
    residual -= residual > 0 ? 1 : -1;
  }
  return rounded;
}

/**
 * Format a raw number as currency for display, without throwing.
 *
 * {@link Money.from} rejects a non-finite number on purpose — a NaN paycheck is
 * always a bug, and failing loudly in the engine is right. But the *display*
 * layer is the last line of defense (SPEC-3 §2.1): a crafted or stale deep link
 * that overflows an intermediate to Infinity must render a neutral sentinel, not
 * take the whole tile down with a `RangeError`. `Money.format` already returns
 * "(out of range)" for a non-finite Decimal; this closes the one step earlier
 * where the throw actually happens, so a tile formatting an engine result can
 * never blank its own page.
 */
export function formatMoney(value: number, locale = "en-US", currency = "USD"): string {
  if (!Number.isFinite(value)) return "(out of range)";
  return Money.from(value).format(locale, currency);
}
