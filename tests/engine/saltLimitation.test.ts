import { describe, it, expect, beforeAll } from "vitest";
import { saltCapFor, itemizedTotal, evaluateTaxes } from "../../src/engine/tax";
import { Money } from "../../src/engine/money";
import { JurisdictionSchema } from "../../src/data/schemas";
import type { SaltLimitationData } from "../../src/data/schemas";
import { loadDatasets } from "../helpers/datasets";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The federal SALT cap, IRC §164(b)(6) and (b)(7).
 *
 * Until 2026-09-01 this was `SALT_CAP = 10000` in the engine — a constant with
 * no citation, no shard, and nothing watching it. The One Big Beautiful Bill Act
 * replaced the flat $10,000 with an applicable limitation amount of $40,400 for
 * 2026, phasing down by 30% of modified AGI over $505,000 to a $10,000 floor and
 * halved for a married individual filing separately. The federal shard had
 * already been refreshed to Rev. Proc. 2025-32 "reflecting the One Big Beautiful
 * Bill Act"; the constant beside it had not. The golden corpus contained a
 * worked example pinning the wrong answer.
 *
 * Every number below is read off the statute, not off the implementation.
 */
const LIMIT: SaltLimitationData = {
  applicableLimitationAmount: 40400,
  thresholdAmount: 505000,
  phasedownRate: 0.3,
  floor: 10000,
  marriedSeparatelyShare: 0.5,
};

describe("the applicable limitation amount", () => {
  it("is the full amount below the threshold", () => {
    expect(saltCapFor(LIMIT, "single", Money.from(200_000))).toBe(40400);
  });

  it("is still the full amount AT the threshold", () => {
    // §164(b)(7)(B)(i) reduces by 30% of the excess OVER the threshold, so a
    // filer landing exactly on $505,000 has no excess and keeps the whole cap.
    expect(saltCapFor(LIMIT, "single", Money.from(505_000))).toBe(40400);
  });

  it("falls by 30 cents of cap per dollar of MAGI above it", () => {
    // $100,000 over → $30,000 off → $10,400.
    expect(saltCapFor(LIMIT, "single", Money.from(605_000))).toBeCloseTo(10400, 6);
  });

  it("stops at the floor rather than running to zero", () => {
    // §164(b)(7)(B)(iii). Without it a filer at $1M would be capped below the
    // $10,000 that every filer had before the Act.
    expect(saltCapFor(LIMIT, "single", Money.from(2_000_000))).toBe(10000);
  });

  it("reaches the floor exactly where the arithmetic says", () => {
    // 40,400 − 0.3x = 10,000 at x = 101,333.33 over the threshold.
    const atFloor = 505_000 + (40400 - 10000) / 0.3;
    expect(saltCapFor(LIMIT, "single", Money.from(atFloor))).toBeCloseTo(10000, 6);
    expect(saltCapFor(LIMIT, "single", Money.from(atFloor - 1))).toBeGreaterThan(10000);
  });
});

describe("a married individual filing a separate return", () => {
  it("gets half the cap", () => {
    // §164(b)(6)(B).
    expect(saltCapFor(LIMIT, "married_separately", Money.from(200_000))).toBe(20200);
  });

  it("starts phasing down at half the threshold, not the whole one", () => {
    // §164(b)(7)(B)(i) halves the threshold too. At $300,000 a joint filer is
    // untouched and a separate filer is $47,500 over their $252,500 threshold.
    expect(saltCapFor(LIMIT, "married_jointly", Money.from(300_000))).toBe(40400);
    expect(saltCapFor(LIMIT, "married_separately", Money.from(300_000))).toBeCloseTo(
      (40400 - 0.3 * 47_500) / 2,
      6,
    );
  });

  it("floors at half the floor, because the halving comes after", () => {
    // The order of the two sentences is the whole content of this case. The
    // statute floors the applicable limitation amount at $10,000 and THEN halves
    // it for a separate return, so the separate filer's floor is $5,000. Reading
    // them the other way round hands a high-income separate filer $10,000 —
    // twice what the law allows, and a plausible enough number that nothing else
    // here would have caught it.
    expect(saltCapFor(LIMIT, "married_separately", Money.from(2_000_000))).toBe(5000);
  });
});

describe("the cap reaching the deduction", () => {
  it("counts SALT up to the cap and no further", () => {
    expect(
      itemizedTotal({ stateAndLocalTaxes: 30_000 }, Money.from(200_000), 40400).toNumber(),
    ).toBe(30_000);
    expect(
      itemizedTotal({ stateAndLocalTaxes: 60_000 }, Money.from(200_000), 40400).toNumber(),
    ).toBe(40_400);
  });

  it("is uncapped only when no shard said otherwise", () => {
    // Unreachable in production — the schema requires the limitation on the
    // federal shard — and deliberately visible rather than plausible if it ever
    // is reached.
    expect(saltCapFor(undefined, "single", Money.from(200_000))).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("the shard the engine reads it from", () => {
  let ds: Awaited<ReturnType<typeof loadDatasets>>;
  beforeAll(async () => {
    ds = await loadDatasets();
  });

  it("is on the federal shard, with the statute's 2026 figures", () => {
    expect(ds.federal.saltLimitation).toEqual(LIMIT);
  });

  it("refuses a federal shard that does not state one", () => {
    // The A6/A7 remedy: the engine has no literal left to substitute, so a
    // shard that cannot answer must fail validation and let the tile show its
    // verify-before-relying banner.
    const { saltLimitation, ...withoutIt } = ds.federal;
    expect(saltLimitation).toBeTruthy();
    expect(JurisdictionSchema.safeParse(withoutIt).success).toBe(false);
  });

  it("lets a state shard alone, since no state carries one", () => {
    const state = { ...ds.federal, id: "US-CA", saltLimitation: undefined };
    expect(JurisdictionSchema.safeParse(state).success).toBe(true);
  });

  it("moves the answer for a real filer", () => {
    // The harm, end to end: $30,000 of state and local tax at $250,000 of wages.
    const r = evaluateTaxes(
      {
        filingStatus: "single",
        wages: 250_000,
        deductionMode: "itemized",
        itemized: { stateAndLocalTaxes: 30_000 },
      },
      { federal: ds.federal, fica: ds.fica },
    );
    expect(r.federal.deduction.amount.toNumber()).toBe(30_000);
  });
});

describe("what the page tells the reader", () => {
  it("states the cap the engine actually applies", () => {
    // The old copy said "capped at $10,000" and was true when it was written.
    // Prose goes stale the same way a constant does and nothing was watching
    // this one either, so the figures in the explainer are read back off the
    // shard.
    const source = readFileSync(
      resolve(__dirname, "..", "..", "src/tiles/federalIncomeTax.ts"),
      "utf8",
    );
    const shard = JSON.parse(
      readFileSync(resolve(__dirname, "..", "..", "data/federal-income-tax-2024.json"), "utf8"),
    ) as { taxYear: number; saltLimitation: SaltLimitationData };
    const money = (n: number): string => `$${n.toLocaleString("en-US")}`;
    expect(source).toContain(`capped at ${money(shard.saltLimitation.applicableLimitationAmount)}`);
    expect(source).toContain(String(shard.taxYear));
    expect(source).toContain(money(shard.saltLimitation.thresholdAmount));
    expect(source).toContain(`${money(shard.saltLimitation.floor)} floor`);
  });
});
