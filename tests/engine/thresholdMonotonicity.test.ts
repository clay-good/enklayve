import { describe, it, expect, beforeAll } from "vitest";
import { readdirSync } from "node:fs";
import { evaluateTaxes, type TaxContext } from "../../src/engine/tax";
import { statutoryNotches } from "../../src/engine/tax/brackets";
import type { FilingStatus, Jurisdiction } from "../../src/data/schemas";
import { loadDatasets, type Datasets } from "../helpers/datasets";

/**
 * The dollar that crosses the line.
 *
 * `invariants.test.ts` already asserts that more income never lowers tax and
 * never lowers take-home. It does it over thirteen hand-listed jurisdictions
 * with random income steps up to $100,000 — which is the wrong instrument for
 * this particular failure. A notch is a ONE-DOLLAR event at an exact threshold:
 * a stage that adds a flat amount at its top rather than ramping to it, an
 * exemption that vanishes instead of phasing, a credit whose eligibility ends
 * on a boundary. Sampled from a random offset with a random step, a $90 notch
 * inside a $60,000 jump is invisible, and a threshold in the thirty-eight
 * jurisdictions the list does not name is not sampled at all.
 *
 * So this asks the question at the only place it can be answered: at each
 * threshold, from the dollar below it to the dollar above.
 *
 * The thresholds are HARVESTED FROM THE SHARDS, not listed here. Every number a
 * jurisdiction states is a candidate boundary — a bracket's `lowerBound`, a
 * recapture stage's `thresholdLow`/`thresholdHigh`, a phase-out's start, a cap —
 * and the ones that are not boundaries cost only a few extra evaluations. A
 * list written here would be a promise somebody has to remember to keep the day
 * a state gains a new kind of threshold, which is the day this test matters.
 *
 * Both spaces are probed, because a shard's numbers live in both: a figure
 * stated against TAXABLE income is reached from wages only after the standard
 * deduction, and a figure stated against wages or AGI is reached directly.
 */
let ds: Datasets;
beforeAll(async () => {
  ds = await loadDatasets();
});

const STATE_CODES = readdirSync("data")
  .map((n) => /^state-([a-z]{2})-income-tax-2024\.json$/.exec(n)?.[1])
  .filter((c): c is string => c !== undefined)
  .sort();

const STATUSES: FilingStatus[] = ["single", "married_jointly", "head_of_household"];

/** Every number a shard states that is large enough to be a dollar boundary. */
export function harvestThresholds(value: unknown, into = new Set<number>()): Set<number> {
  if (typeof value === "number") {
    // Rates, counts and years are not boundaries. 500 is low enough to catch
    // the smallest exemption any shard states and high enough to skip them.
    if (Number.isFinite(value) && value >= 500 && Number.isInteger(value)) into.add(value);
  } else if (Array.isArray(value)) {
    for (const v of value) harvestThresholds(v, into);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) harvestThresholds(v, into);
  }
  return into;
}

/** The wage figures that put a filer on either side of `threshold`. */
function probesAround(threshold: number, standardDeduction: number): number[] {
  const out: number[] = [];
  for (const base of [threshold, threshold + standardDeduction]) {
    for (const d of [-1, 0, 1]) if (base + d > 0) out.push(base + d);
  }
  return out;
}

function standardDeductionFor(j: Jurisdiction, status: FilingStatus): number {
  const table = j.standardDeductionByFilingStatus as Record<string, number> | undefined;
  return table?.[status] ?? 0;
}

/**
 * The jurisdictions where crossing a line genuinely costs a filer money, and
 * why. Both are the statute, not this engine, and both are pinned rather than
 * waived: the size of each is asserted, so a data error that invents a notch —
 * or deepens one — fails here even in a state already on the list.
 */
const KNOWN_NOTCHES: Record<string, { maxDrop: number; why: string }> = {
  // Ohio Rev. Code §5747.02(A)(3)(c): nothing is owed at or below $26,050 of
  // nonbusiness taxable income, and the band above it is "$332.00 plus 2.75% of
  // the amount in excess of $26,050". The $332 is not accumulated tax from the
  // bands below — those are 0% — so it arrives whole on the first dollar over
  // the line. A worker at $26,050 who earns one more dollar keeps about $331
  // less. It is the largest single-dollar loss in any jurisdiction this repo
  // models, it is the printed schedule, and it lands on the lowest incomes Ohio
  // taxes at all.
  oh: { maxDrop: 340, why: "Ohio Rev. Code §5747.02(A)(3)(c) — $332.00 flat at $26,050" },
  // Connecticut phases its personal exemption and its 3% tax-rate credit out in
  // STEPS rather than ramps — CT-1040 Table B drops the exemption by $1,000 for
  // each $1,000 of Connecticut AGI over the threshold, and Table C steps the
  // credit down a percentage point at a time across $5,000 AGI bands. Each step
  // is a small notch by construction. Twenty-seven of them per filing status,
  // the deepest under $40.
  ct: { maxDrop: 45, why: "CT-1040 Tables B and C — exemption and credit step, they do not ramp" },
};

