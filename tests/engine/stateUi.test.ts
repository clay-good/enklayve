import { describe, it, expect, beforeAll } from "vitest";
import { estimateUi } from "../../src/engine/stateUi";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { StateUiSchema, type StateUiData } from "../../src/data/schemas";

let data: BundledData;
let ca: StateUiData;
let tx: StateUiData;
let fl: StateUiData;
let ny: StateUiData;
let pa: StateUiData;
beforeAll(async () => {
  data = await loadBundledData();
  ca = data.stateUi("ca")!;
  tx = data.stateUi("tx")!;
  fl = data.stateUi("fl")!;
  ny = data.stateUi("ny")!;
  pa = data.stateUi("pa")!;
});

describe("the bundled state set", () => {
  it("bundles the most populous states first, each schema-valid", () => {
    expect(data.stateUiCodes()).toEqual(["ca", "tx", "fl", "ny", "pa"]);
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

describe("New York (P832, Labor Law §§527, 590)", () => {
  it("divides by 26 with wages in all four quarters, rounding down", () => {
    // $10,000 / 26 = 384.62 → $384; 26 weeks.
    const r = estimateUi({ quarterlyWages: [10000, 9000, 8000, 7000] }, ny);
    expect(r.weeklyBenefit).toBe(384);
    expect(r.maxBenefit).toBe(9984);
    expect(r.weeks).toBe(26);
  });

  it("averages the two highest quarters with wages in only two or three — P832's own example", () => {
    // ($4,500 + $4,288) / 2 = $4,394; / 26 = $169.
    const r = estimateUi({ quarterlyWages: [4500, 4288, 0, 0] }, ny);
    expect(r.weeklyBenefit).toBe(169);
    expect(r.weeklyBasis).toBe("average");
  });

  it("divides a low earner's quarter by 25, and floors everyone above at $143", () => {
    // $3,550 / 25 = $142 — at or below $3,575, so no floor.
    expect(estimateUi({ quarterlyWages: [3550, 2000, 1000, 500] }, ny).weeklyBenefit).toBe(142);
    // $3,700 / 26 = 142.31 → $142, under the $143 floor that applies above $3,575.
    const floored = estimateUi({ quarterlyWages: [3700, 3700, 3700, 3700] }, ny);
    expect(floored.weeklyBenefit).toBe(143);
    expect(floored.weeklyBasis).toBe("floor");
    // Two quarters and $3,576–$4,000: the high quarter alone, / 26 = $150.
    expect(estimateUi({ quarterlyWages: [3900, 2000, 0, 0] }, ny).weeklyBenefit).toBe(150);
  });

  it("caps the high quarter in the 1.5x test at $19,118 — $9,559 in the other quarters", () => {
    const r = estimateUi({ quarterlyWages: [30000, 9559, 0, 0] }, ny);
    expect(r.eligible).toBe(true);
    // (30,000 + 9,559) / 2 / 26 = 760.75 → $760.
    expect(r.weeklyBenefit).toBe(760);
    expect(estimateUi({ quarterlyWages: [30000, 9558, 0, 0] }, ny).eligible).toBe(false);
  });

  it("needs $3,500 in a quarter for 2026, and holds $869 as the maximum", () => {
    expect(estimateUi({ quarterlyWages: [3499, 3000, 3000, 3000] }, ny).eligible).toBe(false);
    expect(estimateUi({ quarterlyWages: [3500, 3000, 0, 0] }, ny).weeklyBenefit).toBe(140);
    expect(estimateUi({ quarterlyWages: [30000, 30000, 30000, 30000] }, ny).weeklyBenefit).toBe(
      869,
    );
  });
});

describe("Pennsylvania (§404(e) table, 56 Pa.B. 448, L&I benefit guide)", () => {
  it("reads the rate off the table — L&I's own $7,500 example", () => {
    // Row (7,500 − 1,688) / 25 = 232; 98% of (69 + 232) = 294.98 → $295. Its
    // qualifying wages: (7,488 + 24) / 0.63 = 11,923.8 → $11,924.
    const r = estimateUi({ quarterlyWages: [7500, 2000, 1500, 924], creditWeeks: 26 }, pa);
    expect(r.eligible).toBe(true);
    expect(r.weeklyBenefit).toBe(295);
    expect(r.weeklyBasis).toBe("table");
    // A $295 rate less the 3.2% payment reduction pays $285 a week.
    expect(r.weeklyPaid).toBe(285);
    expect(r.maxBenefit).toBe(7670);
  });

  it("steps down a row when the total is a dollar short of the row's qualifying wages", () => {
    // $11,923 < $11,924, so row 231: (7,463 + 24) / 0.63 → $11,885, met; rate $294.
    const r = estimateUi({ quarterlyWages: [7500, 2000, 1500, 923], creditWeeks: 26 }, pa);
    expect(r.weeklyBenefit).toBe(294);
    expect(r.weeklyBasis).toBe("stepped-down");
  });

  it("pays for as many weeks as there are credit weeks, from 18 to 26", () => {
    const twenty = estimateUi({ quarterlyWages: [7500, 2000, 1500, 924], creditWeeks: 20 }, pa);
    expect(twenty.maxBenefit).toBe(5900);
    expect(twenty.weeks).toBe(20);
    expect(
      estimateUi({ quarterlyWages: [7500, 2000, 1500, 924], creditWeeks: 17 }, pa).eligible,
    ).toBe(false);
  });

  it("pays $585 on the $605 maximum — the FAQ's own figure — and adds dependents", () => {
    const max = estimateUi({ quarterlyWages: [15388, 5000, 5000, 5000], creditWeeks: 26 }, pa);
    expect(max.weeklyBenefit).toBe(605);
    expect(max.weeklyPaid).toBe(585);
    const withTwo = estimateUi(
      { quarterlyWages: [15388, 5000, 5000, 5000], creditWeeks: 26, dependents: 3 },
      pa,
    );
    // $5 + $3, capped at two allowances.
    expect(withTwo.dependentAllowance).toBe(8);
  });

  it("needs 37% of base-period wages outside the high quarter", () => {
    const r = estimateUi({ quarterlyWages: [10000, 1000, 1000, 1000], creditWeeks: 26 }, pa);
    expect(r.eligible).toBe(false);
    expect(r.shortfalls.join(" ")).toContain("37%");
    expect(
      estimateUi({ quarterlyWages: [1687, 1687, 1687, 1687], creditWeeks: 26 }, pa).eligible,
    ).toBe(false);
  });
});

describe("inputs that are not wages", () => {
  it("treats negative and non-finite quarters as zero, never as a figure", () => {
    const r = estimateUi({ quarterlyWages: [Number.NaN, -500, Infinity, 0] }, tx);
    expect(r.eligible).toBe(false);
    expect(Number.isFinite(r.maxBenefit)).toBe(true);
  });
});
