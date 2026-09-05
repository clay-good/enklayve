import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildReport } from "../../src/readout/report";
import { mountOwedScreener } from "../../src/tiles/owedScreener";
import {
  acaCreditEligible,
  estimatePremiumTaxCredit,
  medicaidEligibility,
  fplPercent,
} from "../../src/engine/benefits";
import { resourcesAt, type CliffData, type CliffInput } from "../../src/engine/cliffs";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import type { TileContext } from "../../src/tiles/types";

/**
 * Two surfaces, one household, one answer.
 *
 * Four separate bugs on 2026-09-03 were the same bug: a program's rule written
 * twice, and the two copies disagreeing about a household standing near the
 * line. Each was found by hand, one at a time.
 *
 *   The engine denied the premium tax credit at exactly 400% of the poverty
 *   line while the screener told the same household it was "within the
 *   100–400% range" and likely qualified.
 *   The engine handed a household at 63% FPL a $482-a-month credit while the
 *   Benefit Cliff Explorer, calling the same function, plotted zero.
 *   The Readout Report asked `acaCovered`, which is true at 50% FPL, and told
 *   a coverage-gap household it was likely eligible.
 *   The screener drew Medicaid with `<= 138` and could not see the shard's
 *   per-state override, so a DC resident at 169% — eligible, DC covers to
 *   215% — heard nothing, while the Medicaid tile and the Report both said so.
 *
 * No figure sweep catches these: every figure is correct on the surface that
 * states it. What is wrong is that two surfaces state different ones. So this
 * asks the only question that finds them — put one household in front of every
 * surface that speaks about a program, and require the same answer — across a
 * grid built out of the lines themselves rather than round numbers.
 *
 * **Widened on 2026-09-05, on the two things "every surface" did not mean.**
 * Every row was a household of one, so the per-person increment — the number
 * that decides a *family's* eligibility, and the more common case — was outside
 * the sweep; the grid now runs households of one and four, with the poverty
 * line read off the shard instead of typed as `15_960`, so an HHS refresh moves
 * the boundaries rather than leaving them a year behind the code. And the
 * Benefit Cliff Explorer was absent, which is the surface that produced the
 * second of the four bugs above: a surface with a proven history of disagreeing
 * is the last one to leave out. Its resource curve is now held to the same
 * standard as the other two.
 *
 * Both came back green, which is the outcome to want and not evidence the sweep
 * was unnecessary — the four bugs it was written for were found by hand, one at
 * a time, and each had been green in every other sense for as long as it stood.
 */
let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

/**
 * The 2026 contiguous poverty lines the grid is built from: one person, and a
 * household of four.
 *
 * Household size was fixed at one when this file was written, which made every
 * row a single adult and left the per-person increment — the number that
 * decides a *family's* eligibility, and the more common case — outside the
 * sweep entirely. The lines are read from the shard rather than typed, so a
 * refresh that moves the poverty guideline moves the grid with it.
 */
const HOUSEHOLD_SIZES = [1, 4];

/**
 * The poverty guideline, read off the shard at module load.
 *
 * `grid()` runs while the file is being collected, before any `beforeAll`, so
 * the bundled loader is not available to it yet — which is why the one-person
 * line used to be a literal `15_960` typed here. Reading the shard instead
 * keeps the grid pinned to the figure the engine will actually use, so an HHS
 * refresh moves the boundaries this file tests rather than quietly leaving them
 * a year behind the code they are meant to straddle.
 */
const FPL = JSON.parse(
  readFileSync(
    resolve(__dirname, "..", "..", "data", "federal-poverty-level-2024-contiguous.json"),
    "utf8",
  ),
) as { base: number; perAdditionalPerson: number };

const lineFor = (size: number): number => FPL.base + (size - 1) * FPL.perAdditionalPerson;

/**
 * Incomes placed at, just under, and just over every line that decides
 * something — 100%, 138%, DC's 215%, and 400% of the poverty line. A round
 * number never lands on a threshold, which is why these are derived.
 */
function grid(): { label: string; income: number; state: string; size: number }[] {
  const out: { label: string; income: number; state: string; size: number }[] = [];
  for (const size of HOUSEHOLD_SIZES) {
    const line = lineFor(size);
    for (const [pct, name] of [
      [0.5, "half the poverty line"],
      [1, "exactly the poverty line"],
      [1.38, "the Medicaid expansion line"],
      [1.69, "between 138% and DC's 215%"],
      [2.15, "DC's expansion line"],
      [4, "exactly the ACA cliff"],
      [4.5, "past the cliff"],
    ] as const) {
      const base = Math.round(line * pct);
      for (const delta of [-1, 0, 1]) {
        // Three states: one that expanded, one that did not, one with an override.
        for (const state of ["ca", "tx", "dc"]) {
          out.push({
            label: `${name} ${delta >= 0 ? "+" : ""}${delta} (${state}, household of ${size})`,
            income: base + delta,
            state,
            size,
          });
        }
      }
    }
  }
  return out;
}

function profileFor(income: number, state: string, size: number): SituationStore {
  const p = new SituationStore();
  p.set("annualIncome", income);
  p.set("householdSize", size);
  p.set("stateCode", state);
  return p;
}

