import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildReport } from "../../src/readout/report";
import { renderHome } from "../../src/ui/shell";
import { getTile } from "../../src/tiles/registry";
import { mountOwedScreener } from "../../src/tiles/owedScreener";
import {
  acaCreditEligible,
  estimatePremiumTaxCredit,
  estimateSnap,
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
 * **And SNAP joined, the third program with more than one surface.** It is the
 * only one the saved Report deliberately does not carry — it points at the
 * screener instead — so the pair is the screener and the chart. Worth pinning
 * because the chart reads SNAP's `monthlyBenefit` without checking `eligible`,
 * and takes on faith that an ineligible household is handed a zero. It is: both
 * benefit engines bar their ineligible households at the source now. But that is
 * a guarantee held in `estimateSnap`, relied on in `resourcesAt`, and stated in
 * neither — the shape the ACA term already failed in once, when the credit
 * engine did return a display figure for a household outside the band.
 *
 * All of it came back green, which is the outcome to want and not evidence the
 * sweep was unnecessary — the four bugs it was written for were found by hand,
 * one at a time, and each had been green in every other sense for as long as it
 * stood.
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

/** The same chart's SNAP term, in dollars a year. */
function explorerSnap(income: number, state: string, size: number): number {
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
  return resourcesAt(income, input, cliffData).snapAllotment;
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

    it(`the screener and the cliff chart agree about SNAP at ${label}`, () => {
      // SNAP is the third program with more than one surface, and the only one
      // the saved Report deliberately does not carry — it points at the
      // screener instead, so the pair here is the screener and the chart.
      //
      // The chart reads `monthlyBenefit` without checking `eligible`, taking on
      // faith that an ineligible household is handed a zero. It is — the gate
      // lives inside `estimateSnap` — but that guarantee is held in one function
      // and relied on in another, and written down in neither. The ACA term
      // beside it failed in exactly that shape once, back when the credit engine
      // returned a display figure for a household outside the band: the day a
      // benefit engine grows a number it computes "for display", the chart
      // starts inventing assistance for households that fail the income test,
      // flattening the very cliff it exists to draw. This is where that shows
      // up.
      const snap = estimateSnap(
        { householdSize: size, monthlyGrossIncome: income / 12 },
        data.snap()!,
        data.fpl("contiguous")!,
      );
      const screenerSaysSnap = screenerFindings(income, state, size).some((t) =>
        t.includes("SNAP (food assistance)"),
      );
      expect(screenerSaysSnap, `${label}: screener disagrees with the engine on SNAP`).toBe(
        snap.eligible,
      );
      expect(
        explorerSnap(income, state, size),
        `${label}: the chart's SNAP term disagrees with the engine`,
      ).toBeCloseTo(snap.monthlyBenefit.toNumber() * 12, 2);
      if (!snap.eligible) {
        expect(
          explorerSnap(income, state, size),
          `${label}: the chart pays SNAP to a household that fails the income test`,
        ).toBe(0);
      }
    });
  }
});

/**
 * The tax picture, on the three surfaces that compute it from My Situation.
 *
 * Everything above is about a benefit program's rule written twice. This is the
 * same failure one layer down: a single rule (the tax engine) called correctly
 * from three places, and two of them not passing it what the profile holds.
 *
 * `TaxInput` takes three figures beyond income, status and state that My
 * Situation carries and no calculator has to be opened to produce — "Pre-tax
 * adjustments" in Take-Home, and W-2 box 12 codes TP and TT off a document the
 * Readout read on the device. Take-Home passed all three. **The Readout Report
 * and the home budget passed none**, so on 2026-09-06 a single filer on
 * $85,000 with $10,000 of pre-tax contributions, $18,000 of qualified tips and
 * $6,000 of qualified overtime read $13,370.07 of tax in Take-Home and
 * $20,185.48 in the Report — $6,815 apart, in the document this product asks
 * the household to keep, with the effective rate, the marginal rate and the
 * annual take-home all wrong alongside it.
 *
 * No figure sweep finds that either: each surface's arithmetic is right on the
 * inputs it chose to pass. What is wrong is that they chose differently. So the
 * question is the same one this file asks about benefits — one household, every
 * surface, one answer — with the household carrying each field in turn, since a
 * plain wage earner agrees no matter how many fields a surface drops.
 */
const TAX_HOUSEHOLDS = [
  { label: "wages alone", fields: {} },
  { label: "pre-tax adjustments", fields: { preTaxContributions: 10_000 } },
  { label: "qualified tips", fields: { qualifiedTipsAnnual: 18_000 } },
  { label: "qualified overtime", fields: { qualifiedOvertimeAnnual: 6_000 } },
  {
    label: "all three at once",
    fields: {
      preTaxContributions: 10_000,
      qualifiedTipsAnnual: 18_000,
      qualifiedOvertimeAnnual: 6_000,
    },
  },
] as const;

/** The state matters: Maryland brings the mandatory county tax in with it. */
const TAX_STATES = ["ca", "md", "tx"];

function taxProfile(state: string, fields: Record<string, number>): SituationStore {
  const p = new SituationStore();
  p.set("filingStatus", "single");
  p.set("stateCode", state);
  p.set("annualIncome", 85_000);
  for (const [k, v] of Object.entries(fields)) p.set(k as never, v as never);
  return p;
}

/** Whatever a surface printed after the words "Total tax", as a number. */
function dollarsAfter(text: string, label: string): number {
  const m = text.slice(text.indexOf(label)).match(/\$([\d,]+(?:\.\d+)?)/);
  expect(m, `no figure after "${label}"`).not.toBeNull();
  return Number(m![1]!.replace(/,/g, ""));
}

function takeHomeTax(profile: SituationStore): number {
  const root = document.createElement("div");
  getTile("paycheck-taxes")!.mount!({
    root,
    params: new URLSearchParams({ tool: "take-home" }),
    setParams: () => {},
    permalink: () => "https://enklayve.com/#/x",
    navigate: () => {},
    locale: "en-US",
    data,
    profile,
  } as TileContext);
  return dollarsAfter(root.textContent ?? "", "Total tax");
}

function reportTax(profile: SituationStore): number {
  const line = buildReport(profile, data)
    .sections.flatMap((s) => s.lines)
    .find((l) => l.label === "Total tax");
  expect(line, "the Report has no total-tax line").toBeTruthy();
  return Number(line!.value.replace(/[$,]/g, ""));
}

/** The budget shows one period's tax, rounded to the dollar. */
function homeBudgetAnnualTax(profile: SituationStore): number {
  const main = document.createElement("main");
  renderHome(main, () => {}, data, profile);
  const shown = main.querySelector(".home-budget__derived-value")?.textContent ?? "";
  return Number(shown.replace(/[$,]/g, "")) * 12;
}

describe("the three surfaces that price a household's taxes agree", () => {
  for (const state of TAX_STATES) {
    for (const { label, fields } of TAX_HOUSEHOLDS) {
      it(`${state} with ${label}`, () => {
        const tile = takeHomeTax(taxProfile(state, fields));
        expect(reportTax(taxProfile(state, fields))).toBeCloseTo(tile, 2);
        // The budget rounds its per-period figure to the dollar before it is
        // shown, so twelve of them can sit up to $12 from the annual total.
        const budget = homeBudgetAnnualTax(taxProfile(state, fields));
        expect(Math.abs(budget - tile), `budget ${budget} vs tile ${tile}`).toBeLessThanOrEqual(12);
        document.body.replaceChildren();
      });
    }
  }
});