describe("no threshold in any jurisdiction costs a filer money to cross", () => {
  it("harvests thresholds from the shard rather than a hand-kept list", () => {
    const found = harvestThresholds({
      a: 0.045,
      b: 10_000,
      c: [{ thresholdHigh: 200_000 }],
      d: 12,
    });
    expect([...found].sort((x, y) => x - y)).toEqual([10_000, 200_000]);
  });

  it("covers every jurisdiction the repo ships, not a sample", () => {
    expect(STATE_CODES).toHaveLength(51);
  });

  it("finds a take-home notch only where a statute puts one, and no deeper", () => {
    /** Every point where one more dollar left the filer with less. */
    const notches: { code: string; label: string; drop: number }[] = [];
    /** A tax that FALLS as income rises would be an engine defect anywhere. */
    const regressions: string[] = [];

    const check = (code: string, ctx: TaxContext, j: Jurisdiction): void => {
      const thresholds = harvestThresholds(j);
      for (const status of STATUSES) {
        if (!j.supportedFilingStatuses.includes(status)) continue;
        const sd = standardDeductionFor(j, status);
        const wages = new Set<number>();
        for (const t of thresholds) for (const w of probesAround(t, sd)) wages.add(w);
        for (const w of [...wages].sort((a, b) => a - b)) {
          const lower = evaluateTaxes({ filingStatus: status, wages: w }, ctx);
          const higher = evaluateTaxes({ filingStatus: status, wages: w + 1 }, ctx);
          const drop = lower.totals.takeHome.subtract(higher.totals.takeHome);
          if (drop.greaterThan(0)) {
            notches.push({
              code,
              label: `${code} ${status} at $${w.toLocaleString("en-US")}`,
              drop: drop.toNumber(),
            });
          }
          if (higher.totals.totalTax.lessThan(lower.totals.totalTax)) {
            regressions.push(`${code} ${status}: tax fell from $${w} to $${w + 1}`);
          }
        }
      }
    };

    check("federal", { federal: ds.federal, fica: ds.fica }, ds.federal);
    for (const code of STATE_CODES) {
      const state = ds.state(code);
      check(code, { federal: ds.federal, state, fica: ds.fica }, state);
    }

    // Progressivity itself: no jurisdiction may charge LESS tax on more income.
    expect(regressions).toEqual([]);

    // Every notch is in a jurisdiction whose statute puts one there. A new name
    // in this list is either a state that changed its law or a shard that is
    // wrong, and both want a person rather than a waiver.
    const unexplained = notches.filter((n) => !(n.code in KNOWN_NOTCHES));
    expect(unexplained.map((n) => n.label).slice(0, 10)).toEqual([]);

    // And each stays the size its statute makes it, so a data error cannot
    // deepen a notch inside a jurisdiction already named here.
    for (const [code, { maxDrop, why }] of Object.entries(KNOWN_NOTCHES)) {
      const here = notches.filter((n) => n.code === code);
      expect(here.length, `${code} no longer notches — ${why}`).toBeGreaterThan(0);
      const deepest = Math.max(...here.map((n) => n.drop));
      expect(
        deepest,
        `${code}'s deepest notch is now $${deepest.toFixed(2)} — ${why}`,
      ).toBeLessThan(maxDrop);
    }

    // Ohio's is the one worth naming on its own: it is an order of magnitude
    // deeper than every other notch on the list, and it lands on the lowest
    // income Ohio taxes at all.
    const ohio = notches.filter((n) => n.code === "oh");
    expect(ohio.map((n) => n.label).sort()).toEqual([
      "oh head_of_household at $26,050",
      "oh married_jointly at $26,050",
      "oh single at $26,050",
    ]);
    for (const n of ohio) expect(n.drop).toBeGreaterThan(325);
  }, 120_000);
});

describe("the notch is derived from the schedule, not written down", () => {
  it("finds Ohio's $332 step, and only it, across every jurisdiction", () => {
    const found = STATE_CODES.flatMap((code) =>
      STATUSES.filter((s) => ds.state(code).supportedFilingStatuses.includes(s)).flatMap((s) =>
        statutoryNotches(ds.state(code).bracketsByFilingStatus[s] ?? []).map(
          (n) => `${code} ${s} $${n.taxableIncome} → $${n.amount}`,
        ),
      ),
    );
    expect([...new Set(found)].sort()).toEqual([
      "oh head_of_household $26050 → $332",
      "oh married_jointly $26050 → $332",
      "oh single $26050 → $332",
    ]);
  });

  it("reports the step between fixed amounts, not the amounts themselves", () => {
    // A band carries its fixed amount INSTEAD of the one below, not on top of
    // it, so a schedule that repeats the same figure notches once — where the
    // figure first appears — and not again where it merely continues.
    expect(
      statutoryNotches([
        { lowerBound: 0, rate: 0.02 },
        { lowerBound: 10_000, rate: 0.04, baseTax: 200 },
        { lowerBound: 20_000, rate: 0.05, baseTax: 200 },
      ]),
    ).toEqual([{ taxableIncome: 10_000, amount: 200 }]);
  });

  it("reports nothing where a higher band's fixed amount is no larger", () => {
    // Falling or equal amounts are not a cliff: nothing extra is charged for
    // the dollar that crosses.
    expect(
      statutoryNotches([
        { lowerBound: 0, rate: 0.02, baseTax: 300 },
        { lowerBound: 10_000, rate: 0.04, baseTax: 100 },
      ]),
    ).toEqual([]);
  });

  it("reports nothing for a schedule with no fixed amounts at all", () => {
    expect(
      statutoryNotches([
        { lowerBound: 0, rate: 0.02 },
        { lowerBound: 10_000, rate: 0.04 },
      ]),
    ).toEqual([]);
  });
});
