import { describe, it, expect, beforeAll } from "vitest";
import { evaluateTaxes } from "../../src/engine/tax";
import { loadDatasets, type Datasets } from "../helpers/datasets";

/**
 * Hand-verified state and local cases (BUILD-SPEC.md §8, §9). Covers a graduated
 * state (CA, NY, DC), flat states (PA/IL/MI/GA/NC), no-income-tax states as
 * first-class records (TX, FL), special rules, and opt-in local add-ons (NYC,
 * Columbus). Each expected figure is computed by hand from the 2026 schedules.
 */
let ds: Datasets;
beforeAll(async () => {
  ds = await loadDatasets();
});

const cents = (m: { roundToCents(): { toString(): string } }): string =>
  m.roundToCents().toString();

describe("graduated states", () => {
  it("California single $50k → $1,192.53 (2025 Schedule X, std deduction $5,706)", () => {
    const r = evaluateTaxes(
      { filingStatus: "single", wages: 50000 },
      { federal: ds.federal, state: ds.state("ca"), fica: ds.fica },
    );
    // Taxable 44,294: 1%·11,079 + 2%·15,185 + 4%·15,188 + 6%·2,842 = 1,192.53.
    expect(cents(r.state!.incomeTax)).toBe("1192.53");
    // Combined: federal 3,820 + FICA 3,825 + CA 1,192.53.
    expect(cents(r.totals.totalTax)).toBe("8837.53");
    expect(cents(r.totals.takeHome)).toBe("41162.47");
    expect(r.totals.marginalRate).toBeCloseTo(0.2565, 5); // 12 + 7.65 + 6
  });

  it("New York single $100k (no NYC) → $4,859.75", () => {
    const r = evaluateTaxes(
      { filingStatus: "single", wages: 100000 },
      { federal: ds.federal, state: ds.state("ny"), fica: ds.fica },
    );
    expect(cents(r.state!.incomeTax)).toBe("4859.75");
    expect(r.local.lines).toHaveLength(0);
  });

  it("New York City resident single $100k adds the local tax", () => {
    const r = evaluateTaxes(
      { filingStatus: "single", wages: 100000, localJurisdictionIds: ["nyc"] },
      { federal: ds.federal, state: ds.state("ny"), fica: ds.fica },
    );
    expect(r.local.lines).toHaveLength(1);
    expect(r.local.lines[0]!.id).toBe("nyc");
    expect(cents(r.local.lines[0]!.tax)).toBe("3441.09");
    expect(cents(r.local.total)).toBe("3441.09");
  });

  it("DC single $60k → $2,453.50", () => {
    const r = evaluateTaxes(
      { filingStatus: "single", wages: 60000 },
      { federal: ds.federal, state: ds.state("dc"), fica: ds.fica },
    );
    expect(cents(r.state!.incomeTax)).toBe("2453.5");
  });

  it("Ohio single $60k → $933.63, plus opt-in Columbus 2.5%", () => {
    const base = evaluateTaxes(
      { filingStatus: "single", wages: 60000 },
      { federal: ds.federal, state: ds.state("oh"), fica: ds.fica },
    );
    expect(cents(base.state!.incomeTax)).toBe("933.63"); // 2.75%·(60,000−26,050)
    expect(base.local.lines).toHaveLength(0);

    const withCity = evaluateTaxes(
      { filingStatus: "single", wages: 60000, localJurisdictionIds: ["oh-columbus"] },
      { federal: ds.federal, state: ds.state("oh"), fica: ds.fica },
    );
    expect(cents(withCity.local.total)).toBe("1500"); // 2.5%·60,000
  });
});

describe("Virginia (graduated; the standard deduction and the $930 personal exemption stack)", () => {
  // Virginia's brackets (2% / 3% / 5% / 5.75% at $3k / $5k / $17k) are the same
  // for every filing status; only the standard deduction and exemption differ.
  // It is the first seeded *graduated* state that also grants a personal
  // exemption, so taxable income = AGI − standard deduction − exemption.
  it("single $60k → $2,635.90 (taxable 60,000 − 8,750 − 930 = 50,320)", () => {
    const r = evaluateTaxes(
      { filingStatus: "single", wages: 60000 },
      { federal: ds.federal, state: ds.state("va"), fica: ds.fica },
    );
    // 720 at $17,000 (2%·3,000 + 3%·2,000 + 5%·12,000) + 5.75%·(50,320 − 17,000).
    expect(cents(r.state!.incomeTax)).toBe("2635.9");
  });

  it("married jointly $60k → $2,079.30 (doubled deduction and exemption: 60,000 − 17,500 − 1,860)", () => {
    const r = evaluateTaxes(
      { filingStatus: "married_jointly", wages: 60000 },
      { federal: ds.federal, state: ds.state("va"), fica: ds.fica },
    );
    // Taxable 40,640: 720 + 5.75%·(40,640 − 17,000) = 720 + 1,359.30.
    expect(cents(r.state!.incomeTax)).toBe("2079.3");
  });
});

