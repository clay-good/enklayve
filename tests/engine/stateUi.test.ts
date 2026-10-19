import { describe, it, expect, beforeAll } from "vitest";
import { estimateUi } from "../../src/engine/stateUi";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { StateUiSchema, type StateUiData } from "../../src/data/schemas";

let data: BundledData;
let ca: StateUiData;
let tx: StateUiData;
let fl: StateUiData;
beforeAll(async () => {
  data = await loadBundledData();
  ca = data.stateUi("ca")!;
  tx = data.stateUi("tx")!;
  fl = data.stateUi("fl")!;
});

describe("the bundled state set", () => {
  it("bundles the most populous states first, each schema-valid", () => {
    expect(data.stateUiCodes()).toEqual(["ca", "tx", "fl"]);
    for (const code of data.stateUiCodes()) {
      expect(StateUiSchema.safeParse(data.stateUi(code)).success).toBe(true);
    }
  });

  it("gives no estimate for a state with no rule set, rather than a typical one", () => {
    // The spec's gate: a "typical state" figure is worse than nothing.
    expect(data.stateUi("wy")).toBeNull();
  });
});

describe("California (DE 1101BT5, DE 2320)", () => {
  it("divides the high quarter by 26 and rounds up, the table's own rule", () => {
    // $10,000 / 26 = 384.62 → $385. Total: lesser of 26 × 385 = $10,010 and half
    // of $34,000 = $17,000.
    const r = estimateUi({ quarterlyWages: [10000, 9000, 8000, 7000] }, ca);
    expect(r.eligible).toBe(true);
    expect(r.weeklyBenefit).toBe(385);
    expect(r.maxBenefit).toBe(10010);
    expect(r.maxBenefitBasis).toBe("weeks");
    expect(r.weeks).toBe(26);
  });

  it("reads the low-wage schedule where no divisor reproduces the table", () => {
    // $1,832.99 sits on the $1,807.00 – $1,832.99 → $70 row; $1,833 is the first
    // figure the divisor serves: 1,833 / 26 = 70.5 → $71.
    expect(estimateUi({ quarterlyWages: [1832.99, 1832.99, 0, 0] }, ca).weeklyBenefit).toBe(70);
    expect(estimateUi({ quarterlyWages: [1833, 1833, 0, 0] }, ca).weeklyBenefit).toBe(71);
    expect(estimateUi({ quarterlyWages: [900, 300, 0, 0] }, ca).weeklyBenefit).toBe(40);
  });

  it("qualifies on the second path: $900 in the high quarter and 1.25 times it in total", () => {
    // $1,200 high quarter (row $1,196 → $50), $1,500 total = exactly 1.25 × 1,200.
    // Total: lesser of 26 × 50 = $1,300 and half of $1,500 = $750.
    const r = estimateUi({ quarterlyWages: [1200, 300, 0, 0] }, ca);
    expect(r.eligible).toBe(true);
    expect(r.weeklyBenefit).toBe(50);
    expect(r.maxBenefit).toBe(750);
    expect(r.maxBenefitBasis).toBe("share-of-base-period");
    expect(r.weeks).toBe(15);

    // A dollar under 1.25 times, and under $1,300: neither path.
    const short = estimateUi({ quarterlyWages: [1200, 299, 0, 0] }, ca);
    expect(short.eligible).toBe(false);
    expect(short.weeklyTotal).toBe(0);
  });

  it("caps at $450 and refuses below the table's first row", () => {
    expect(estimateUi({ quarterlyWages: [20000, 20000, 0, 0] }, ca).weeklyBenefit).toBe(450);
    expect(estimateUi({ quarterlyWages: [899.99, 899.99, 899.99, 0] }, ca).eligible).toBe(false);
  });
});

