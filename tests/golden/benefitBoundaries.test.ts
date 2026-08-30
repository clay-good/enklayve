import { describe, it, expect, beforeAll } from "vitest";
import {
  povertyLine,
  fplPercent,
  estimateSaversCredit,
  estimateSnap,
  medicaidEligibility,
} from "../../src/engine/benefits";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import type {
  FederalPovertyLevelData,
  MedicaidData,
  SaversCreditData,
  SnapData,
} from "../../src/data/schemas";

/**
 * Eligibility at exactly the limit.
 *
 * Four comparisons decide whether a household sitting precisely on a threshold
 * is told it qualifies — SNAP's gross test, SNAP's net test, Medicaid's FPL
 * threshold, and the saver's credit tier ceiling. On 2026-08-30 every one of
 * them could be flipped from "at or below" to "below" without failing a single
 * test in a suite of 1,820.
 *
 * These are the answers where being wrong costs the most. Each rule is written
 * "at or below" in the law and in this engine's own comments — SNAP eligibility
 * at or under 130% and 100% of the poverty line, Medicaid expansion coverage
 * for an adult at or below 138% — so a filer landing exactly on the line
 * qualifies, and an off-by-one tells someone at the threshold they cannot have
 * food assistance or health coverage.
 *
 * The saver's credit is the sharpest of the four because its shard says so in
 * as many words: it "is a CLIFF, not a phase-out: one dollar of AGI over a
 * tier's cap drops the rate to the next step". A cliff whose edge nothing tests
 * is a cliff in the wrong place.
 */
let data: BundledData;
let fpl: FederalPovertyLevelData;
let snap: SnapData;
let medicaid: MedicaidData;
let savers: SaversCreditData;
beforeAll(async () => {
  data = await loadBundledData();
  fpl = data.fpl("contiguous")!;
  snap = data.snap()!;
  medicaid = data.medicaid()!;
  savers = data.saversCredit()!;
});

const CENT = 0.01;

describe("SNAP, at exactly the income limit", () => {
  it("passes the gross test at the limit and fails a cent above it", () => {
    // Household of one, because its limit is a whole number of dollars.
    //
    // That is not incidental. 130% of a monthly poverty line is only sometimes
    // representable: for a household of two it is $2,344.33⅓, and an income set
    // to that number round-trips to a hair ABOVE the limit, so the case lands
    // on the wrong side of the line and passes whichever comparison the code
    // uses. The first version of this test picked a size like that and could
    // not fail. The limit is still read back from the engine rather than
    // recomputed, so the case is on the engine's line and not on one of ours.
    const size = 1;
    const probe = estimateSnap({ householdSize: size, monthlyGrossIncome: 1 }, snap, fpl);
    const grossLimit = probe.grossLimit.toNumber();
    expect(Number.isInteger(grossLimit), "pick a size whose limit lands on a cent").toBe(true);
    expect(grossLimit).toBeCloseTo(
      povertyLine(size, fpl)
        .divide(12)
        .multiply(snap.grossIncomeLimitPctFpl / 100)
        .toNumber(),
      2,
    );

    const at = estimateSnap({ householdSize: size, monthlyGrossIncome: grossLimit }, snap, fpl);
    const over = estimateSnap(
      { householdSize: size, monthlyGrossIncome: grossLimit + CENT },
      snap,
      fpl,
    );
    expect(at.passedGrossTest, "a household exactly at 130% FPL passes the gross test").toBe(true);
    expect(over.passedGrossTest).toBe(false);
    expect(over.eligible).toBe(false);
  });

  it("passes the net test at exactly the net limit", () => {
    // The net test runs on income after the standard and earned-income
    // deductions, so the case is built backwards: unearned income only, so the
    // 20% earned-income deduction is out of the way, then gross is set so that
    // net lands exactly on the limit.
    const size = 1;
    const probe = estimateSnap(
      { householdSize: size, monthlyGrossIncome: 10_000, monthlyEarnedIncome: 0 },
      snap,
      fpl,
    );
    const standardDeduction = 10_000 - probe.netMonthlyIncome.toNumber();
    const netLimit = probe.netLimit.toNumber();

    const at = estimateSnap(
      {
        householdSize: size,
        monthlyGrossIncome: netLimit + standardDeduction,
        monthlyEarnedIncome: 0,
      },
      snap,
      fpl,
    );
    expect(at.netMonthlyIncome.toNumber()).toBeCloseTo(netLimit, 2);
    expect(at.passedNetTest, "a household exactly at 100% FPL net passes the net test").toBe(true);

    const over = estimateSnap(
      {
        householdSize: size,
        monthlyGrossIncome: netLimit + standardDeduction + 1,
        monthlyEarnedIncome: 0,
      },
      snap,
      fpl,
    );
    expect(over.passedNetTest).toBe(false);
    expect(over.eligible).toBe(false);
  });
});

describe("Medicaid, at exactly the threshold", () => {
  it("covers an adult exactly at the expansion threshold, not just below it", () => {
    // "an adult at or below the threshold (138% FPL) is likely eligible" — the
    // engine's own words. California expands; the shard carries no override.
    const size = 1;
    const threshold = medicaid.expansionThresholdPctFpl;
    const income = povertyLine(size, fpl)
      .multiply(threshold / 100)
      .toNumber();
    expect(fplPercent(income, size, fpl)).toBeCloseTo(threshold, 6);

    const at = medicaidEligibility({ stateCode: "CA", income, householdSize: size }, medicaid, fpl);
    expect(at.eligible, "an adult exactly at 138% FPL is covered").toBe(true);

    const over = medicaidEligibility(
      { stateCode: "CA", income: income + 1, householdSize: size },
      medicaid,
      fpl,
    );
    expect(over.eligible).toBe(false);
  });
});

describe("the saver's credit, at exactly a tier cap", () => {
  it("keeps the better rate at the cap and drops it a dollar over", () => {
    // The shard says it plainly: a cliff, not a phase-out. One dollar of AGI
    // over a tier's cap drops the rate to the next step, so the edge is the
    // whole rule.
    const cap = savers.tiers[0]!.agiCapSingle;
    const args = { filingStatus: "single" as const, contributions: 2_000 };

    expect(estimateSaversCredit({ ...args, agi: cap }, savers).rate).toBe(savers.tiers[0]!.rate);
    expect(estimateSaversCredit({ ...args, agi: cap + 1 }, savers).rate).toBe(
      savers.tiers[1]!.rate,
    );
  });

  it("ends the credit a dollar past the last tier", () => {
    const last = savers.tiers[savers.tiers.length - 1]!;
    const args = { filingStatus: "single" as const, contributions: 2_000 };
    expect(estimateSaversCredit({ ...args, agi: last.agiCapSingle }, savers).rate).toBe(last.rate);
    expect(estimateSaversCredit({ ...args, agi: last.agiCapSingle + 1 }, savers).rate).toBe(0);
    expect(
      estimateSaversCredit({ ...args, agi: last.agiCapSingle + 1 }, savers).credit.toNumber(),
    ).toBe(0);
  });
});
