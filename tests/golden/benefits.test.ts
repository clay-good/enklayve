import { describe, it, expect, beforeAll } from "vitest";
import {
  povertyLine,
  fplPercent,
  estimateEitc,
  estimateCtc,
  estimateSaversCredit,
  estimateSnap,
  medicaidEligibility,
  acaApplicablePercent,
  estimatePremiumTaxCredit,
} from "../../src/engine/benefits";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import type {
  AcaData,
  EitcCtcData,
  FederalPovertyLevelData,
  MedicaidData,
  SaversCreditData,
  SnapData,
} from "../../src/data/schemas";

/**
 * Golden cases for Pillar 2 (BUILD-SPEC.md §4, §9), cross-checked against the
 * published 2024 figures (HHS poverty guidelines; IRS Rev. Proc. 2023-34 EITC;
 * IRC §24 Child Tax Credit).
 */
let data: BundledData;
let fpl: FederalPovertyLevelData;
let eitcCtc: EitcCtcData;
let savers: SaversCreditData;
let snap: SnapData;
let medicaid: MedicaidData;
let aca: AcaData;
beforeAll(async () => {
  data = await loadBundledData();
  fpl = data.fpl("contiguous")!;
  eitcCtc = data.eitcCtc()!;
  savers = data.saversCredit()!;
  snap = data.snap()!;
  medicaid = data.medicaid()!;
  aca = data.aca()!;
});

describe("Federal Poverty Level", () => {
  it("matches the 2024 contiguous guidelines", () => {
    expect(povertyLine(1, fpl).toNumber()).toBe(15060);
    // Household of 4: 15,060 + 5,380 × 3 = 31,200.
    expect(povertyLine(4, fpl).toNumber()).toBe(31200);
  });

  it("computes income as a percentage of the line", () => {
    // $62,400 for a household of 4 is exactly 200% FPL.
    expect(fplPercent(62400, 4, fpl)).toBeCloseTo(200, 5);
  });

  it("has Alaska and Hawaii variants higher than the contiguous base", () => {
    expect(data.fpl("alaska")!.base).toBe(18810);
    expect(data.fpl("hawaii")!.base).toBe(17310);
  });
});

describe("Earned Income Tax Credit (2024)", () => {
  it("pays the max on the plateau (1 child, $15,000)", () => {
    const r = estimateEitc({ earnedIncome: 15000, qualifyingChildren: 1, married: false }, eitcCtc);
    expect(r.credit.toNumber()).toBeCloseTo(4213, 0);
  });

  it("phases out above the threshold (1 child, $30,000 single)", () => {
    // 4,213 − (30,000 − 22,720) × 0.1598 = 4,213 − 1,163.34 ≈ 3,049.66.
    const r = estimateEitc({ earnedIncome: 30000, qualifyingChildren: 1, married: false }, eitcCtc);
    expect(r.credit.toNumber()).toBeCloseTo(3049.66, 1);
  });

  it("phases in for childless filers (0 children, $8,000)", () => {
    // min(632, 8,000 × 0.0765 = 612) = 612; below the $10,330 threshold, no phaseout.
    const r = estimateEitc({ earnedIncome: 8000, qualifyingChildren: 0, married: false }, eitcCtc);
    expect(r.credit.toNumber()).toBeCloseTo(612, 0);
  });

  it("fully phases out for childless filers by $20,000", () => {
    const r = estimateEitc({ earnedIncome: 20000, qualifyingChildren: 0, married: false }, eitcCtc);
    expect(r.credit.toNumber()).toBe(0);
    expect(r.phasedOut).toBe(true);
  });

  it("caps the bracket at three or more children", () => {
    const three = estimateEitc(
      { earnedIncome: 20000, qualifyingChildren: 3, married: false },
      eitcCtc,
    );
    const five = estimateEitc(
      { earnedIncome: 20000, qualifyingChildren: 5, married: false },
      eitcCtc,
    );
    expect(five.credit.toNumber()).toBe(three.credit.toNumber());
    expect(five.qualifyingChildren).toBe(3);
  });
});