describe("Missouri (graduated; uniform brackets across statuses, federal-conformity deduction)", () => {
  // Missouri's eight-tier schedule (0% on the first $1,313, then 2%–4.5% in
  // $1,313 steps, top 4.7% above $9,191) is identical for every filing status,
  // and its standard deduction tracks the federal figure. It has no personal
  // exemption (TCJA conformity), so taxable income = AGI − standard deduction.
  // The fixed graduated portion below $9,191 is $256.035; everything above is 4.7%.
  it("single $60k → $1,887.36 (taxable 60,000 − 16,100 = 43,900)", () => {
    const r = evaluateTaxes(
      { filingStatus: "single", wages: 60000 },
      { federal: ds.federal, state: ds.state("mo"), fica: ds.fica },
    );
    // 256.035 + 4.7%·(43,900 − 9,191) = 256.035 + 1,631.323.
    expect(cents(r.state!.incomeTax)).toBe("1887.36");
  });

  it("married jointly $60k → $1,130.66 (taxable 60,000 − 32,200 = 27,800)", () => {
    const r = evaluateTaxes(
      { filingStatus: "married_jointly", wages: 60000 },
      { federal: ds.federal, state: ds.state("mo"), fica: ds.fica },
    );
    // 256.035 + 4.7%·(27,800 − 9,191) = 256.035 + 874.623.
    expect(cents(r.state!.incomeTax)).toBe("1130.66");
  });
});

describe("New Jersey (the first state whose graduated tiers differ by filing status)", () => {
  // NJ proves the engine's per-filing-status bracket support (previously deferred
  // because no seeded state used it). Single/MFS use Schedule A (7 brackets);
  // MFJ/HoH/QSS use Schedule B (8 brackets, with an extra 2.45% tier and wider
  // thresholds). No standard deduction; a $1,000 personal exemption ($2,000 joint).
  it("single $60k → $1,767.25 (Schedule A; taxable 60,000 − 1,000 = 59,000)", () => {
    const r = evaluateTaxes(
      { filingStatus: "single", wages: 60000 },
      { federal: ds.federal, state: ds.state("nj"), fica: ds.fica },
    );
    // 1.4%·20,000 + 1.75%·15,000 + 3.5%·5,000 + 5.525%·19,000 = 280 + 262.50 + 175 + 1,049.75.
    expect(cents(r.state!.incomeTax)).toBe("1767.25");
  });

  it("married jointly $60k → $1,001.00 (Schedule B; taxable 58,000 — far less than single)", () => {
    const r = evaluateTaxes(
      { filingStatus: "married_jointly", wages: 60000 },
      { federal: ds.federal, state: ds.state("nj"), fica: ds.fica },
    );
    // 1.4%·20,000 + 1.75%·30,000 + 2.45%·8,000 = 280 + 525 + 196.
    expect(cents(r.state!.incomeTax)).toBe("1001");
  });

  it("head of household uses Schedule B brackets with the single $1,000 exemption", () => {
    const r = evaluateTaxes(
      { filingStatus: "head_of_household", wages: 60000 },
      { federal: ds.federal, state: ds.state("nj"), fica: ds.fica },
    );
    // taxable 59,000 on Schedule B: 280 + 525 + 2.45%·9,000 = 280 + 525 + 220.50.
    expect(cents(r.state!.incomeTax)).toBe("1025.5");
  });

  it("the single and joint schedules genuinely differ at the same income", () => {
    const single = evaluateTaxes(
      { filingStatus: "single", wages: 60000 },
      { federal: ds.federal, state: ds.state("nj"), fica: ds.fica },
    );
    const joint = evaluateTaxes(
      { filingStatus: "married_jointly", wages: 60000 },
      { federal: ds.federal, state: ds.state("nj"), fica: ds.fica },
    );
    expect(single.state!.incomeTax.greaterThan(joint.state!.incomeTax)).toBe(true);
  });

  it("a qualifying surviving spouse falls back to the joint (Schedule B) schedule, not single", () => {
    const qss = evaluateTaxes(
      { filingStatus: "qualifying_surviving_spouse", wages: 60000 },
      { federal: ds.federal, state: ds.state("nj"), fica: ds.fica },
    );
    const joint = evaluateTaxes(
      { filingStatus: "married_jointly", wages: 60000 },
      { federal: ds.federal, state: ds.state("nj"), fica: ds.fica },
    );
    // QSS → married_jointly brackets; the exemption falls back to joint's $2,000 too.
    expect(cents(qss.state!.incomeTax)).toBe(cents(joint.state!.incomeTax));
  });
});

