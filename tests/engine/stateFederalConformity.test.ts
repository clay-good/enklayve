import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, beforeAll } from "vitest";
import { evaluateTaxes } from "../../src/engine/tax";
import { loadDatasets } from "../helpers/datasets";

/**
 * The federal deductions a state gives without legislating one.
 *
 * §63(b) reaches taxable income by subtracting seven things from AGI, five of
 * them the One Big Beautiful Bill Act's new deductions. A state whose income
 * tax starts from FEDERAL TAXABLE INCOME has therefore already allowed all five
 * — the deduction is in the number it starts from — unless it legislates an
 * addback. This engine started every state at AGI and stopped at the standard
 * deduction, so a tipped worker in North Dakota was being shown state tax on
 * income North Dakota does not tax.
 *
 * Six states carry the block, each read from its own law, and two of the six
 * add exactly one deduction back — different ones:
 *
 *   CO  C.R.S. §39-22-104, and the Department of Revenue's own guide: overtime
 *       is added back for 2026 and later (HB25-1296), tips explicitly are not.
 *   IA  The Department of Revenue, in its own words: "The starting point for
 *       Iowa taxable income is federal taxable income ... Iowa will conform".
 *   ID  Idaho Code §63-3004, the IRC "as amended and in effect on the first day
 *       of January 2026" — static conformity that has caught up to the Act.
 *   MT  MCA §15-30-2120(1), federal taxable income, adding back only §199A and
 *       the §164(a)(3) state income tax deduction.
 *   ND  N.D.C.C. §57-38-30.3(2), federal taxable income "as amended", with nine
 *       adjustments that touch none of this.
 *   OR  Enrolled SB 1507 (2026, ch. 142) §2 adds back qualified passenger
 *       vehicle loan interest, and only that.
 *
 * New Mexico is the case that makes the block's ABSENCE mean something: it
 * starts from federal adjusted gross income and subtracts "an amount equal to
 * the standard deduction allowed ... by Section 63" (NMSA 1978 §7-2-2), which is
 * §63(c) alone. It looks like a conformity state and is not one.
 */
const CONFORMING = ["co", "ia", "id", "mt", "nd", "or"] as const;

/** A wage earner with one of each deduction, over no phase-out threshold. */
const FILER = {
  filingStatus: "single" as const,
  wages: 62_000,
  qualifiedTips: 4000,
  qualifiedOvertime: 2000,
  vehicleLoanInterest: 1500,
  seniorsAge65Plus: 1,
  itemized: { charitable: 1000 },
  deductionMode: "standard" as const,
};