describe("Child Tax Credit (2024)", () => {
  it("is $2,000 per child below the phaseout", () => {
    const r = estimateCtc({ qualifyingChildren: 2, magi: 100000, married: true }, eitcCtc);
    expect(r.credit.toNumber()).toBe(4000);
    // Refundable portion (ACTC) capped at $1,700 per child.
    expect(r.refundable.toNumber()).toBe(3400);
  });

  it("phases out $50 per $1,000 over the threshold", () => {
    // MFJ threshold 400k; 410k → 10 steps × $50 = $500 off 2 × $2,000.
    const r = estimateCtc({ qualifyingChildren: 2, magi: 410000, married: true }, eitcCtc);
    expect(r.credit.toNumber()).toBe(3500);
  });

  it("can phase out entirely at very high income", () => {
    const r = estimateCtc({ qualifyingChildren: 3, magi: 440000, married: false }, eitcCtc);
    expect(r.credit.toNumber()).toBe(0);
  });

  it("is deterministic", () => {
    const input = { qualifyingChildren: 2, magi: 410000, married: true };
    expect(estimateCtc(input, eitcCtc)).toEqual(estimateCtc(input, eitcCtc));
  });
});

describe("Saver's Credit (2024)", () => {
  it("gives the 50% rate below the first AGI ceiling (single, $21k, $2k)", () => {
    const r = estimateSaversCredit(
      { agi: 21000, filingStatus: "single", contributions: 2000 },
      savers,
    );
    expect(r.rate).toBe(0.5);
    expect(r.credit.toNumber()).toBe(1000);
  });

  it("steps down to 20% in the next AGI band (single, $24k)", () => {
    const r = estimateSaversCredit(
      { agi: 24000, filingStatus: "single", contributions: 2000 },
      savers,
    );
    expect(r.rate).toBe(0.2);
    expect(r.credit.toNumber()).toBe(400);
  });

  it("is zero above the top AGI ceiling (single, $40k)", () => {
    const r = estimateSaversCredit(
      { agi: 40000, filingStatus: "single", contributions: 2000 },
      savers,
    );
    expect(r.rate).toBe(0);
    expect(r.credit.toNumber()).toBe(0);
  });

  it("counts both spouses' contributions up to $4,000 for MFJ", () => {
    const r = estimateSaversCredit(
      { agi: 45000, filingStatus: "married_jointly", contributions: 5000 },
      savers,
    );
    expect(r.rate).toBe(0.5);
    expect(r.eligibleContributions.toNumber()).toBe(4000);
    expect(r.credit.toNumber()).toBe(2000);
  });

  it("uses the head-of-household column", () => {
    const r = estimateSaversCredit(
      { agi: 35000, filingStatus: "head_of_household", contributions: 1000 },
      savers,
    );
    expect(r.rate).toBe(0.2);
    expect(r.credit.toNumber()).toBe(200);
  });
});

describe("SNAP eligibility (FY2024, contiguous)", () => {
  it("estimates a benefit for an eligible 3-person household", () => {
    // Poverty line(3) = 25,820/yr → 2,151.67/mo. Gross 2,200 ≤ 130% (2,797.17).
    // Net = 2,200 − 198 standard − 440 earned (20%) = 1,562 ≤ 100% (2,151.67).
    // Benefit = 766 max − 30% × 1,562 = 766 − 468.60 = 297.40.
    const r = estimateSnap({ householdSize: 3, monthlyGrossIncome: 2200 }, snap, fpl);
    expect(r.eligible).toBe(true);
    expect(r.monthlyBenefit.roundToCents().toNumber()).toBeCloseTo(297.4, 2);
  });

  it("fails the gross income test at high income", () => {
    const r = estimateSnap({ householdSize: 1, monthlyGrossIncome: 3000 }, snap, fpl);
    expect(r.passedGrossTest).toBe(false);
    expect(r.eligible).toBe(false);
    expect(r.monthlyBenefit.isZero()).toBe(true);
  });

  it("floors an eligible small household at the minimum benefit", () => {
    // hh1, $1,500/mo: passes both tests, computed benefit is negative → $23 minimum.
    const r = estimateSnap({ householdSize: 1, monthlyGrossIncome: 1500 }, snap, fpl);
    expect(r.eligible).toBe(true);
    expect(r.monthlyBenefit.toNumber()).toBe(23);
  });
});

