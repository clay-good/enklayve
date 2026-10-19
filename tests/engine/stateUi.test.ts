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
let il: StateUiData;
let oh: StateUiData;
let mi: StateUiData;
let nj: StateUiData;
let va: StateUiData;
let wa: StateUiData;
let az: StateUiData;
let ma: StateUiData;
let tn: StateUiData;
let ind: StateUiData;
let md: StateUiData;
let mo: StateUiData;
let co: StateUiData;
beforeAll(async () => {
  data = await loadBundledData();
  ca = data.stateUi("ca")!;
  tx = data.stateUi("tx")!;
  fl = data.stateUi("fl")!;
  ny = data.stateUi("ny")!;
  pa = data.stateUi("pa")!;
  il = data.stateUi("il")!;
  oh = data.stateUi("oh")!;
  mi = data.stateUi("mi")!;
  nj = data.stateUi("nj")!;
  va = data.stateUi("va")!;
  wa = data.stateUi("wa")!;
  az = data.stateUi("az")!;
  ma = data.stateUi("ma")!;
  tn = data.stateUi("tn")!;
  ind = data.stateUi("in")!;
  md = data.stateUi("md")!;
  mo = data.stateUi("mo")!;
  co = data.stateUi("co")!;
});

describe("the bundled state set", () => {
  it("bundles the most populous states first, each schema-valid", () => {
    expect(data.stateUiCodes()).toEqual([
      "ca",
      "tx",
      "fl",
      "ny",
      "pa",
      "il",
      "oh",
      "mi",
      "nj",
      "va",
      "wa",
      "az",
      "ma",
      "tn",
      "in",
      "md",
      "mo",
      "co",
    ]);
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

describe("Illinois (820 ILCS 405 §401; IDES BEN 548, 2026)", () => {
  it("takes 47% of the two-highest-quarter average weekly wage, rounded up", () => {
    // (10,000 + 9,000) / 26 = 730.77 → $731; 47% = 343.57 → $344.
    const r = estimateUi({ quarterlyWages: [10000, 9000, 5000, 3000] }, il);
    expect(r.averageWeeklyWage).toBe(731);
    expect(r.weeklyBenefit).toBe(344);
    expect(r.maxBenefit).toBe(26 * 344);
  });

  it("reproduces a row of IDES's own table: $2,821 in the top two quarters pays $52", () => {
    // 2,821 / 26 = 108.5 → $109 (halves up); 47% = 51.23 → $52.
    const r = estimateUi({ quarterlyWages: [1500, 1321, 0, 0] }, il);
    expect(r.averageWeeklyWage).toBe(109);
    expect(r.weeklyBenefit).toBe(52);
  });

  it("holds $51 to $628, and needs $440 outside the high quarter", () => {
    expect(estimateUi({ quarterlyWages: [800, 800, 0, 0] }, il).weeklyBenefit).toBe(51);
    expect(estimateUi({ quarterlyWages: [20000, 20000, 0, 0] }, il).weeklyBenefit).toBe(628);
    const short = estimateUi({ quarterlyWages: [5000, 400, 0, 0] }, il);
    expect(short.eligible).toBe(false);
    expect(short.shortfalls.join(" ")).toContain("outside the high quarter");
  });
});

describe("Ohio (ORC §§4141.01, 4141.30; ODJFS 2026 figures)", () => {
  it("pays half the average weekly wage over the qualifying weeks, for that many weeks", () => {
    // $10,000 over 20 weeks = $500; half = $250; 20 weeks.
    const r = estimateUi({ quarterlyWages: [5000, 5000, 0, 0], creditWeeks: 20 }, oh);
    expect(r.averageWeeklyWage).toBe(500);
    expect(r.weeklyBenefit).toBe(250);
    expect(r.weeks).toBe(20);
    expect(r.maxBenefit).toBe(5000);
    // $40,000 over 52 weeks = 769.23 → $769; half = 384.5 → $384; capped at 26 weeks.
    const full = estimateUi({ quarterlyWages: [10000, 10000, 10000, 10000], creditWeeks: 52 }, oh);
    expect(full.weeklyBenefit).toBe(384);
    expect(full.weeks).toBe(26);
  });

  it("needs 20 qualifying weeks and a $352 average weekly wage", () => {
    expect(estimateUi({ quarterlyWages: [5000, 5000, 0, 0], creditWeeks: 19 }, oh).eligible).toBe(
      false,
    );
    // $7,020 / 20 = $351 — a dollar short; $7,040 / 20 = $352 pays $176.
    expect(estimateUi({ quarterlyWages: [7020, 0, 0, 0], creditWeeks: 20 }, oh).eligible).toBe(
      false,
    );
    expect(estimateUi({ quarterlyWages: [7040, 0, 0, 0], creditWeeks: 20 }, oh).weeklyBenefit).toBe(
      176,
    );
  });

  it("sets the maximum by dependency class: $624, $757, $842", () => {
    const q: [number, number, number, number] = [50000, 50000, 50000, 50000];
    expect(estimateUi({ quarterlyWages: q, creditWeeks: 26 }, oh).weeklyBenefit).toBe(624);
    expect(
      estimateUi({ quarterlyWages: q, creditWeeks: 26, dependents: 2 }, oh).weeklyBenefit,
    ).toBe(757);
    expect(
      estimateUi({ quarterlyWages: q, creditWeeks: 26, dependents: 4 }, oh).weeklyBenefit,
    ).toBe(842);
  });
});

describe("Michigan (MCL 421.27, 421.46; UIA 2026)", () => {
  it("pays 4.1% of the high quarter, rounded down, for 43% of wages over the rate", () => {
    // 4.1% of $10,000 = $410. Weeks: 0.43 × 15,000 / 410 = 15.73 → 15.5.
    const r = estimateUi({ quarterlyWages: [10000, 5000, 0, 0] }, mi);
    expect(r.weeklyBenefit).toBe(410);
    expect(r.weeks).toBe(15.5);
    expect(r.maxBenefit).toBe(15.5 * 410);
    // Plenty of wages: 0.43 × 30,000 / 410 = 31.46, held to 26.
    expect(estimateUi({ quarterlyWages: [10000, 8000, 7000, 5000] }, mi).weeks).toBe(26);
  });

  it("adds dependents BEFORE rounding, so one is worth $19, not $19.33", () => {
    // 410 + 19.33 = 429.33 → $429; two: 448.66 → $448.
    const one = estimateUi({ quarterlyWages: [10000, 5000, 0, 0], dependents: 1 }, mi);
    expect(one.weeklyTotal).toBe(429);
    expect(one.dependentAllowance).toBe(19);
    expect(estimateUi({ quarterlyWages: [10000, 5000, 0, 0], dependents: 2 }, mi).weeklyTotal).toBe(
      448,
    );
    // At the $530 cap, dependents add nothing.
    const capped = estimateUi({ quarterlyWages: [15000, 8000, 0, 0], dependents: 2 }, mi);
    expect(capped.weeklyTotal).toBe(530);
    expect(capped.dependentAllowance).toBe(0);
  });

  it("qualifies on either path: 1.5 times the high quarter, or 20 times the state average weekly wage", () => {
    expect(estimateUi({ quarterlyWages: [5327, 5000, 0, 0] }, mi).eligible).toBe(false);
    // $20,000 high quarter, $26,677.60 total: under 1.5 times, over the AEQ amount.
    const aeq = estimateUi({ quarterlyWages: [20000, 6677.6, 0, 0] }, mi);
    expect(aeq.eligible).toBe(true);
    // 0.43 × 26,677.60 / 530 = 21.64 → 21.5 weeks.
    expect(aeq.weeks).toBe(21.5);
  });
});

describe("New Jersey (N.J.S.A. 43:21-3, 43:21-19; NJDOL 2026)", () => {
  it("pays 60% of base-year wages over base weeks (at most 52), for that many weeks to 26", () => {
    // $40,000 / 52 = 769.23; 60% = 461.54 → $461; 26 weeks.
    const r = estimateUi({ quarterlyWages: [10000, 10000, 10000, 10000], creditWeeks: 60 }, nj);
    expect(r.weeklyBenefit).toBe(461);
    expect(r.maxBenefit).toBe(26 * 461);
    // $10,000 over 20 base weeks = $500; 60% = $300; 20 weeks.
    const twenty = estimateUi({ quarterlyWages: [5000, 5000, 0, 0], creditWeeks: 20 }, nj);
    expect(twenty.weeklyBenefit).toBe(300);
    expect(twenty.maxBenefit).toBe(6000);
  });

  it("adds 7%, then 4% and 4%, rounded down, never past the $905 maximum", () => {
    const q: [number, number, number, number] = [10000, 10000, 10000, 10000];
    // 461 × 1.07 = 493.27 → $493; × 1.15 = 530.15 → $530.
    expect(
      estimateUi({ quarterlyWages: q, creditWeeks: 52, dependents: 1 }, nj).dependentAllowance,
    ).toBe(32);
    expect(
      estimateUi({ quarterlyWages: q, creditWeeks: 52, dependents: 5 }, nj).dependentAllowance,
    ).toBe(69);
    const top = estimateUi(
      { quarterlyWages: [60000, 60000, 60000, 60000], creditWeeks: 52, dependents: 3 },
      nj,
    );
    expect(top.weeklyBenefit).toBe(905);
    expect(top.dependentAllowance).toBe(0);
  });

  it("says 'may qualify' on the $15,500 alternative rather than refusing or guessing a rate", () => {
    const alt = estimateUi({ quarterlyWages: [8000, 8000, 0, 0], creditWeeks: 19 }, nj);
    expect(alt.eligible).toBe(false);
    expect(alt.mayQualifyUnestimated).toBe(true);
    expect(
      estimateUi({ quarterlyWages: [5000, 5000, 0, 0], creditWeeks: 19 }, nj).mayQualifyUnestimated,
    ).toBe(false);
  });
});

describe("Virginia (§60.2-602 Benefit Table, July 2026)", () => {
  it("reads the first row: $160, and 12 weeks only from $3,000.01", () => {
    expect(estimateUi({ quarterlyWages: [1500, 1500, 0, 0] }, va).eligible).toBe(false);
    const r = estimateUi({ quarterlyWages: [1500, 1500.01, 0, 0] }, va);
    expect(r.weeklyBenefit).toBe(160);
    expect(r.weeks).toBe(12);
    // $3,050.01 is the next row: $161.
    expect(estimateUi({ quarterlyWages: [1525, 1525.01, 0, 0] }, va).weeklyBenefit).toBe(161);
  });

  it("reproduces the $478 row's columns to the cent", () => {
    // Two highest $18,900.01. 13 weeks from $20,250.01; 26 from $37,800.01.
    const thirteen = estimateUi({ quarterlyWages: [10000, 8900.01, 1350, 0] }, va);
    expect(thirteen.weeklyBenefit).toBe(478);
    expect(thirteen.weeks).toBe(13);
    expect(thirteen.maxBenefit).toBe(13 * 478);
    expect(estimateUi({ quarterlyWages: [10000, 8900.01, 1349.99, 0] }, va).weeks).toBe(12);
    expect(estimateUi({ quarterlyWages: [10000, 9450, 9450, 8900.01] }, va).weeks).toBe(26);
    expect(estimateUi({ quarterlyWages: [10000, 9450, 9450, 8900] }, va).weeks).toBe(25);
  });

  it("needs wages in two quarters", () => {
    expect(estimateUi({ quarterlyWages: [9000, 0, 0, 0] }, va).eligible).toBe(false);
  });
});

describe("Washington (RCW 50.04.030, 50.20.120; ESD July 2026)", () => {
  it("pays 3.85% of the two-quarter average, inside $383-$1,208 and the claimant's own weekly wage", () => {
    // ESD's example: a $5,098 average is $196 at 3.85%, under the $383 minimum,
    // and the weekly wage (5,098 / 13 = $392) is above it, so $383.
    expect(estimateUi({ quarterlyWages: [5098, 5098, 0, 0], hours: 700 }, wa).weeklyBenefit).toBe(
      383,
    );
    // A $4,000 average: weekly wage $307, under the minimum, so $307.
    expect(estimateUi({ quarterlyWages: [4000, 4000, 0, 0], hours: 700 }, wa).weeklyBenefit).toBe(
      307,
    );
    // A $20,000 average: $770; total the lesser of 26 × 770 and $60,000 / 3.
    const r = estimateUi({ quarterlyWages: [20000, 20000, 10000, 10000], hours: 2080 }, wa);
    expect(r.weeklyBenefit).toBe(770);
    expect(r.maxBenefit).toBe(20000);
    expect(r.maxBenefitBasis).toBe("share-of-base-period");
    expect(
      estimateUi({ quarterlyWages: [40000, 40000, 0, 0], hours: 2080 }, wa).weeklyBenefit,
    ).toBe(1208);
  });

  it("needs 680 hours", () => {
    const r = estimateUi({ quarterlyWages: [20000, 20000, 0, 0], hours: 679 }, wa);
    expect(r.eligible).toBe(false);
    expect(r.shortfalls.join(" ")).toContain("680 hours");
  });
});

describe("Arizona (A.R.S. 23-771, 23-779, 23-780; DES 2026)", () => {
  it("pays 1/25 of the high quarter, halves rounded up, $236-$320, 24 weeks or a third of wages", () => {
    // $7,000 / 25 = $280; total the lesser of 24 × 280 and $11,000 / 3.
    const r = estimateUi({ quarterlyWages: [7000, 4000, 0, 0] }, az);
    expect(r.weeklyBenefit).toBe(280);
    expect(r.maxBenefit).toBe(3666.67);
    // $6,012.50 / 25 = 240.5 → $241.
    expect(estimateUi({ quarterlyWages: [6012.5, 3006.25, 0, 0] }, az).weeklyBenefit).toBe(241);
    expect(estimateUi({ quarterlyWages: [10000, 5000, 0, 0] }, az).weeklyBenefit).toBe(320);
  });

  it("qualifies on either route, and on neither below them", () => {
    // Route B: $7,987.50 in a quarter and $8,000 in two.
    expect(estimateUi({ quarterlyWages: [7987.5, 12.5, 0, 0] }, az).eligible).toBe(true);
    expect(estimateUi({ quarterlyWages: [5908.49, 2954.25, 0, 0] }, az).eligible).toBe(false);
  });
});

describe("Massachusetts (M.G.L. c. 151A; DUA October 2026)", () => {
  it("pays half the average weekly wage, raised to the dollar first, capped at 36% of wages", () => {
    // 19,000 / 26 = 730.77 → $731; half → $365. Lesser of 30 × 365 and 36% of $27,000.
    const r = estimateUi({ quarterlyWages: [10000, 9000, 5000, 3000] }, ma);
    expect(r.averageWeeklyWage).toBe(731);
    expect(r.weeklyBenefit).toBe(365);
    expect(r.maxBenefit).toBe(9720);
    // Two quarters with wages: the top one over 13. 8,000 / 13 = 615.38 → $616 → $308.
    expect(estimateUi({ quarterlyWages: [8000, 6000, 0, 0] }, ma).weeklyBenefit).toBe(308);
  });

  it("pays $25 a child on top of the cap, for the weeks it pays", () => {
    // 9,720 + (9,720 / 365) × 50 = 11,051.5 → $11,051.
    const r = estimateUi({ quarterlyWages: [10000, 9000, 5000, 3000], dependents: 2 }, ma);
    expect(r.dependentAllowance).toBe(50);
    expect(r.maxBenefit).toBe(11051);
  });

  it("needs $6,300, and holds the $1,154 maximum", () => {
    expect(estimateUi({ quarterlyWages: [3150, 3149, 0, 0] }, ma).eligible).toBe(false);
    expect(estimateUi({ quarterlyWages: [40000, 40000, 40000, 40000] }, ma).weeklyBenefit).toBe(
      1154,
    );
  });
});

describe("Tennessee (§50-7-301 as amended by Pub. Ch. 560)", () => {
  it("reads the table: the two-quarter average over 26, raised, plus $24 or $49", () => {
    // Average $800: 800 / 26 = 30.77 → 31, + 24 = $55, the first row. ($2,600 in
    // all clears 40 × 55 = $2,200.)
    expect(estimateUi({ quarterlyWages: [900, 700, 700, 300] }, tn).weeklyBenefit).toBe(55);
    // $4,420 is the last $194 row; $4,420.01 jumps to $220.
    expect(estimateUi({ quarterlyWages: [4420, 4420, 4000, 0] }, tn).weeklyBenefit).toBe(194);
    expect(estimateUi({ quarterlyWages: [4420.01, 4420.01, 4000, 0] }, tn).weeklyBenefit).toBe(220);
    expect(estimateUi({ quarterlyWages: [9000, 9000, 9000, 9000] }, tn).weeklyBenefit).toBe(325);
  });

  it("needs 40 times the rate in all and the lesser of $900 or 6 times it outside the high quarter", () => {
    // $194 a week: 40× = $7,760; 6× = $1,164, so $900 is the lesser.
    expect(estimateUi({ quarterlyWages: [4420, 4420, 0, 0] }, tn).eligible).toBe(true);
    // $8,000 and $800: average $4,400 → $194, $8,800 in all clears 40×, but only
    // $800 outside the high quarter, under the lesser of $900 and $1,164.
    const outside = estimateUi({ quarterlyWages: [8000, 800, 0, 0] }, tn);
    expect(outside.eligible).toBe(false);
    expect(outside.shortfalls.join(" ")).toContain("lesser of $900");
    // Average under $780.01: below the first row.
    expect(estimateUi({ quarterlyWages: [780, 780, 780, 780] }, tn).eligible).toBe(false);
    // Twelve weeks, total rounded down.
    expect(estimateUi({ quarterlyWages: [4420, 4420, 4000, 0] }, tn).maxBenefit).toBe(12 * 194);
  });
});

describe("Indiana (IC 22-4-12-2, 22-4-14-5; DWD handbook)", () => {
  it("pays 47% of base-period wages over 52, rounded down — the handbook's $271 example", () => {
    const r = estimateUi({ quarterlyWages: [7500, 7500, 7500, 7500] }, ind);
    expect(r.weeklyBenefit).toBe(271);
    // Total: lesser of 26 × 271 = 7,046 and 28% of 30,000 = 8,400.
    expect(r.maxBenefit).toBe(7046);
    expect(estimateUi({ quarterlyWages: [20000, 20000, 20000, 20000] }, ind).weeklyBenefit).toBe(
      390,
    );
  });

  it("needs $2,500 in the LAST two quarters, so order matters", () => {
    expect(estimateUi({ quarterlyWages: [3000, 1500, 1250, 1250] }, ind).eligible).toBe(true);
    expect(estimateUi({ quarterlyWages: [1250, 1250, 3000, 1500] }, ind).eligible).toBe(true);
    const early = estimateUi({ quarterlyWages: [2000, 2000, 1000, 1000] }, ind);
    expect(early.eligible).toBe(false);
    expect(early.shortfalls.join(" ")).toContain("last two quarters");
  });
});

describe("Maryland (§§8-802, 8-803, 8-804 schedule of benefits)", () => {
  it("reads its line of the schedule: $50 at $1,176.01-$1,200, $1 more each $24", () => {
    // Line 1 needs $1,800 in at least two quarters.
    expect(estimateUi({ quarterlyWages: [1200, 600, 0, 0] }, md).weeklyBenefit).toBe(50);
    expect(estimateUi({ quarterlyWages: [1200.01, 700, 0, 0] }, md).weeklyBenefit).toBe(51);
    // Line 381, $10,296.01 and over: $430, qualifying wages $15,480.
    expect(estimateUi({ quarterlyWages: [12000, 4000, 0, 0] }, md).weeklyBenefit).toBe(430);
  });

  it("steps down a line when the line's qualifying wages are short, even at the top", () => {
    // $12,000 high quarter but $15,479 in all: the top line's $15,480 is missed,
    // line 380 ($10,272.01-$10,296, qualifying $15,444) is met: $429.
    const r = estimateUi({ quarterlyWages: [12000, 3479, 0, 0] }, md);
    expect(r.weeklyBenefit).toBe(429);
    expect(r.weeklyBasis).toBe("stepped-down");
  });

  it("adds $8 a child, up to five, never past $430", () => {
    expect(
      estimateUi({ quarterlyWages: [5000, 3000, 0, 0], dependents: 6 }, md).dependentAllowance,
    ).toBe(40);
    expect(
      estimateUi({ quarterlyWages: [12000, 4000, 0, 0], dependents: 2 }, md).dependentAllowance,
    ).toBe(0);
  });
});

describe("Missouri (RSMo 288.030, 288.038, 288.060)", () => {
  it("pays 4% of the two-quarter average, rounded down, for the lesser of 20 weeks or a third of wages", () => {
    // (8,000 + 6,000) / 2 = 7,000; 4% = $280. 20 × 280 = 5,600 < 18,000 / 3.
    const r = estimateUi({ quarterlyWages: [8000, 6000, 3000, 1000] }, mo);
    expect(r.weeklyBenefit).toBe(280);
    expect(r.maxBenefit).toBe(5600);
    expect(estimateUi({ quarterlyWages: [9000, 9000, 9000, 9000] }, mo).weeklyBenefit).toBe(320);
  });

  it("qualifies on $1,500 and 1.5 times it, or on $13,500 in two quarters", () => {
    expect(estimateUi({ quarterlyWages: [1500, 750, 0, 0] }, mo).eligible).toBe(true);
    expect(estimateUi({ quarterlyWages: [10000, 3500, 0, 0] }, mo).eligible).toBe(true);
    expect(estimateUi({ quarterlyWages: [10000, 3499, 0, 0] }, mo).eligible).toBe(false);
  });
});

describe("Colorado (C.R.S. 8-73-102; CDLE estimator 2026)", () => {
  it("takes the highest CONSECUTIVE pair, so order matters", () => {
    // Adjacent pairs: 8,000+1,000, 1,000+1,000, 1,000+8,000 → 9,000. 60% of 9,000/26 = $207.
    const apart = estimateUi({ quarterlyWages: [8000, 1000, 1000, 8000] }, co);
    expect(apart.weeklyBenefit).toBe(207);
    // Together: 8,000 + 8,000 = 16,000 → 60% of 615.38 = $369.
    expect(estimateUi({ quarterlyWages: [1000, 8000, 8000, 1000] }, co).weeklyBenefit).toBe(369);
  });

  it("pays the second formula when it is higher, up to $884", () => {
    // Two-quarter formula caps at $804; half of 100,000 / 52 = $961 → capped at $884.
    const r = estimateUi({ quarterlyWages: [25000, 25000, 25000, 25000] }, co);
    expect(r.weeklyBenefit).toBe(884);
    expect(r.weeklyBasis).toBe("alternative");
  });

  it("needs the greater of $2,500 or 40 times the rate", () => {
    expect(estimateUi({ quarterlyWages: [1300, 1199, 0, 0] }, co).eligible).toBe(false);
    expect(estimateUi({ quarterlyWages: [1300, 1200, 0, 0] }, co).eligible).toBe(true);
  });
});

describe("inputs that are not wages", () => {
  it("treats negative and non-finite quarters as zero, never as a figure", () => {
    const r = estimateUi({ quarterlyWages: [Number.NaN, -500, Infinity, 0] }, tx);
    expect(r.eligible).toBe(false);
    expect(Number.isFinite(r.maxBenefit)).toBe(true);
  });
});