describe("Texas (Labor Code §§207.002, 207.005, 207.006, 207.021)", () => {
  it("divides by 25, rounds up per §207.006, and caps the total at 27%", () => {
    // $12,000 / 25 = $480. Total: lesser of 26 × 480 = $12,480 and 27% of
    // $36,000 = $9,720. 9,720 / 480 = 20.25 → 21 weeks of payments.
    const r = estimateUi({ quarterlyWages: [12000, 10000, 8000, 6000] }, tx);
    expect(r.weeklyBenefit).toBe(480);
    expect(r.maxBenefit).toBe(9720);
    expect(r.maxBenefitBasis).toBe("share-of-base-period");
    expect(r.weeks).toBe(21);
  });

  it("rounds a fractional benefit UP, the statute's word, not the page's", () => {
    // $10,001 / 25 = 400.04 → $401 (TWC's page says "nearest", which gives $400).
    expect(estimateUi({ quarterlyWages: [10001, 10000, 0, 0] }, tx).weeklyBenefit).toBe(401);
  });

  it("needs wages in two quarters and 37 times the weekly benefit", () => {
    expect(estimateUi({ quarterlyWages: [9000, 0, 0, 0] }, tx).eligible).toBe(false);
    // $1,500 / 25 = $60, raised to the $76 minimum; 37 × 76 = $2,812 > $2,000.
    const r = estimateUi({ quarterlyWages: [1500, 500, 0, 0] }, tx);
    expect(r.eligible).toBe(false);
    expect(r.shortfalls.join(" ")).toContain("37 times");
  });

  it("holds the October 4, 2026 range, $76 to $619", () => {
    expect(estimateUi({ quarterlyWages: [40000, 40000, 40000, 40000] }, tx).weeklyBenefit).toBe(
      619,
    );
    expect(estimateUi({ quarterlyWages: [1500, 1500, 0, 0] }, tx).weeklyBenefit).toBe(76);
  });
});

describe("Florida (Fla. Stat. §443.111)", () => {
  it("divides by 26 and rounds DOWN, $32 to $275, twelve weeks", () => {
    // $7,150 / 26 = $275 exactly. Total: lesser of 25% of $28,600 = $7,150,
    // 275 × 12 = $3,300, and $6,325.
    const r = estimateUi({ quarterlyWages: [7150, 7150, 7150, 7150] }, fl);
    expect(r.weeklyBenefit).toBe(275);
    expect(r.maxBenefit).toBe(3300);
    expect(r.weeks).toBe(12);
  });

  it("caps the total at a quarter of base-period wages", () => {
    // $5,000 / 26 = 192.31 → $192. 25% of $8,000 = $2,000 < 192 × 12 = $2,304.
    const r = estimateUi({ quarterlyWages: [5000, 3000, 0, 0] }, fl);
    expect(r.eligible).toBe(true);
    expect(r.weeklyBenefit).toBe(192);
    expect(r.maxBenefit).toBe(2000);
    expect(r.maxBenefitBasis).toBe("share-of-base-period");
    expect(r.weeks).toBe(11);
  });

  it("needs 1.5 times the high quarter and at least $3,400", () => {
    // 1.5 × 5,000 = 7,500 > 7,000.
    expect(estimateUi({ quarterlyWages: [5000, 2000, 0, 0] }, fl).eligible).toBe(false);
    // Exactly 1.5 times qualifies — the statute says "equal to".
    expect(estimateUi({ quarterlyWages: [3000, 1500, 0, 0] }, fl).eligible).toBe(true);
    // 1.5 times, but under $3,400 in total.
    expect(estimateUi({ quarterlyWages: [2000, 1000, 0, 0] }, fl).eligible).toBe(false);
  });
});

describe("inputs that are not wages", () => {
  it("treats negative and non-finite quarters as zero, never as a figure", () => {
    const r = estimateUi({ quarterlyWages: [Number.NaN, -500, Infinity, 0] }, tx);
    expect(r.eligible).toBe(false);
    expect(Number.isFinite(r.maxBenefit)).toBe(true);
  });
});
