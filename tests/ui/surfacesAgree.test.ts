import { describe, it, expect, beforeAll } from "vitest";
import { buildReport } from "../../src/readout/report";
import { mountOwedScreener } from "../../src/tiles/owedScreener";
import { acaCreditEligible, medicaidEligibility, fplPercent } from "../../src/engine/benefits";
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
 */
let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

/** The 2026 contiguous poverty line for one person, the figure the grid is built from. */
const ONE_PERSON_LINE = 15_960;

/**
 * Incomes placed at, just under, and just over every line that decides
 * something — 100%, 138%, DC's 215%, and 400% of the poverty line. A round
 * number never lands on a threshold, which is why these are derived.
 */
function grid(): { label: string; income: number; state: string }[] {
  const out: { label: string; income: number; state: string }[] = [];
  for (const [pct, name] of [
    [0.5, "half the poverty line"],
    [1, "exactly the poverty line"],
    [1.38, "the Medicaid expansion line"],
    [1.69, "between 138% and DC's 215%"],
    [2.15, "DC's expansion line"],
    [4, "exactly the ACA cliff"],
    [4.5, "past the cliff"],
  ] as const) {
    const base = Math.round(ONE_PERSON_LINE * pct);
    for (const delta of [-1, 0, 1]) {
      // Three states: one that expanded, one that did not, one with an override.
      for (const state of ["ca", "tx", "dc"]) {
        out.push({
          label: `${name} ${delta >= 0 ? "+" : ""}${delta} (${state})`,
          income: base + delta,
          state,
        });
      }
    }
  }
  return out;
}

function profileFor(income: number, state: string): SituationStore {
  const p = new SituationStore();
  p.set("annualIncome", income);
  p.set("householdSize", 1);
  p.set("stateCode", state);
  return p;
}

/** The screener's findings for one household, as plain text per program. */
function screenerFindings(income: number, state: string): string[] {
  const root = document.createElement("div");
  const params = new URLSearchParams({ hh: "1", inc: String(income) });
  mountOwedScreener({
    root,
    params,
    setParams: () => {},
    permalink: () => "https://enklayve.com/#/x",
    navigate: () => {},
    locale: "en-US",
    data,
    profile: profileFor(income, state),
  } as unknown as TileContext);
  return [...root.querySelectorAll(".screener-item")].map((n) => n.textContent ?? "");
}

/** The Report's "what you may be owed" line labels for the same household. */
function reportOwed(income: number, state: string): string[] {
  const section = buildReport(profileFor(income, state), data).sections.find(
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
    const pcts = rows.map((r) => fplPercent(r.income, 1, data.fpl("contiguous")!));
    expect(pcts.some((p) => p === 100)).toBe(true);
    expect(pcts.some((p) => p === 400)).toBe(true);
  });

  for (const { label, income, state } of grid()) {
    it(`agrees about the premium tax credit at ${label}`, () => {
      const pct = fplPercent(income, 1, data.fpl("contiguous")!);
      const eligible = acaCreditEligible(pct, data.aca()!);
      const screener = screenerFindings(income, state).some((t) =>
        t.includes("ACA marketplace subsidies"),
      );
      const report = reportOwed(income, state).some((l) => l.startsWith("ACA premium tax credit"));
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
        { stateCode: state, income, householdSize: 1 },
        data.medicaid()!,
        data.fpl("contiguous")!,
      );
      const screenerSaysLikely = screenerFindings(income, state).some(
        (t) => t.includes("Medicaid") && t.includes("Eligibility"),
      );
      const reportSaysLikely = reportOwed(income, state).some((l) =>
        l.startsWith("Medicaid: Likely eligible"),
      );
      expect(screenerSaysLikely, `${label}: screener disagrees with the engine on Medicaid`).toBe(
        m.eligible === true,
      );
      expect(reportSaysLikely, `${label}: the Report disagrees with the engine on Medicaid`).toBe(
        m.eligible === true,
      );
    });
  }
});