describe("Minnesota (the second per-filing-status state — same rates, different thresholds)", () => {
  // MN proves the per-status capability generalizes beyond NJ. The four rates
  // (5.35% / 6.8% / 7.85% / 9.85%) are identical across statuses, but the
  // thresholds differ (single crosses to 6.8% at $33,310, MFJ at $48,700, HoH at
  // $41,010), so the brackets-by-status arrays genuinely diverge. Standard
  // deduction $15,300 / $30,600 / $23,000; no personal exemption.
  it("married jointly $60k → $1,572.90 (taxable 29,400, all in the 5.35% band)", () => {
    const r = evaluateTaxes(
      { filingStatus: "married_jointly", wages: 60000 },
      { federal: ds.federal, state: ds.state("mn"), fica: ds.fica },
    );
    expect(cents(r.state!.incomeTax)).toBe("1572.9"); // 5.35%·(60,000 − 30,600)
  });

  it("head of household $60k → $1,979.50 (taxable 37,000, still in the 5.35% band)", () => {
    const r = evaluateTaxes(
      { filingStatus: "head_of_household", wages: 60000 },
      { federal: ds.federal, state: ds.state("mn"), fica: ds.fica },
    );
    expect(cents(r.state!.incomeTax)).toBe("1979.5"); // 5.35%·(60,000 − 23,000)
  });

  it("single $60k → $2,556.61 (taxable 44,700 crosses into the 6.8% band)", () => {
    const r = evaluateTaxes(
      { filingStatus: "single", wages: 60000 },
      { federal: ds.federal, state: ds.state("mn"), fica: ds.fica },
    );
    // 5.35%·33,310 + 6.8%·(44,700 − 33,310) = 1,782.085 + 774.52.
    expect(cents(r.state!.incomeTax)).toBe("2556.61");
  });

  it("single owes more than married jointly at the same income (narrower single bands)", () => {
    const single = evaluateTaxes(
      { filingStatus: "single", wages: 60000 },
      { federal: ds.federal, state: ds.state("mn"), fica: ds.fica },
    );
    const joint = evaluateTaxes(
      { filingStatus: "married_jointly", wages: 60000 },
      { federal: ds.federal, state: ds.state("mn"), fica: ds.fica },
    );
    expect(single.state!.incomeTax.greaterThan(joint.state!.incomeTax)).toBe(true);
  });

  it("a qualifying surviving spouse falls back to the married-jointly schedule", () => {
    const qss = evaluateTaxes(
      { filingStatus: "qualifying_surviving_spouse", wages: 60000 },
      { federal: ds.federal, state: ds.state("mn"), fica: ds.fica },
    );
    const joint = evaluateTaxes(
      { filingStatus: "married_jointly", wages: 60000 },
      { federal: ds.federal, state: ds.state("mn"), fica: ds.fica },
    );
    expect(cents(qss.state!.incomeTax)).toBe(cents(joint.state!.incomeTax));
  });
});