describe("Medicaid eligibility (2024)", () => {
  it("is income-eligible in an expansion state below 138% FPL", () => {
    // CA expanded; $18,000 for a household of 1 is ~119% FPL.
    const r = medicaidEligibility(
      { stateCode: "CA", income: 18000, householdSize: 1 },
      medicaid,
      fpl,
    );
    expect(r.expansionState).toBe(true);
    expect(r.eligible).toBe(true);
    expect(r.thresholdPctFpl).toBe(138);
  });

  it("is not income-eligible above the threshold in an expansion state", () => {
    const r = medicaidEligibility(
      { stateCode: "CA", income: 25000, householdSize: 1 },
      medicaid,
      fpl,
    );
    expect(r.eligible).toBe(false);
  });

  it("returns a null verdict for a non-expansion state (no number invented)", () => {
    const r = medicaidEligibility(
      { stateCode: "TX", income: 10000, householdSize: 1 },
      medicaid,
      fpl,
    );
    expect(r.expansionState).toBe(false);
    expect(r.eligible).toBeNull();
    expect(r.thresholdPctFpl).toBeNull();
  });

  it("applies DC's higher 215% threshold", () => {
    // $30,000 for a household of 1 is ~199% FPL — eligible only because DC goes to 215%.
    const r = medicaidEligibility(
      { stateCode: "DC", income: 30000, householdSize: 1 },
      medicaid,
      fpl,
    );
    expect(r.thresholdPctFpl).toBe(215);
    expect(r.eligible).toBe(true);
  });
});

describe("ACA premium tax credit (applicable percentages)", () => {
  it("interpolates the applicable percentage within a band", () => {
    expect(acaApplicablePercent(100, aca)).toBeCloseTo(0, 6); // ≤150% → 0%
    expect(acaApplicablePercent(150, aca)).toBeCloseTo(0, 6);
    expect(acaApplicablePercent(175, aca)).toBeCloseTo(1.0, 6); // halfway through 150–200 (0→2%)
    expect(acaApplicablePercent(200, aca)).toBeCloseTo(2.0, 6);
    expect(acaApplicablePercent(350, aca)).toBeCloseTo(7.25, 6); // halfway through 300–400 (6→8.5%)
    expect(acaApplicablePercent(450, aca)).toBeCloseTo(8.5, 6); // top band is flat (no cliff)
  });

  it("credits the benchmark premium above the expected contribution (200% FPL, size 1)", () => {
    // 200% FPL for a household of 1 = $30,120; applicable % = 2.0%.
    const r = estimatePremiumTaxCredit(
      { householdSize: 1, annualIncome: 30120, benchmarkMonthlyPremium: 600 },
      aca,
      fpl,
    );
    expect(r.fplPercent).toBeCloseTo(200, 5);
    expect(r.applicablePercent).toBeCloseTo(2.0, 6);
    expect(r.expectedAnnualContribution.roundToCents().toNumber()).toBe(602.4); // 30,120 × 2%
    expect(r.annualCredit.roundToCents().toNumber()).toBe(6597.6); // 7,200 − 602.40
    expect(r.monthlyCredit.roundToCents().toNumber()).toBe(549.8);
    expect(r.eligible).toBe(true);
    expect(r.belowMedicaidFloor).toBe(false);
  });

  it("gives no credit when the expected contribution exceeds the benchmark (high income)", () => {
    // ~664% FPL → flat 8.5%; expected $8,500 > a $6,000 benchmark → no credit, no cliff.
    const r = estimatePremiumTaxCredit(
      { householdSize: 1, annualIncome: 100000, benchmarkMonthlyPremium: 500 },
      aca,
      fpl,
    );
    expect(r.applicablePercent).toBeCloseTo(8.5, 6);
    expect(r.annualCredit.isZero()).toBe(true);
    expect(r.eligible).toBe(false);
  });

  it("flags income below the 100% FPL Medicaid floor", () => {
    const r = estimatePremiumTaxCredit(
      { householdSize: 1, annualIncome: 10000, benchmarkMonthlyPremium: 500 },
      aca,
      fpl,
    );
    expect(r.belowMedicaidFloor).toBe(true);
    expect(r.eligible).toBe(false);
  });
});