/** The screener's findings for one household, as plain text per program. */
function screenerFindings(income: number, state: string, size: number): string[] {
  const root = document.createElement("div");
  const params = new URLSearchParams({ hh: String(size), inc: String(income) });
  mountOwedScreener({
    root,
    params,
    setParams: () => {},
    permalink: () => "https://enklayve.com/#/x",
    navigate: () => {},
    locale: "en-US",
    data,
    profile: profileFor(income, state, size),
  } as unknown as TileContext);
  return [...root.querySelectorAll(".screener-item")].map((n) => n.textContent ?? "");
}

/**
 * The Benefit Cliff Explorer's premium tax credit for the same household.
 *
 * This surface is here because it produced one of the four bugs this file was
 * written for — a household at 63% of the poverty line was handed a $482-a-month
 * credit by the engine while the Explorer, calling the same function, plotted
 * zero — and then was left out of the sweep that resulted. A surface with a
 * proven history of disagreeing is the last one to leave untested.
 *
 * The benchmark premium is per-county and user-supplied, so a figure is chosen
 * here; any positive one opts the ACA term in, which is all this needs.
 */
const BENCHMARK_MONTHLY_PREMIUM = 550;

function explorerCredit(income: number, state: string, size: number): number {
  const input: CliffInput = {
    filingStatus: "single",
    householdSize: size,
    qualifyingChildren: 0,
    stateCode: state,
    benchmarkMonthlyPremium: BENCHMARK_MONTHLY_PREMIUM,
  };
  const cliffData: CliffData = {
    tax: { federal: data.federal()!, fica: data.fica()!, state: data.state(state) ?? undefined },
    fpl: data.fpl("contiguous"),
    eitcCtc: data.eitcCtc(),
    aca: data.aca(),
    snap: data.snap(),
    medicaid: data.medicaid(),
    snapRegionSupported: true,
  };
  return resourcesAt(income, input, cliffData).acaPremiumCredit;
}

/** The Report's "what you may be owed" line labels for the same household. */
function reportOwed(income: number, state: string, size: number): string[] {
  const section = buildReport(profileFor(income, state, size), data).sections.find(
    (s) => s.title === "What you may be owed",
  );
  return (section?.lines ?? []).map((l) => `${l.label}: ${l.value}`);
}

describe("the screener and the saved Report answer one household the same way", () => {
  it("has a grid that actually straddles the lines", () => {
    // The derivation is the point: a grid of round numbers would pass this
    // whole file while testing none of the boundaries it exists for.
    const rows = grid();
    expect(rows.length).toBeGreaterThan(50);
    const pcts = rows.map((r) => fplPercent(r.income, r.size, data.fpl("contiguous")!));
    expect(new Set(rows.map((r) => r.size)).size).toBeGreaterThan(1);
    expect(pcts.some((p) => p === 100)).toBe(true);
    expect(pcts.some((p) => p === 400)).toBe(true);
  });

  for (const { label, income, state, size } of grid()) {
    it(`agrees about the premium tax credit at ${label}`, () => {
      const pct = fplPercent(income, size, data.fpl("contiguous")!);
      const eligible = acaCreditEligible(pct, data.aca()!);
      const screener = screenerFindings(income, state, size).some((t) =>
        t.includes("ACA marketplace subsidies"),
      );
      const report = reportOwed(income, state, size).some((l) =>
        l.startsWith("ACA premium tax credit"),
      );
      // The Report defers to Medicaid where the household qualifies for it, so
      // it may stay silent about the credit — but it must never claim the
      // credit where the engine says the band does not reach.
      expect(screener, `${label}: screener disagrees with the engine`).toBe(eligible);
      if (report) {
        expect(eligible, `${label}: the saved Report offers a credit the band excludes`).toBe(true);
      }
    });

    it(`agrees about Medicaid at ${label}`, () => {
      const m = medicaidEligibility(
        { stateCode: state, income, householdSize: size },
        data.medicaid()!,
        data.fpl("contiguous")!,
      );
      const screenerSaysLikely = screenerFindings(income, state, size).some(
        (t) => t.includes("Medicaid") && t.includes("Eligibility"),
      );
      const reportSaysLikely = reportOwed(income, state, size).some((l) =>
        l.startsWith("Medicaid: Likely eligible"),
      );
      expect(screenerSaysLikely, `${label}: screener disagrees with the engine on Medicaid`).toBe(
        m.eligible === true,
      );
      expect(reportSaysLikely, `${label}: the Report disagrees with the engine on Medicaid`).toBe(
        m.eligible === true,
      );
    });

    it(`the cliff chart plots the same credit the engine pays at ${label}`, () => {
      const pct = fplPercent(income, size, data.fpl("contiguous")!);
      const engine = estimatePremiumTaxCredit(
        {
          householdSize: size,
          annualIncome: income,
          benchmarkMonthlyPremium: BENCHMARK_MONTHLY_PREMIUM,
        },
        data.aca()!,
        data.fpl("contiguous")!,
      );
      const expected = engine.eligible ? engine.annualCredit.toNumber() : 0;
      expect(
        explorerCredit(income, state, size),
        `${label}: the cliff chart's resource curve disagrees with the credit engine`,
      ).toBeCloseTo(expected, 2);
      // Eligibility can be true with a zero credit — a household near the top
      // of the band whose expected contribution already covers the benchmark —
      // so the chart paying anything at all is the direction worth asserting
      // against the band, and it must be inside it.
      if (explorerCredit(income, state, size) > 0) {
        expect(
          acaCreditEligible(pct, data.aca()!),
          `${label}: the chart pays a credit the band excludes`,
        ).toBe(true);
      }
    });
  }
});