describe("Kansas (SB 1 two-bracket; per-status threshold, plus a standard deduction AND exemption)", () => {
  // KS (Senate Bill 1, 2024 special session) runs two rates — 5.20% then 5.58%
  // over $23,000 for "all other filers" (single/HoH/MFS) but over $46,000 for
  // married filing jointly. Taxable income = AGI − standard deduction − the
  // $9,160/$18,320 personal exemption, so both are stacked (the Virginia shape,
  // now on a per-status schedule).
  it("single $60k → $2,548.31 (taxable 60,000 − 3,605 − 9,160 = 47,235, crosses $23,000)", () => {
    const r = evaluateTaxes(
      { filingStatus: "single", wages: 60000 },
      { federal: ds.federal, state: ds.state("ks"), fica: ds.fica },
    );
    // 5.2%·23,000 + 5.58%·(47,235 − 23,000) = 1,196 + 1,352.313.
    expect(cents(r.state!.incomeTax)).toBe("2548.31");
  });

  it("married jointly $60k → $1,738.88 (taxable 33,440, all under the $46,000 threshold)", () => {
    const r = evaluateTaxes(
      { filingStatus: "married_jointly", wages: 60000 },
      { federal: ds.federal, state: ds.state("ks"), fica: ds.fica },
    );
    expect(cents(r.state!.incomeTax)).toBe("1738.88"); // 5.2%·(60,000 − 8,240 − 18,320)
  });

  it("head of household uses the $23,000 'all other filers' threshold → $2,404.63", () => {
    const r = evaluateTaxes(
      { filingStatus: "head_of_household", wages: 60000 },
      { federal: ds.federal, state: ds.state("ks"), fica: ds.fica },
    );
    // taxable 60,000 − 6,180 − 9,160 = 44,660: 5.2%·23,000 + 5.58%·21,660.
    expect(cents(r.state!.incomeTax)).toBe("2404.63");
  });

  it("single owes more than married jointly at the same income (single threshold is half)", () => {
    const single = evaluateTaxes(
      { filingStatus: "single", wages: 60000 },
      { federal: ds.federal, state: ds.state("ks"), fica: ds.fica },
    );
    const joint = evaluateTaxes(
      { filingStatus: "married_jointly", wages: 60000 },
      { federal: ds.federal, state: ds.state("ks"), fica: ds.fica },
    );
    expect(single.state!.incomeTax.greaterThan(joint.state!.incomeTax)).toBe(true);
  });

  it("a qualifying surviving spouse falls back to the married-jointly schedule", () => {
    const qss = evaluateTaxes(
      { filingStatus: "qualifying_surviving_spouse", wages: 60000 },
      { federal: ds.federal, state: ds.state("ks"), fica: ds.fica },
    );
    const joint = evaluateTaxes(
      { filingStatus: "married_jointly", wages: 60000 },
      { federal: ds.federal, state: ds.state("ks"), fica: ds.fica },
    );
    expect(cents(qss.state!.incomeTax)).toBe(cents(joint.state!.incomeTax));
  });
});

describe("Delaware (seven-tier graduated; uniform brackets across statuses — the marriage penalty)", () => {
  // DE's rate schedule (30 Del. C. §1102, unchanged for tax years 2014 and
  // later) is identical for every filing status: 0% to $2,000, then 2.2% / 3.9%
  // / 4.8% / 5.2% / 5.55% / 6.6% over $2k / $5k / $10k / $20k / $25k / $60k.
  // Delaware does NOT double the brackets for joint filers, so a couple's only
  // relief is the larger standard deduction ($3,250 single / $6,500 joint,
  // §1108) — a built-in marriage penalty. No personal exemption (replaced by a
  // $110-per-exemption credit, omitted at launch fidelity).
  it("single $60k → $2,763.13 (taxable 60,000 − 3,250 = 56,750)", () => {
    const r = evaluateTaxes(
      { filingStatus: "single", wages: 60000 },
      { federal: ds.federal, state: ds.state("de"), fica: ds.fica },
    );
    // $1,001 base at $25,000 + 5.55%·(56,750 − 25,000) = 1,001 + 1,762.125.
    expect(cents(r.state!.incomeTax)).toBe("2763.13");
  });

  it("married jointly $60k → $2,582.75 (taxable 53,500; only the deduction differs)", () => {
    const r = evaluateTaxes(
      { filingStatus: "married_jointly", wages: 60000 },
      { federal: ds.federal, state: ds.state("de"), fica: ds.fica },
    );
    // $1,001 base + 5.55%·(53,500 − 25,000) = 1,001 + 1,581.75.
    expect(cents(r.state!.incomeTax)).toBe("2582.75");
  });

  it("head of household uses the single standard deduction → $2,763.13", () => {
    const r = evaluateTaxes(
      { filingStatus: "head_of_household", wages: 60000 },
      { federal: ds.federal, state: ds.state("de"), fica: ds.fica },
    );
    expect(cents(r.state!.incomeTax)).toBe("2763.13");
  });

  it("the marriage penalty: joint owes nearly as much as single (brackets are not doubled)", () => {
    const single = evaluateTaxes(
      { filingStatus: "single", wages: 60000 },
      { federal: ds.federal, state: ds.state("de"), fica: ds.fica },
    );
    const joint = evaluateTaxes(
      { filingStatus: "married_jointly", wages: 60000 },
      { federal: ds.federal, state: ds.state("de"), fica: ds.fica },
    );
    // Single owes more, but a doubled-bracket state would put joint far lower;
    // here joint stays above 90% of single because only the deduction differs.
    expect(single.state!.incomeTax.greaterThan(joint.state!.incomeTax)).toBe(true);
    expect(joint.state!.incomeTax.greaterThan(single.state!.incomeTax.multiply(0.9))).toBe(true);
  });

  it("a qualifying surviving spouse falls back to the married-jointly schedule", () => {
    const qss = evaluateTaxes(
      { filingStatus: "qualifying_surviving_spouse", wages: 60000 },
      { federal: ds.federal, state: ds.state("de"), fica: ds.fica },
    );
    const joint = evaluateTaxes(
      { filingStatus: "married_jointly", wages: 60000 },
      { federal: ds.federal, state: ds.state("de"), fica: ds.fica },
    );
    expect(cents(qss.state!.incomeTax)).toBe(cents(joint.state!.incomeTax));
  });
});

