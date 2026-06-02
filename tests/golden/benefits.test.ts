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
  acaCovered,
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
 * published 2026 figures (HHS 2026 poverty guidelines; IRS Rev. Proc. 2025-32
 * EITC; IRC §24 Child Tax Credit at $2,200/child under the OBBBA; IRS Rev. Proc.
 * 2025-25 ACA applicable percentages, with the 400% FPL cliff restored).
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
  it("matches the 2026 contiguous guidelines", () => {
    expect(povertyLine(1, fpl).toNumber()).toBe(15960);
    // Household of 4: 15,960 + 5,680 × 3 = 33,000.
    expect(povertyLine(4, fpl).toNumber()).toBe(33000);
  });

  it("computes income as a percentage of the line", () => {
    // $66,000 for a household of 4 is exactly 200% FPL.
    expect(fplPercent(66000, 4, fpl)).toBeCloseTo(200, 5);
  });

  it("has Alaska and Hawaii variants higher than the contiguous base", () => {
    expect(data.fpl("alaska")!.base).toBe(19950);
    expect(data.fpl("hawaii")!.base).toBe(18360);
  });
});

describe("Earned Income Tax Credit (2026)", () => {
  it("pays the max on the plateau (1 child, $15,000)", () => {
    const r = estimateEitc({ earnedIncome: 15000, qualifyingChildren: 1, married: false }, eitcCtc);
    expect(r.credit.toNumber()).toBeCloseTo(4427, 0);
  });

  it("phases out above the threshold (1 child, $30,000 single)", () => {
    // 4,427 − (30,000 − 23,890) × 0.1598 = 4,427 − 976.38 ≈ 3,450.62.
    const r = estimateEitc({ earnedIncome: 30000, qualifyingChildren: 1, married: false }, eitcCtc);
    expect(r.credit.toNumber()).toBeCloseTo(3450.62, 1);
  });

  it("phases in for childless filers (0 children, $8,000)", () => {
    // min(664, 8,000 × 0.0765 = 612) = 612; below the $10,860 threshold, no phaseout.
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

describe("Child Tax Credit (2026)", () => {
  it("is $2,200 per child below the phaseout", () => {
    const r = estimateCtc({ qualifyingChildren: 2, magi: 100000, married: true }, eitcCtc);
    expect(r.credit.toNumber()).toBe(4400);
    // Refundable portion (ACTC) capped at $1,700 per child.
    expect(r.refundable.toNumber()).toBe(3400);
  });

  it("phases out $50 per $1,000 over the threshold", () => {
    // MFJ threshold 400k; 410k → 10 steps × $50 = $500 off 2 × $2,200.
    const r = estimateCtc({ qualifyingChildren: 2, magi: 410000, married: true }, eitcCtc);
    expect(r.credit.toNumber()).toBe(3900);
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

describe("Saver's Credit (2026)", () => {
  it("gives the 50% rate below the first AGI ceiling (single, $21k, $2k)", () => {
    const r = estimateSaversCredit(
      { agi: 21000, filingStatus: "single", contributions: 2000 },
      savers,
    );
    expect(r.rate).toBe(0.5);
    expect(r.credit.toNumber()).toBe(1000);
  });

  it("steps down to 20% in the next AGI band (single, $25k)", () => {
    const r = estimateSaversCredit(
      { agi: 25000, filingStatus: "single", contributions: 2000 },
      savers,
    );
    expect(r.rate).toBe(0.2);
    expect(r.credit.toNumber()).toBe(400);
  });

  it("is zero above the top AGI ceiling (single, $41k)", () => {
    const r = estimateSaversCredit(
      { agi: 41000, filingStatus: "single", contributions: 2000 },
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
      { agi: 37000, filingStatus: "head_of_household", contributions: 1000 },
      savers,
    );
    expect(r.rate).toBe(0.2);
    expect(r.credit.toNumber()).toBe(200);
  });
});

describe("SNAP eligibility (FY2026, contiguous)", () => {
  it("estimates a benefit for an eligible 3-person household", () => {
    // Poverty line(3) = 27,320/yr → 2,276.67/mo. Gross 2,200 ≤ 130% (2,959.67).
    // Net = 2,200 − 209 standard − 440 earned (20%) = 1,551 ≤ 100% (2,276.67).
    // Benefit = 785 max − 30% × 1,551 = 785 − 465.30 = 319.70.
    const r = estimateSnap({ householdSize: 3, monthlyGrossIncome: 2200 }, snap, fpl);
    expect(r.eligible).toBe(true);
    expect(r.monthlyBenefit.roundToCents().toNumber()).toBeCloseTo(319.7, 2);
  });

  it("fails the gross income test at high income", () => {
    const r = estimateSnap({ householdSize: 1, monthlyGrossIncome: 3000 }, snap, fpl);
    expect(r.passedGrossTest).toBe(false);
    expect(r.eligible).toBe(false);
    expect(r.monthlyBenefit.isZero()).toBe(true);
  });

  it("floors an eligible small household at the minimum benefit", () => {
    // hh1, $1,500/mo: passes both tests, computed benefit rounds below the $24 floor.
    const r = estimateSnap({ householdSize: 1, monthlyGrossIncome: 1500 }, snap, fpl);
    expect(r.eligible).toBe(true);
    expect(r.monthlyBenefit.toNumber()).toBe(24);
  });
});

describe("Medicaid eligibility (2026)", () => {
  it("is income-eligible in an expansion state below 138% FPL", () => {
    // CA expanded; $18,000 for a household of 1 is ~113% FPL.
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
    // $30,000 for a household of 1 is ~188% FPL — eligible only because DC goes to 215%.
    const r = medicaidEligibility(
      { stateCode: "DC", income: 30000, householdSize: 1 },
      medicaid,
      fpl,
    );
    expect(r.thresholdPctFpl).toBe(215);
    expect(r.eligible).toBe(true);
  });
});

describe("ACA premium tax credit (2026 applicable percentages, cliff restored)", () => {
  it("interpolates the applicable percentage within a band", () => {
    expect(acaApplicablePercent(120, aca)).toBeCloseTo(2.1, 6); // < 133% → flat 2.10%
    expect(acaApplicablePercent(175, aca)).toBeCloseTo(5.395, 6); // halfway through 150–200 (4.19→6.60)
    expect(acaApplicablePercent(200, aca)).toBeCloseTo(6.6, 6);
    expect(acaApplicablePercent(350, aca)).toBeCloseTo(9.96, 6); // 300–400 is flat 9.96%
    expect(acaApplicablePercent(450, aca)).toBeCloseTo(0, 6); // above 400% → no band (cliff)
    expect(acaCovered(350, aca)).toBe(true);
    expect(acaCovered(450, aca)).toBe(false);
  });

  it("credits the benchmark premium above the expected contribution (200% FPL, size 1)", () => {
    // 200% FPL for a household of 1 = $31,920; applicable % = 6.60%.
    const r = estimatePremiumTaxCredit(
      { householdSize: 1, annualIncome: 31920, benchmarkMonthlyPremium: 600 },
      aca,
      fpl,
    );
    expect(r.fplPercent).toBeCloseTo(200, 5);
    expect(r.applicablePercent).toBeCloseTo(6.6, 6);
    expect(r.expectedAnnualContribution.roundToCents().toNumber()).toBe(2106.72); // 31,920 × 6.6%
    expect(r.annualCredit.roundToCents().toNumber()).toBe(5093.28); // 7,200 − 2,106.72
    expect(r.monthlyCredit.roundToCents().toNumber()).toBe(424.44);
    expect(r.eligible).toBe(true);
    expect(r.belowMedicaidFloor).toBe(false);
  });

  it("gives no credit above the 400% FPL cliff (high income)", () => {
    // ~627% FPL → above the restored 400% cliff: no premium tax credit at all in 2026.
    const r = estimatePremiumTaxCredit(
      { householdSize: 1, annualIncome: 100000, benchmarkMonthlyPremium: 500 },
      aca,
      fpl,
    );
    expect(r.aboveSubsidyCap).toBe(true);
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