describe("states that start from federal taxable income", () => {
  let ds: Awaited<ReturnType<typeof loadDatasets>>;
  const state = (code: string) => ds.state(code);
  /** Every state shard in the manifest, so the sweep below cannot miss one. */
  const codes = (
    JSON.parse(readFileSync(resolve(__dirname, "..", "..", "data", "manifest.json"), "utf8")) as {
      datasets: { id: string }[];
    }
  ).datasets
    .map((d) => /^state-([a-z]{2})-income-tax-/.exec(d.id)?.[1])
    .filter((c): c is string => !!c);
  beforeAll(async () => {
    ds = await loadDatasets();
  });

  it("carries a conformity block on exactly the four verified states", () => {
    const carrying = codes.filter((c) => state(c).federalDeductionConformity).sort();
    expect(carrying).toEqual([...CONFORMING]);
    expect(ds.federal.federalDeductionConformity).toBeUndefined();
  });

  it("deducts all five in North Dakota, Montana, Idaho, and Iowa", () => {
    for (const code of ["nd", "mt", "id", "ia"]) {
      const r = evaluateTaxes(FILER, { federal: ds.federal, state: state(code), fica: ds.fica });
      const d = r.state!.deduction;
      expect([
        d.nonItemizedCharitable.toNumber(),
        d.senior.toNumber(),
        d.qualifiedTips.toNumber(),
        d.qualifiedOvertime.toNumber(),
        d.vehicleLoanInterest.toNumber(),
      ]).toEqual([1000, 6000, 4000, 2000, 1500]);
      expect(r.federal.deduction.qualifiedTips.toNumber()).toBe(4000);
    }
  });

  it("adds Oregon's car loan interest back and leaves the other four alone", () => {
    // SB 1507 §2, the one addback Oregon legislated: "There shall be added to
    // federal taxable income an amount equal to qualified passenger vehicle loan
    // interest ... as provided in section 163(h)(4)". Colorado adds back a
    // different single deduction, which is why one boolean would not do.
    const r = evaluateTaxes(FILER, { federal: ds.federal, state: state("or"), fica: ds.fica });
    const d = r.state!.deduction;
    expect(d.vehicleLoanInterest.toNumber()).toBe(0);
    expect(d.qualifiedTips.toNumber()).toBe(4000);
    expect(d.qualifiedOvertime.toNumber()).toBe(2000);
    expect(d.senior.toNumber()).toBe(6000);
    expect(d.nonItemizedCharitable.toNumber()).toBe(1000);
  });

  it("adds Colorado's overtime back and leaves its tips alone", () => {
    // The one place the five answers are not the same answer, and the reason
    // the shard carries five booleans rather than one.
    const r = evaluateTaxes(FILER, { federal: ds.federal, state: state("co"), fica: ds.fica });
    const d = r.state!.deduction;
    expect(d.qualifiedTips.toNumber()).toBe(4000);
    expect(d.qualifiedOvertime.toNumber()).toBe(0);
    expect(d.senior.toNumber()).toBe(6000);
    expect(d.vehicleLoanInterest.toNumber()).toBe(1500);
  });

  it("lowers the state tax by the state rate times what it inherits", () => {
    // At $95,000 both returns clear North Dakota's $44,725 zero-rate band, so
    // the whole inherited amount is taxed at 1.95% and the saving is visible in
    // dollars: this is state tax a tipped North Dakotan was charged and does not
    // owe. The inherited figure is read off the result rather than written here,
    // since the senior deduction is mid-phase-out at this income.
    const ctx = { federal: ds.federal, state: state("nd"), fica: ds.fica };
    const income = { ...FILER, wages: 95_000 };
    const bare = evaluateTaxes({ filingStatus: "single", wages: 95_000 }, ctx);
    const withAll = evaluateTaxes(income, ctx);
    const d = withAll.state!.deduction;
    const inherited = d.nonItemizedCharitable
      .add(d.senior)
      .add(d.qualifiedTips)
      .add(d.qualifiedOvertime)
      .add(d.vehicleLoanInterest)
      .toNumber();
    expect(inherited).toBe(1000 + 4800 + 4000 + 2000 + 1500);
    expect(bare.state!.taxableIncome.subtract(withAll.state!.taxableIncome).toNumber()).toBe(
      inherited,
    );
    expect(bare.state!.incomeTax.subtract(withAll.state!.incomeTax).toNumber()).toBeCloseTo(
      inherited * 0.0195,
      2,
    );
  });

  it("changes nothing for a state that starts from adjusted gross income", () => {
    // New Mexico looks like conformity — it even uses the federal standard
    // deduction figures — and subtracts only §63(c), so nothing here reaches it.
    // California is the ordinary case: its own deduction, its own starting point.
    for (const code of ["nm", "ca", "ny"]) {
      const ctx = { federal: ds.federal, state: state(code), fica: ds.fica };
      const bare = evaluateTaxes({ filingStatus: "single", wages: 62_000 }, ctx);
      const withAll = evaluateTaxes(FILER, ctx);
      expect(withAll.state!.taxableIncome.toNumber()).toBe(bare.state!.taxableIncome.toNumber());
      expect(withAll.state!.deduction.qualifiedTips.toNumber()).toBe(0);
    }
  });

  it("inherits the phased-down amount, not the amount claimed", () => {
    // The state starts from a figure the federal phase-out has already been
    // applied to, so a Montanan over §224's threshold inherits what is left.
    const ctx = { federal: ds.federal, state: state("mt"), fica: ds.fica };
    const r = evaluateTaxes({ filingStatus: "single", wages: 175_000, qualifiedTips: 25_000 }, ctx);
    // $175,000 is 25 completed thousands over $150,000: $25,000 − 25 × $100.
    expect(r.federal.deduction.qualifiedTips.toNumber()).toBe(22_500);
    expect(r.state!.deduction.qualifiedTips.toNumber()).toBe(22_500);
  });

  it("does not let a conformed deduction push state taxable income below zero", () => {
    const ctx = { federal: ds.federal, state: state("nd"), fica: ds.fica };
    const r = evaluateTaxes(
      { filingStatus: "single", wages: 20_000, qualifiedTips: 20_000, seniorsAge65Plus: 1 },
      ctx,
    );
    expect(r.state!.taxableIncome.toNumber()).toBe(0);
    expect(r.state!.incomeTax.toNumber()).toBe(0);
  });
});