describe("flat-rate states", () => {
  const cases: Array<[string, number, string]> = [
    ["pa", 60000, "1842"], // 3.07%·60,000, no deduction
    ["il", 60000, "2832.64"], // 4.95%·(60,000 − 2,775 exemption)
    ["mi", 60000, "2312"], // 4.25%·(60,000 − 5,600 exemption)
    ["ga", 60000, "2395.2"], // 4.99%·(60,000 − 12,000 std)
    ["nc", 60000, "1885.28"], // 3.99%·(60,000 − 12,750 std)
    ["az", 60000, "1097.5"], // 2.5%·(60,000 − 16,100 federal std)
    ["co", 60000, "1931.6"], // 4.4%·(60,000 − 16,100 federal std)
    ["in", 60000, "1740.5"], // 2.95%·(60,000 − 1,000 exemption), no std
    ["ky", 60000, "1982.4"], // 3.5%·(60,000 − 3,360 std)
    ["ma", 60000, "2780"], // 5.0%·(60,000 − 4,400 exemption), below the surtax
    ["ms", 60000, "1668"], // 0% on first $10k of taxable, 4.0%·(51,700 − 10,000)
    ["id", 60000, "2326.7"], // 5.3%·(60,000 − 16,100 federal std), HB 40 flat
    ["la", 60000, "1413.75"], // 3.0%·(60,000 − 12,875 std), Act 11 flat (2026 indexed)
    ["ia", 60000, "1668.2"], // 3.8%·(60,000 − 16,100 federal std), SF 2442 flat
  ];
  for (const [code, wages, expected] of cases) {
    it(`${code.toUpperCase()} single $${wages.toLocaleString()} → $${expected}`, () => {
      const r = evaluateTaxes(
        { filingStatus: "single", wages },
        { federal: ds.federal, state: ds.state(code), fica: ds.fica },
      );
      expect(cents(r.state!.incomeTax)).toBe(expected);
    });
  }
});

describe("Louisiana flat 3% with the $25,750 head-of-household deduction (2026 indexed)", () => {
  // Louisiana's standard deduction is $25,750 for MFJ *and* head of household
  // (Act 11, 2026 CPI-indexed), unlike the federal split where HoH sits below
  // MFJ — so HoH and MFJ owe the same flat 3% tax at equal income.
  it("married jointly and head of household both → $1,027.50 at $60k (60,000 − 25,750)·3%", () => {
    const mfj = evaluateTaxes(
      { filingStatus: "married_jointly", wages: 60000 },
      { federal: ds.federal, state: ds.state("la"), fica: ds.fica },
    );
    const hoh = evaluateTaxes(
      { filingStatus: "head_of_household", wages: 60000 },
      { federal: ds.federal, state: ds.state("la"), fica: ds.fica },
    );
    expect(cents(mfj.state!.incomeTax)).toBe("1027.5");
    expect(cents(hoh.state!.incomeTax)).toBe("1027.5");
  });
});

describe("Utah taxpayer tax credit (a credit standing in for a standard deduction)", () => {
  // Utah taxes federal AGI at 4.45% (SB 60, 2026), then subtracts a nonrefundable
  // taxpayer tax credit = 6%·(federal deduction) − 1.3%·(AGI − base), floored at 0.
  it("single $60k → $2,247.23 (4.45%·60,000 − [6%·16,100 − 1.3%·(60,000−18,213)])", () => {
    const r = evaluateTaxes(
      { filingStatus: "single", wages: 60000 },
      { federal: ds.federal, state: ds.state("ut"), fica: ds.fica },
    );
    // 2,670 − (966 − 543.231) = 2,670 − 422.769 = 2,247.231.
    expect(cents(r.state!.incomeTax)).toBe("2247.23");
  });

  it("married jointly $60k → $1,044.46 (larger deduction and base)", () => {
    const r = evaluateTaxes(
      { filingStatus: "married_jointly", wages: 60000 },
      { federal: ds.federal, state: ds.state("ut"), fica: ds.fica },
    );
    // 2,670 − (6%·32,200 − 1.3%·(60,000−36,426)) = 2,670 − (1,932 − 306.462).
    expect(cents(r.state!.incomeTax)).toBe("1044.46");
  });

  it("is nonrefundable: a low earner whose credit exceeds the tax owes $0", () => {
    const r = evaluateTaxes(
      { filingStatus: "single", wages: 18000 },
      { federal: ds.federal, state: ds.state("ut"), fica: ds.fica },
    );
    // Below the base the full 6%·16,100 = 966 credit exceeds 4.45%·18,000 = 801.
    expect(r.state!.incomeTax.isZero()).toBe(true);
  });

  it("the credit phase-out lifts the state marginal rate to 5.75% (4.45% + 1.3%) in its band", () => {
    const at60 = evaluateTaxes(
      { filingStatus: "single", wages: 60000 },
      { federal: ds.federal, state: ds.state("ut"), fica: ds.fica },
    );
    const at61 = evaluateTaxes(
      { filingStatus: "single", wages: 61000 },
      { federal: ds.federal, state: ds.state("ut"), fica: ds.fica },
    );
    const deltaState = at61.state!.incomeTax.subtract(at60.state!.incomeTax);
    expect(cents(deltaState)).toBe("57.5"); // 5.75% of the extra $1,000
  });
});

describe("no-income-tax states are first-class records", () => {
  // All nine states that levy no personal income tax on wages (BUILD-SPEC.md §8):
  // TX and FL at launch, plus AK, NV, NH, SD, TN, WA, WY added as first-class
  // records so a resident of any of them sees their state by name.
  for (const code of ["tx", "fl", "ak", "nv", "nh", "sd", "tn", "wa", "wy"]) {
    it(`${code.toUpperCase()} levies no state or local income tax`, () => {
      const r = evaluateTaxes(
        { filingStatus: "single", wages: 80000 },
        { federal: ds.federal, state: ds.state(code), fica: ds.fica },
      );
      expect(r.state!.incomeTax.isZero()).toBe(true);
      expect(r.local.total.isZero()).toBe(true);
      // Total tax equals federal + FICA only.
      const fedOnly = evaluateTaxes(
        { filingStatus: "single", wages: 80000 },
        { federal: ds.federal, fica: ds.fica },
      );
      expect(cents(r.totals.totalTax)).toBe(cents(fedOnly.totals.totalTax));
    });
  }
});

describe("Massachusetts 4% millionaire surtax (top bracket)", () => {
  it("adds the 4% surtax (9% total) on taxable income over $1,107,750", () => {
    const over = evaluateTaxes(
      { filingStatus: "single", wages: 1200000 },
      { federal: ds.federal, state: ds.state("ma"), fica: ds.fica },
    );
    // MA taxable = 1,200,000 − 4,400 exemption = 1,195,600. Below the surtax a
    // flat 5% would be 59,780; the 9% top band on the excess pushes it higher.
    const flatFive = 1195600 * 0.05;
    expect(Number(cents(over.state!.incomeTax))).toBeGreaterThan(flatFive);
    // 5%·1,107,750 + 9%·(1,195,600 − 1,107,750) = 55,387.50 + 7,906.50 = 63,294.
    expect(cents(over.state!.incomeTax)).toBe("63294");
  });
});

describe("California behavioral-health-services surtax (special rule)", () => {
  it("adds 1% on taxable income over $1,000,000", () => {
    const r = evaluateTaxes(
      { filingStatus: "single", wages: 1100000 },
      { federal: ds.federal, state: ds.state("ca"), fica: ds.fica },
    );
    // CA taxable = 1,100,000 − 5,706 = 1,094,294; surtax = 1%·(1,094,294 − 1,000,000) = 942.94.
    const noSurtax = evaluateTaxes(
      { filingStatus: "single", wages: 1000000 },
      { federal: ds.federal, state: ds.state("ca"), fica: ds.fica },
    );
    expect(r.state!.incomeTax.greaterThan(noSurtax.state!.incomeTax)).toBe(true);
  });
});
