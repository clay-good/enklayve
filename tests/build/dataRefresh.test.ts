import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { diffShards, decideOutcome, renderDiffLogEntry } from "../../scripts/refresh/contract";
import {
  ADAPTERS,
  adaptersForGroup,
  REFRESH_GROUPS,
  anchorFlatRate,
  statedTaxYears,
  deductionTableRegion,
  implausibleDrift,
} from "../../scripts/refresh/adapters";
import { planRefresh, serializeShard, insertLogEntry } from "../../scripts/refresh/run";
import {
  CpiSchema,
  FederalPovertyLevelSchema,
  FicaSchema,
  JurisdictionSchema,
  SnapSchema,
  MedicaidSchema,
  TreasuryBondsSchema,
} from "../../src/data/schemas";

/**
 * The data-refresh contract and adapters (BUILD-SPEC.md §7.3). The contract is
 * pure and the adapters anchor to fixture source text, so the whole §7.3
 * decision path is exercised without a single network call. Every parsed shard
 * is validated against the real §7.2 zod schema — the same gate the live data
 * passes — so a malformed parse can never reach `main`.
 */

const DATA_DIR = resolve(__dirname, "..", "..", "data");
function readShard(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(DATA_DIR, file), "utf8")) as Record<string, unknown>;
}
const TODAY = "2026-05-30";

describe("contract: diffShards", () => {
  it("reports each changed leaf as old -> new", () => {
    const diff = diffShards({ a: 1, b: 2 }, { a: 1, b: 5 });
    expect(diff.changed).toBe(true);
    expect(diff.lines).toEqual(["b: 2 -> 5"]);
  });

  it("walks nested objects and arrays with dotted/indexed paths", () => {
    const diff = diffShards(
      { byYear: { "2024": 313.6 }, brackets: [{ rate: 0.1 }] },
      { byYear: { "2024": 320.0 }, brackets: [{ rate: 0.12 }] },
    );
    expect(diff.lines).toContain("byYear.2024: 313.6 -> 320");
    expect(diff.lines).toContain("brackets[0].rate: 0.1 -> 0.12");
  });

  it("flags additions and removals", () => {
    const diff = diffShards({ a: 1 }, { a: 1, b: 9 });
    expect(diff.lines).toEqual(["b: (absent) -> 9"]);
    expect(diffShards({ a: 1, b: 9 }, { a: 1 }).lines).toEqual(["b: 9 -> (absent)"]);
  });

  it("ignores citation.dateRetrieved by default (it changes every run)", () => {
    const before = { x: 1, citation: { dateRetrieved: "2024-01-01" } };
    const after = { x: 1, citation: { dateRetrieved: "2026-05-30" } };
    expect(diffShards(before, after).changed).toBe(false);
  });
});

describe("contract: decideOutcome (the §7.3 gate)", () => {
  it("alerts when the fetch fails", () => {
    expect(
      decideOutcome({ fetchOk: false, schemaValid: false, valuesChanged: false, testsPass: false }),
    ).toBe("alert-pr");
  });
  it("alerts when the parse is invalid even if fetch succeeded", () => {
    expect(
      decideOutcome({ fetchOk: true, schemaValid: false, valuesChanged: true, testsPass: true }),
    ).toBe("alert-pr");
  });
  it("no-ops when nothing changed", () => {
    expect(
      decideOutcome({ fetchOk: true, schemaValid: true, valuesChanged: false, testsPass: true }),
    ).toBe("no-op");
  });
  it("blocks when the new data fails the golden gate", () => {
    expect(
      decideOutcome({ fetchOk: true, schemaValid: true, valuesChanged: true, testsPass: false }),
    ).toBe("blocked");
  });
  it("opens a PR only when valid, changed, and green", () => {
    expect(
      decideOutcome({ fetchOk: true, schemaValid: true, valuesChanged: true, testsPass: true }),
    ).toBe("open-pr");
  });

  it("does not alert on a refusal the adapter says is a decision", () => {
    // Seventeen of the fifty-one adapters refuse on purpose. Without this, every
    // scheduled run opened seventeen fail-safe alert PULL REQUESTS saying
    // "source unreachable or failed validation" about sources that are neither
    // — the alert nobody reads by the third month, arriving as a PR.
    expect(
      decideOutcome({
        fetchOk: true,
        schemaValid: false,
        valuesChanged: false,
        testsPass: false,
        settled: true,
      }),
    ).toBe("settled");
  });

  it("still alerts when the fetch failed, settled or not", () => {
    // The adapter never got to answer, so "nothing to do here" is not a claim
    // anything on this side can make.
    expect(
      decideOutcome({
        fetchOk: false,
        schemaValid: false,
        valuesChanged: false,
        testsPass: false,
        settled: true,
      }),
    ).toBe("alert-pr");
  });
});

describe("contract: renderDiffLogEntry", () => {
  it("lists the changes for an open-pr entry", () => {
    const entry = renderDiffLogEntry({
      date: TODAY,
      source: "HHS",
      datasetId: "federal-poverty-level-2024-contiguous",
      outcome: "open-pr",
      lines: ["base: 15060 -> 15600"],
    });
    expect(entry).toContain(`## ${TODAY} — federal-poverty-level-2024-contiguous (HHS)`);
    expect(entry).toContain("- base: 15060 -> 15600");
  });
  it("renders an alert with its reason", () => {
    const entry = renderDiffLogEntry({
      date: TODAY,
      source: "SSA",
      datasetId: "fica-2024",
      outcome: "alert-pr",
      lines: [],
      reason: "source returned HTTP 404",
    });
    expect(entry).toContain("**Alert:** source returned HTTP 404");
  });
});

describe("adapters: registry", () => {
  it("covers all seven sets across distinct groups", () => {
    expect(REFRESH_GROUPS.sort()).toEqual([
      "cms-medicaid",
      "cpi",
      "hhs-poverty",
      "irs",
      "ssa",
      "state-al",
      "state-ar",
      "state-az",
      "state-ca",
      "state-co",
      "state-ct",
      "state-dc",
      "state-de",
      "state-ga",
      "state-hi",
      "state-ia",
      "state-id",
      "state-il",
      "state-in",
      "state-ks",
      "state-ky",
      "state-la",
      "state-ma",
      "state-md",
      "state-me",
      "state-mi",
      "state-mn",
      "state-mo",
      "state-ms",
      "state-mt",
      "state-nc",
      "state-nd",
      "state-ne",
      "state-nj",
      "state-nm",
      "state-ny",
      "state-oh",
      "state-ok",
      "state-or",
      "state-pa",
      "state-ri",
      "state-sc",
      "state-ut",
      "state-va",
      "state-vt",
      "state-wi",
      "state-wv",
      "treasurydirect",
      "usda-snap",
    ]);
    expect(ADAPTERS).toHaveLength(54);
    for (const a of ADAPTERS) expect(a.sourceUrl).toMatch(/^https:\/\//);
  });
  it("maps a group to its adapters", () => {
    expect(adaptersForGroup("cpi").map((a) => a.id)).toEqual(["cpi-u-annual"]);
    expect(adaptersForGroup("state-ny").map((a) => a.id)).toEqual(["state-ny-income-tax-2024"]);
    expect(adaptersForGroup("state-oh").map((a) => a.id)).toEqual(["state-oh-income-tax-2024"]);
    expect(adaptersForGroup("treasurydirect").map((a) => a.id)).toEqual(["treasury-bonds-2024"]);
  });
});

describe("adapters: BLS CPI (machine-readable)", () => {
  const adapter = adaptersForGroup("cpi")[0]!;
  const current = readShard("cpi-u-annual.json");
  const raw = JSON.stringify({
    Results: {
      series: [
        {
          data: [
            { year: "2025", period: "M13", periodName: "Annual", value: "320.5" },
            { year: "2025", period: "M06", periodName: "June", value: "319.0" },
          ],
        },
      ],
    },
  });

  it("merges the annual average and validates against CpiSchema", () => {
    const result = adapter.parse(raw, current);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.shard.byYear as Record<string, number>)["2025"]).toBe(320.5);
    expect(CpiSchema.safeParse(result.shard).success).toBe(true);
  });

  it("fails (-> alert) on a non-JSON or shapeless response", () => {
    expect(adapter.parse("<html>down for maintenance</html>", current).ok).toBe(false);
    expect(adapter.parse(JSON.stringify({ Results: {} }), current).ok).toBe(false);
  });

  it("repeats what BLS said when BLS declines to serve, instead of blaming its shape", () => {
    // The v2 API is keyless at a small daily quota counted per IP, and a CI
    // runner shares its IP. Spent, it replies 200 with this. Valid JSON, no
    // series, nothing wrong with the API and nothing wrong with the parser —
    // but "unexpected BLS API shape" sends a reader to rewrite the parser.
    const result = adapter.parse(
      JSON.stringify({
        status: "REQUEST_NOT_PROCESSED",
        message: ["Request could not be serviced, as the daily threshold ... has been reached."],
        Results: {},
      }),
      current,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.denied).toBe(true);
    expect(result.reason).toContain("REQUEST_NOT_PROCESSED");
    expect(result.reason).toContain("daily threshold");
  });

  it("does not call a real shape change a denial", () => {
    const result = adapter.parse(
      JSON.stringify({ status: "REQUEST_SUCCEEDED", Results: {} }),
      current,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.denied).toBeUndefined();
  });
});

describe("adapters: HHS poverty guidelines (three regions, one page)", () => {
  const contiguous = ADAPTERS.find((a) => a.id === "federal-poverty-level-2024-contiguous")!;
  const alaska = ADAPTERS.find((a) => a.id === "federal-poverty-level-2024-alaska")!;
  const hawaii = ADAPTERS.find((a) => a.id === "federal-poverty-level-2024-hawaii")!;
  // The ASPE page, in the order HHS prints it.
  const raw =
    "2026 POVERTY GUIDELINES FOR THE 48 CONTIGUOUS STATES AND THE DISTRICT OF COLUMBIA" +
    " Persons in family/household Poverty guideline 1 $15,960 2 $21,640 8 $55,720" +
    " For families/households with more than 8 persons, add $5,680 for each additional person." +
    " 2026 POVERTY GUIDELINES FOR ALASKA Persons in family/household Poverty guideline" +
    " 1 $19,950 2 $27,050 8 $69,650" +
    " For families/households with more than 8 persons, add $7,100 for each additional person." +
    " 2026 POVERTY GUIDELINES FOR HAWAII Persons in family/household Poverty guideline" +
    " 1 $18,360 2 $24,890 8 $64,070" +
    " For families/households with more than 8 persons, add $6,530 for each additional person.";

  it("gives each region its own figures, not whichever table HHS printed first", () => {
    // The parser this replaces read the first "1 $..." row and the first
    // increment sentence from anywhere on the page, so Alaska and Hawaii could
    // only ever have been served the contiguous numbers — the failure the
    // shard's own note names: the wrong region gets every answer wrong.
    for (const [adapter, base, per] of [
      [contiguous, 15960, 5680],
      [alaska, 19950, 7100],
      [hawaii, 18360, 6530],
    ] as const) {
      const result = adapter.parse(raw, readShard(`${adapter.id}.json`));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.shard.base).toBe(base);
      expect(result.shard.perAdditionalPerson).toBe(per);
      expect(FederalPovertyLevelSchema.safeParse(result.shard).success).toBe(true);
    }
  });

  it("refuses a page that does not state the shard's year", () => {
    // HHS issues these each January. A page still showing last year's is the
    // one case where every number parses and every number is stale.
    const rolled = { ...readShard("federal-poverty-level-2024-contiguous.json"), year: 2027 };
    const result = contiguous.parse(raw, rolled);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("no 2027 poverty guidelines");
  });

  it("fails (-> alert) when the region's section is absent", () => {
    expect(
      contiguous.parse("2026 POVERTY GUIDELINES FOR ALASKA 1 $19,950", {
        ...readShard("federal-poverty-level-2024-contiguous.json"),
      }).ok,
    ).toBe(false);
  });
});

describe("adapters: SSA FICA (anchored prose)", () => {
  const adapter = adaptersForGroup("ssa")[0]!;
  const current = readShard("fica-2024.json");

  it("anchors the taxable maximum (wage base)", () => {
    const raw =
      "The maximum amount of earnings subject to the Social Security tax will increase to $176,100 in 2025.";
    const result = adapter.parse(raw, current);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shard.socialSecurityWageBase).toBe(176100);
    expect(FicaSchema.safeParse(result.shard).success).toBe(true);
  });

  it("fails (-> alert) when the wage base cannot be anchored", () => {
    expect(adapter.parse("no figure here", current).ok).toBe(false);
  });
});

describe("adapters: the federal standard deduction (IRS revenue procedure)", () => {
  const adapter = adaptersForGroup("irs")[0]!;
  const current = readShard("federal-income-tax-2024.json");
  // Rev. Proc. 2025-32 as the fetched PDF reads it: the 2025 table it replaces,
  // then the 2026 table this shard carries. Both are real federal standard
  // deductions, labelled identically, and the prose parser reaches the first.
  const raw =
    "the standard deduction amounts under § 63(c)(2) for any taxable year beginning in 2025 as" +
    " follows: Filing Status Standard Deduction Married Individuals Filing Joint Returns and" +
    " Surviving Spouses (§ 1(j)(2)(A)) $31,500 Heads of Households (§ 1(j)(2)(B)) $23,625" +
    " Unmarried Individuals (other than Surviving Spouses and Heads of Households)" +
    " (§ 1(j)(2)(C)) $15,750 Married Individuals Filing Separate Returns (§ 1(j)(2)(D)) $15,750" +
    " ... For taxable years beginning in 2026, the standard deduction amounts under § 63(c)(2)" +
    " are as follows: Filing Status Standard Deduction Married Individuals Filing Joint Returns" +
    " and Surviving Spouses (§ 1(j)(2)(A)) $32,200 Heads of Households (§ 1(j)(2)(B)) $24,150" +
    " Unmarried Individuals (other than Surviving Spouses and Heads of Households)" +
    " (§ 1(j)(2)(C)) $16,100 Married Individuals Filing Separate Returns (§ 1(j)(2)(D)) $16,100" +
    " (2) Dependent. For taxable years beginning in 2026, the standard deduction amount under" +
    " § 63(c)(5) ... cannot exceed the greater of (1) $1,350, or (2) the sum of $450 and the" +
    " individual's earned income.";

  it("reads the table for the shard's own tax year, not the first one on the page", () => {
    const result = adapter.parse(raw, current);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sd = result.shard.standardDeductionByFilingStatus as Record<string, number>;
    expect(sd.married_jointly).toBe(32200);
    expect(sd.qualifying_surviving_spouse).toBe(32200);
    expect(sd.head_of_household).toBe(24150);
    expect(sd.single).toBe(16100);
    // The two $16,100 rows are only told apart by their statutory cite.
    expect(sd.married_separately).toBe(16100);
    expect(JurisdictionSchema.safeParse(result.shard).success).toBe(true);
  });

  it("refuses a revenue procedure that does not state the shard's year", () => {
    // What next October looks like: the shard rolls to 2027 and this URL is
    // last year's document. The adapter it replaced watched Rev. Proc. 2023-34
    // for a 2026 shard — frozen in 2023, reporting agreement forever.
    const rolled = { ...current, taxYear: 2027 };
    const result = adapter.parse(raw, rolled);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("no standard-deduction table for 2027");
  });

  it("watches the revenue procedure that states the shard's figures", () => {
    expect(adapter.sourceUrl).toContain("rp-25-32");
  });

  it("fails (-> alert) when the table cannot be found at all", () => {
    expect(adapter.parse("no dollar figures in this layout", current).ok).toBe(false);
  });

  it("also serves the states that conform to the federal deduction", () => {
    // DC, New Mexico, Montana and North Dakota do not publish a standard
    // deduction — they use the federal one, which their own shard notes say.
    // Their adapters had been asking a state DOR page for a figure that page
    // was never going to state; the revenue procedure is their actual source.
    for (const id of [
      "state-dc-income-tax-2024",
      "state-nm-income-tax-2024",
      "state-mt-income-tax-2024",
      "state-nd-income-tax-2024",
    ]) {
      const conformity = ADAPTERS.find((a) => a.id === id)!;
      expect(conformity.sourceUrl).toContain("rp-25-32");
      const result = conformity.parse(raw, readShard(`${id}.json`));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const sd = result.shard.standardDeductionByFilingStatus as Record<string, number>;
      expect(sd).toEqual({ single: 16100, married_jointly: 32200, head_of_household: 24150 });
      expect(JurisdictionSchema.safeParse(result.shard).success).toBe(true);
    }
  });
});

describe("adapters: Minnesota (a source behind its own department)", () => {
  const adapter = adaptersForGroup("state-mn")[0]!;
  const current = readShard("state-mn-income-tax-2024.json");

  it("refuses the page that would roll Minnesota back a year", () => {
    const result = adapter.parse(
      "Then your Minnesota standard deduction is Single or Married Filing Separately $14,950" +
        " Married Filing Jointly or Qualifying Surviving Spouse $29,900",
      current,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("2025 amounts");
    expect(result.reason).toContain("roll Minnesota back a year");
  });

  it("refuses the 2025 amounts even when the page states them readably", () => {
    const result = adapter.parse(
      "Then your standard deduction is: Single $14,950 Married Filing Jointly $29,900" +
        " Head of Household $22,500",
      current,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("roll Minnesota back a year");
  });

  it("clears itself when the page states the shard's figures", () => {
    const result = adapter.parse(
      "Then your standard deduction is: Single $15,300 Married Filing Jointly $30,600" +
        " Head of Household $23,000",
      current,
    );
    expect(result.ok).toBe(true);
  });
});

describe("adapters: Utah (a source behind its own state's law)", () => {
  const adapter = adaptersForGroup("state-ut")[0]!;
  const current = readShard("state-ut-income-tax-2024.json");

  it("names the bill rather than rolling Utah back to the page's rate", () => {
    // The Tax Commission's rate schedule still reads "January 1, 2025 -
    // current, 4.5%". SB 60, signed 2026-03-23, cut it to 4.45% for 2026. The
    // page parses; the page is wrong. This is Iowa's failure with the direction
    // reversed, and only a named refusal is honest about it.
    const result = adapter.parse(
      "Date Range Tax Rate January 1, 2025 - current 4.5% or .045 January 1, 2024 -" +
        " December 31, 2024 4.55% or .0455 January 1, 2023 - December 31, 2023 4.65%",
      current,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("SB 60");
    expect(result.reason).toContain("4.45%");
  });

  it("refuses the superseded rate even when the page states it readably", () => {
    // The first version of this wrapper refused only when the PARSER failed, so
    // a page rewritten into a readable shape while still carrying 4.5% would
    // have sailed through and proposed exactly the rollback it exists to stop.
    const result = adapter.parse("The Utah individual income tax rate is 4.5%.", current);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("SB 60");
  });

  it("clears itself the day the table grows a row for the shard's year", () => {
    // The refusal wraps the real parser rather than replacing it, so nobody has
    // to remember to delete it — which is what Iowa's flat refusal needed.
    const result = adapter.parse(
      "Date Range Tax Rate 2026 4.45% 2025 4.5% 2024 4.55% 2023 4.65%",
      current,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const b = result.shard.bracketsByFilingStatus as Record<string, { rate: number }[]>;
    expect(b.single![0]!.rate).toBe(0.0445);
  });
});

describe("adapters: California (the chart, not the sentence)", () => {
  const adapter = adaptersForGroup("state-ca")[0]!;
  const current = readShard("state-ca-income-tax-2024.json");

  it("reads the FTB deduction chart", () => {
    const raw =
      "2025 Standard deduction amounts Filing status Enter on line 18 of your 540" +
      " Single or married/Registered Domestic Partner (RDP) filing separately $5,706" +
      " Married/RDP filing jointly, head of household, or qualifying widow(er) $11,412";
    const result = adapter.parse(raw, current);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sd = result.shard.standardDeductionByFilingStatus as Record<string, number>;
    expect(sd).toEqual({ single: 5706, married_jointly: 11412, head_of_household: 11412 });
    expect(JurisdictionSchema.safeParse(result.shard).success).toBe(true);
  });

  it("is not pointed at the Form 540-ES sentence, which states them backwards", () => {
    // "$5,706 single or married/RDP filing separately $11,412 married/RDP filing
    // jointly, head of household" is amount-then-label, and every pattern here
    // is label-then-amount — so `single` reaches past its own figure to the
    // next one and reads California's single deduction as $11,412. The chart
    // states the same numbers the right way round.
    expect(adapter.sourceUrl).toContain("/deductions/");
    expect(adapter.sourceUrl).not.toContain("540-es");
  });
});

describe("adapters: North Carolina (a table, then pages about itemizing)", () => {
  const adapter = adaptersForGroup("state-nc")[0]!;
  const current = readShard("state-nc-income-tax-2024.json");
  const raw =
    "If your filing status is: Your standard deduction is: Single $12,750" +
    " Married Filing Jointly/Qualifying Widow(er)/Surviving Spouse $25,500" +
    " Married Filing Separately Spouse does not claim itemized deductions $12,750" +
    " Head of Household $19,125 If you are not eligible for the federal standard deduction" +
    " ... the total home mortgage interest and real estate taxes claimed by both spouses" +
    " combined may not exceed $20,000 ... a single return, or a return as head of household" +
    " may not deduct more than $10,000 of real estate taxes paid or accrued.";

  it("reads the deduction table and not the itemizing prose beneath it", () => {
    // Bounding how far a label may reach was not enough here: "head of
    // household may not deduct more than $10,000 of real estate taxes" puts a
    // status label 43 characters from an amount that is not a standard
    // deduction. The page announces its own table, so the parser reads there.
    const result = adapter.parse(raw, current);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sd = result.shard.standardDeductionByFilingStatus as Record<string, number>;
    expect(sd).toEqual({ single: 12750, married_jointly: 25500, head_of_household: 19125 });
    expect(JurisdictionSchema.safeParse(result.shard).success).toBe(true);
  });

  it("narrows to a table only when the page announces one", () => {
    // A page that says nothing about where its table is gets read whole, as
    // before. This narrows; it never widens.
    expect(deductionTableRegion("Single $12,750 and nothing else")).toBe(
      "Single $12,750 and nothing else",
    );
    expect(deductionTableRegion("prose prose Your standard deduction is: Single $12,750")).toBe(
      "Your standard deduction is: Single $12,750",
    );
  });
});

describe("adapters: Missouri (a ladder split across two rows)", () => {
  const adapter = adaptersForGroup("state-mo")[0]!;
  const current = readShard("state-mo-income-tax-2024.json");
  // Withholding Formula_2026.pdf, abridged — the four other payroll frequencies
  // that sit between the two rows are kept, because they are the reason no
  // "rate in excess of a threshold" pattern can pair them.
  const raw =
    "2026 Missouri Withholding Tax Formula ... Rates 0.00% 2.00% 2.50% 3.00% 3.50% 4.00%" +
    " 4.50% 4.70% Daily Payroll $ 0.00 to $ 5.00 5.01 to 10.00 10.01 to 16.00 16.01 to 21.00" +
    " 21.01 to 26.00 26.01 to 31.00 31.01 to 36.00 36.01 and over Monthly Payroll $ 0.00 to" +
    " $ 112.00 112.01 to 225.00 225.01 to 337.00 337.01 to 449.00 449.01 to 562.00 562.01 to" +
    " 674.00 674.01 to 786.00 786.01 and over Annual Payroll $ 0.00 to $1,348.00 1,348.01 to" +
    " 2,696.00 2,696.01 to 4,044.00 4,044.01 to 5,392.00 5,392.01 to 6,740.00 6,740.01 to" +
    " 8,088.00 8,088.01 to 9,436.00 9,436.01 and over Note: By agreement between the employee";

  it("zips the rate row to the annual band row", () => {
    const result = adapter.parse(raw, current);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const b = result.shard.bracketsByFilingStatus as Record<
      string,
      { lowerBound: number; rate: number }[]
    >;
    // A band's opening cent is its predecessor's ceiling plus a penny, so the
    // bounds dedupe on the dollar.
    expect(b.single!.map((t) => t.lowerBound)).toEqual([
      0, 1348, 2696, 4044, 5392, 6740, 8088, 9436,
    ]);
    expect(b.single!.at(-1)!.rate).toBeCloseTo(0.047, 6);
    expect(JurisdictionSchema.safeParse(result.shard).success).toBe(true);
  });

  it("refuses to zip rows that do not line up", () => {
    const short = adapter.parse(raw.replace(" 4.50% 4.70%", " 4.50%"), current);
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.reason).toMatch(/rows that do not line up/);
  });

  it("refuses a formula from another year", () => {
    const stale = adapter.parse(
      raw.replace("2026 Missouri Withholding", "2025 Missouri Withholding"),
      current,
    );
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.reason).toMatch(/not the 2026 Missouri Withholding Tax Formula/);
      expect(stale.settled).toBe(true);
    }
  });
});

describe("adapters: West Virginia (a published tax table, read as rows)", () => {
  const adapter = adaptersForGroup("state-wv")[0]!;
  const current = readShard("state-wv-income-tax-2024.json");
  // tax.wv.gov's 2026 rate-cut page, abridged — including the SB 392 headline
  // and the married-filing-separately schedule underneath, both of which are
  // what defeated the generic parser.
  const raw =
    "W. Va. Code § 11-21-4j will be codified to reflect a 5% income tax cut for all West" +
    " Virginians retroactive to January 1, 2026. If the WV Taxable Income is: The tax is:" +
    " Not over $10,000 2.11% of taxable income" +
    " Over $10,000 but not over $25,000 $211.00 plus 2.81% of the excess over $10,000" +
    " Over $25,000 but not over $40,000 $632.50 plus 3.16% of excess over $25,000" +
    " Over $40,000 but not over $60,000 $1,106.50 plus 4.22% of excess over $40,000" +
    " Over $60,000 $1,950.50 plus 4.58% of excess over $60,000" +
    " For married individuals filing separate returns: Not over $5,000 2.11% of taxable" +
    " income Over $5,000 but not over $12,500 $105.50 plus 2.81% of excess over $5,000";

  it("pairs each rate with the floor stated inside its own clause", () => {
    // Three things on this page anchor at $10,000: the SB 392 headline ("a 5%
    // income tax cut"), the base tier ("Not over $10,000 2.11%"), and the second
    // tier ("plus 2.81% of the excess over $10,000"). Reading the trailing "of
    // the excess over" figure rather than the leading one is what keeps the base
    // rate out of the second bracket.
    const result = adapter.parse(raw, current);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const b = result.shard.bracketsByFilingStatus as Record<
      string,
      { lowerBound: number; rate: number }[]
    >;
    expect(b.single).toEqual([
      { lowerBound: 0, rate: 0.0211 },
      { lowerBound: 10000, rate: 0.0281 },
      { lowerBound: 25000, rate: 0.0316 },
      { lowerBound: 40000, rate: 0.0422 },
      { lowerBound: 60000, rate: 0.0458 },
    ]);
    expect(JurisdictionSchema.safeParse(result.shard).success).toBe(true);
  });

  it("stops where the married-filing-separately schedule begins", () => {
    // Those bands are half as wide ($5,000 / $12,500 / …), and a ladder
    // assembled from both schedules is thirteen tiers of nonsense.
    const result = adapter.parse(raw, current);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const b = result.shard.bracketsByFilingStatus as Record<string, { lowerBound: number }[]>;
      expect(b.single!.map((t) => t.lowerBound)).not.toContain(5000);
      expect(b.single!.map((t) => t.lowerBound)).not.toContain(12500);
    }
  });

  it("refuses when two rates claim one band", () => {
    const conflicting = raw.replace(
      "$632.50 plus 3.16% of excess over $25,000",
      "$632.50 plus 3.16% of excess over $25,000 and 3.90% of excess over $25,000",
    );
    const result = adapter.parse(conflicting, current);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/two rates claim the \$25000 band/);
  });
});

describe("the graduated parser's collision guard", () => {
  it("refuses rather than keeping whichever rate the regex reached first", () => {
    // A ladder assembled from a collision is wrong in the way nothing
    // downstream can see: right shape, right thresholds, one rate off, so it
    // passes the count-and-shape check that exists to catch reshapes.
    const oh = adaptersForGroup("state-oh")[0]!;
    const result = oh.parse(
      "For taxable years beginning in 2026: 3% on taxable income over $26,050" +
        " and 2.75% of the amount in excess of $26,050.",
      readShard("state-oh-income-tax-2024.json"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/two rates claim the same bracket threshold/);
  });
});

describe("adapters: Alabama (a chart, not a figure)", () => {
  const adapter = adaptersForGroup("state-al")[0]!;
  const current = readShard("state-al-income-tax-2024.json");

  it("says so for the other statutory figures too", () => {
    // Oklahoma froze its deduction at the 2017 federal amounts (68 O.S. §2358);
    // Maryland's is a statutory cap on a percentage, not an amount. Neither has
    // an annual figure for an adapter to read, and both were reporting the same
    // sentence a broken parser prints.
    for (const [group, shard, pattern] of [
      ["state-ok", "state-ok-income-tax-2024.json", /does not index/],
      ["state-md", "state-md-income-tax-2024.json", /statutory CAP/],
    ] as const) {
      const outcome = adaptersForGroup(group)[0]!.parse("A menu of links.", readShard(shard));
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.reason).toMatch(pattern);
        expect(outcome.settled).toBe(true);
      }
    }
  });

  it("refuses a figure that only exists as the corner of a chart", () => {
    // The FAQ this adapter used to watch is titled "How much is the Alabama
    // standard deduction?" and answers it by pointing at the chart without
    // reproducing one figure — so the parser reached into the Related FAQs
    // block below and read Alabama's 2%/4%/5% RATE brackets as dollars.
    const faq =
      "How much is the Alabama standard deduction? The Alabama standard deduction is based" +
      " on the filing status used by the taxpayer. For tax years ending 12/31/2007 and" +
      " forward, the Standard Deduction Chart is used to determine the Standard Deduction" +
      " allowable on your return. Related FAQs ... What is Alabama's Individual Income Tax" +
      " Rate? For married persons filing a joint return: 2% First $1,000 of taxable income" +
      " 4% Next $5,000 of taxable income 5% All taxable income over $6,000";
    const result = adapter.parse(faq, current);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/needs table geometry/);
      expect(result.settled).toBe(true);
    }
  });
});

describe("adapters: Wisconsin (a deduction inside a phase-out schedule)", () => {
  const adapter = adaptersForGroup("state-wi")[0]!;
  const current = readShard("state-wi-income-tax-2024.json");
  // 2026-Form1-ES-Inst.pdf, verbatim, including the Married Filing SEPARATELY
  // schedule that sits directly under the joint one.
  const raw =
    "Schedule for Single Taxpayers If Wisconsin income is: but over – not over –" +
    " The 2026 Standard Deduction is: of the amount over – $ 0 $ 20,119 $ 13,960" +
    " 20,119 136,453 13,960 less 12% ........ $ 20,120 136,453 0" +
    " Schedule for Head of Household If Wisconsin income is: but over – not over –" +
    " The 2026 Standard Deduction is: of the amount over – $ 0 $ 20,119 $ 18,030" +
    " 20,119 58,827 18,030 less 22.515% $ 20,120" +
    " Schedule for Married Filing Jointly If Wisconsin income is: but over – not over –" +
    " The 2026 Standard Deduction is: of the amount over – $ 0 $ 29,039 $ 25,840" +
    " 29,039 159,690 25,840 less 19.778% $ 29,040 159,690 0" +
    " Schedule for Married Filing Separately If Wisconsin income is: but over – not over –" +
    " The 2026 Standard Deduction is: of the amount over – $ 0 $ 13,779 $ 12,280";

  it("reads the maximum out of each named schedule, not the band that starts it", () => {
    // Wisconsin states no standard deduction as a figure — it states four
    // phase-out schedules, and the shard wants the maximum, which is the third
    // cell of the first row. A label-then-amount pattern reaches the `$ 0` that
    // opens the income band, 85 characters and a column heading later.
    const result = adapter.parse(raw, current);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shard.standardDeductionByFilingStatus).toEqual({
      single: 13960,
      married_jointly: 25840,
      head_of_household: 18030,
    });
    // Married filing SEPARATELY sits directly under joint, and $12,280 never
    // reaches the joint slot.
    expect(JurisdictionSchema.safeParse(result.shard).success).toBe(true);
  });

  it("refuses a form from another year", () => {
    const stale = adapter.parse(raw.replaceAll("The 2026 Standard", "The 2025 Standard"), current);
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.reason).toMatch(/does not state "The 2026 Standard Deduction"/);
      expect(stale.settled).toBe(true);
    }
  });
});

describe("adapters: Connecticut (a page whose wrong answer is plausible)", () => {
  const ct = adaptersForGroup("state-ct")[0]!;
  const current = readShard("state-ct-income-tax-2024.json");

  it("refuses without letting the parser try, because succeeding is the danger", () => {
    // Connecticut has no standard deduction; the shard's field carries the
    // CT-1040 Table A personal exemption. The DRS page states neither phrase —
    // its $15,000 / $19,000 / $24,000 are the gross-income FILING THRESHOLDS,
    // which equal the exemption amounts today and are a different figure. Every
    // other wrapper here runs the real parser first so the refusal clears
    // itself; that reasoning inverts on a page whose wrong answer is plausible.
    const thresholds = ct.parse(
      "... exceeds: $12,000 and you are married filing separately; $15,000 and you are" +
        " filing single; $19,000 and you are filing head of household; or $24,000 and you" +
        " are married filing jointly or qualifying surviving spouse.",
      current,
    );
    expect(thresholds.ok).toBe(false);
    if (!thresholds.ok) expect(thresholds.reason).toMatch(/no standard deduction/);

    // Even a page stating exactly the committed figures under the right labels
    // is refused: it is the concept that is wrong, not the numbers.
    const exact = ct.parse(
      "Standard deduction: Single $15,000 Married filing jointly $24,000" +
        " Head of household $19,000",
      current,
    );
    expect(exact.ok).toBe(false);
  });
});

describe("adapters: a table that names its own tax year", () => {
  const hi = adaptersForGroup("state-hi")[0]!;
  const current = readShard("state-hi-income-tax-2024.json");
  // tax.hawaii.gov/tax-year-information/, verbatim. The shard is on 2026, where
  // Act 46 (2023) steps Hawaii's amounts up to $16,000 / $12,000 / $8,000.
  const raw =
    "Standard Deductions For tax year 2025, the standard deduction amounts are the same as" +
    " in tax year 2024: $8,800 for Joint or Surviving Spouse; $6,424 for Head of Household;" +
    " or $4,400 for Single or Married Filing Separately.";

  it("refuses a table for a year that is not the shard's", () => {
    // The drift guard did catch this, at 63% — which is luck. It is the size of
    // the gap that saved the shard, not anything the parser understood, and two
    // adjacent years of ordinary indexation differ by 3%.
    const result = hi.parse(raw, current);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.reason).toMatch(/states tax year 2025 and 2024 and this shard is 2026/);
  });

  it("says nothing about the year when the page states no table at all", () => {
    // With no lead-in the region is the whole document, and a "for tax year
    // 2025" in a department's news column would refuse a page for a year its
    // deduction table never claimed — a refusal whose sentence is not true.
    expect(
      statedTaxYears(
        "prose about tax year 2025 and other things",
        "prose about tax year 2025 and other things",
      ),
    ).toEqual([]);
  });

  it("finds a table announced by a phrase that ends in a colon", () => {
    // Kansas states its figures once, in the annual income booklet, under "The
    // following amounts will be the standard deduction for most people in tax
    // year 2025 to enter on line 4:" — a lead-in with no "your", no "amounts",
    // no "table", and eleven words between the phrase and its colon. Without
    // it the region was the whole booklet, and the refusal was about a tax
    // table 150 amounts wide instead of about the year.
    const ks = adaptersForGroup("state-ks")[0]!;
    const result = ks.parse(
      "April 15, 2026 is the due date for filing 2025 income tax returns. Kansas Standard" +
        " Deduction The following amounts will be the standard deduction for most people in" +
        " tax year 2025 to enter on line 4: Single - $3,605 Married Filing Joint - $8,240" +
        " Head of Household - $6,180 Married Filing Separate - $4,120",
      readShard("state-ks-income-tax-2024.json"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/states tax year 2025 and this shard is 2026/);
  });

  it("reads a table that names the shard's own year", () => {
    const thisYear = hi.parse(
      "For tax year 2026 the standard deduction amounts are: Single $8,000" +
        " Married filing jointly $16,000 Head of household $12,000",
      current,
    );
    expect(thisYear.ok).toBe(true);
    if (thisYear.ok) {
      expect(thisYear.shard.standardDeductionByFilingStatus).toEqual({
        single: 8000,
        married_jointly: 16000,
        head_of_household: 12000,
      });
    }
  });
});

describe("adapters: Georgia (the amount, then the statuses it applies to)", () => {
  const adapter = adaptersForGroup("state-ga")[0]!;
  const current = readShard("state-ga-income-tax-2024.json");
  // Georgia DOR, "Employer's Withholding Tax Guide 2026", revised June 2026 —
  // the sentence verbatim, under the masthead the year check reads.
  const raw =
    "EMPLOYER\u2019S WITHHOLDING TAX GUIDE 2026 REVISED: June 2026 ... employers may" +
    " withhold at the rate of 5.19% before the effective date of the change and can begin" +
    " withholding at the new rate of 4.99%, starting May 11, 2026. \u2022 Georgia standard" +
    " deductions have increased to $30,000 for taxpayers filing Married Filing Jointly and" +
    " $15,000 for Single, Head of Household, and Married Filing Separate taxpayers." +
    " \u2022 The dependent deduction was raised from $4,000 to $5,000.";

  it("reads a deduction stated amount-first, and does not double it for head of household", () => {
    // Georgia states its figures backwards in BOTH of its documents, so unlike
    // California there is nothing to repoint to. And the list is the point: the
    // deduction does not double for head of household in Georgia — head of
    // household takes the single amount, like married filing separately — so a
    // parser assuming the federal 1.5x shape would be wrong by $7,500 while
    // looking perfectly healthy.
    const result = adapter.parse(raw, current);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shard.standardDeductionByFilingStatus).toEqual({
      single: 15000,
      married_jointly: 30000,
      head_of_household: 15000,
    });
    expect(JurisdictionSchema.safeParse(result.shard).success).toBe(true);
  });

  it("refuses a guide from another year", () => {
    // The Form 446 rule: reissued annually at a URL carrying the year, and a
    // stale one states last year's deduction perfectly.
    const stale = adapter.parse(raw.replace("TAX GUIDE 2026", "TAX GUIDE 2025"), current);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.reason).toMatch(/not the 2026 Employer's Withholding Tax Guide/);
  });

  it("serves South Carolina too, whose SCIAD is stated the same way round", () => {
    // dor.sc.gov/news/information-about-h-4216, verbatim. Same shape, different
    // state, and no annual masthead to check: H. 4216 is a one-off bill
    // announcement, not a guide reissued each year at a year-stamped URL.
    const sc = adaptersForGroup("state-sc")[0]!;
    const result = sc.parse(
      "Creates a new South Carolina Income Adjusted Deduction (SCIAD) in place of the" +
        " federal standard deduction. $15,000 for taxpayers who file as single or married" +
        " filing separately $22,500 for taxpayers who file as head of household $30,000 for" +
        " taxpayers who file as married filing jointly",
      readShard("state-sc-income-tax-2024.json"),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.shard.standardDeductionByFilingStatus).toEqual({
        single: 15000,
        married_jointly: 30000,
        head_of_household: 22500,
      });
    }
  });

  it("refuses when two amounts claim the same status", () => {
    const conflicting = adapter.parse(
      raw + " Georgia standard deductions have increased to $24,000 for Married Filing Jointly.",
      current,
    );
    expect(conflicting.ok).toBe(false);
    if (!conflicting.ok)
      expect(conflicting.reason).toMatch(/two amounts claim the married_jointly/);
  });
});

describe("adapters: a state that has not published the shard's year", () => {
  // "could not anchor any standard-deduction figure by filing status" and "the
  // state has not published this year yet" look identical in the report and
  // mean opposite things. One says fix a parser; the other says nothing is
  // wrong. Oregon and Vermont are both the second, and both shards say so in
  // their own notes.
  it("names the reason instead of reporting a broken parser", () => {
    const or = adaptersForGroup("state-or")[0]!;
    const menu = or.parse("Personal income tax Forms Where's my refund? Contact us", {
      ...readShard("state-or-income-tax-2024.json"),
    });
    expect(menu.ok).toBe(false);
    if (!menu.ok) expect(menu.reason).toMatch(/has not published its 2026 Form OR-40/);

    const ne = adaptersForGroup("state-ne")[0]!;
    const forms = ne.parse("Individual Income Tax Forms 2025 2024 2023 Prior years", {
      ...readShard("state-ne-income-tax-2024.json"),
    });
    expect(forms.ok).toBe(false);
    if (!forms.ok) expect(forms.reason).toMatch(/has not published its 2026 Tax Calculation/);

    const ar = adaptersForGroup("state-ar")[0]!;
    const arForms = ar.parse("Individual Income Tax 2025 Tax Forms Prior years", {
      ...readShard("state-ar-income-tax-2024.json"),
    });
    expect(arForms.ok).toBe(false);
    if (!arForms.ok) expect(arForms.reason).toMatch(/has not published its 2026 individual/);

    const vt = adaptersForGroup("state-vt")[0]!;
    const rates = vt.parse("2025 Vermont Rate Schedules 2025 Vermont Tax Tables", {
      ...readShard("state-vt-income-tax-2024.json"),
    });
    expect(rates.ok).toBe(false);
    if (!rates.ok) expect(rates.reason).toMatch(/has not published its 2026 annual rate schedules/);
  });

  it("clears itself the day the state does publish", () => {
    // The real parser still runs first, so this explanation stops being printed
    // without anyone having to remember to delete it. (Oregon's own 2025 table,
    // read as though it were the 2026 one — the shape is what is under test.)
    const or = adaptersForGroup("state-or")[0]!;
    const published = or.parse(
      "Table 5. Standard deduction Single $2,835 Married filing jointly $5,670" +
        " Head of household $4,560 Qualifying surviving spouse $5,670",
      readShard("state-or-income-tax-2024.json"),
    );
    expect(published.ok).toBe(true);
    if (published.ok) {
      expect(published.shard.standardDeductionByFilingStatus).toEqual({
        single: 2835,
        married_jointly: 5670,
        head_of_household: 4560,
      });
    }
  });
});

describe("adapters: Maine (a rate schedule that mentions the table before stating it)", () => {
  const adapter = adaptersForGroup("state-me")[0]!;
  const current = readShard("state-me-income-tax-2024.json");
  // Maine Revenue Services, "2026 Individual Income Tax Rates", revised
  // 2026-05-20 — abridged, but every phrase below is the document's own, in the
  // document's order. maine.gov/revenue/taxes/income-estate-tax, which this
  // adapter watched, is a menu and states none of it.
  const raw =
    "State of Maine 2026 Individual Income Tax Rates ... The Maine standard deduction and" +
    " personal exemption amounts are adjusted by multiplying the cost-of-living adjustment," +
    " 1.279, by the dollar amount of the standard deduction specified in 36 M.R.S. § 5124-C." +
    " Single Individuals and Married Persons Filing Separate Returns If the taxable income is:" +
    " The tax is: Less than $27,400 5.8% of Maine taxable income $27,400 but less than $64,850" +
    " $1,589 plus 6.75% of excess over $27,400 ... Married Individuals and Surviving Spouses" +
    " Filing Joint Returns Less than $54,850 5.8% of Maine taxable income" +
    " Personal Exemption: $5,300 – applicable to the taxpayer (and spouse if married filing" +
    " jointly) Standard Deduction: Single - $15,700 Married Filing Jointly - $31,400" +
    " Head of Household - $23,550 Married Filing Separately - $15,700" +
    " Additional Amount for Age or Blindness: $1,650 if married (whether filing jointly or" +
    " separately) or a qualified surviving spouse. The additional amount is $3,300 if one" +
    " spouse is 65 or over and blind, $6,600 if both spouses are 65 or over and blind.";

  it("reads the standard deduction the rate schedule states", () => {
    const result = adapter.parse(raw, current);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sd = result.shard.standardDeductionByFilingStatus as Record<string, number>;
    expect(sd).toEqual({ single: 15700, married_jointly: 31400, head_of_household: 23550 });
    expect(JurisdictionSchema.safeParse(result.shard).success).toBe(true);
  });

  it("skips a lead-in with no table under it and stops at the age/blindness add-on", () => {
    // Three separate ways this document defeated the first version of the
    // narrowing, each of which alone left Maine unwatched:
    const region = deductionTableRegion(raw);
    // 1. It MENTIONS "standard deduction ... amounts" 1,500 characters above
    //    the table. Taking the first lead-in narrowed to prose with no figure.
    expect(region).not.toContain("cost-of-living");
    // 2. Its lead-in is a bare colon — no "your", no "amounts", no "table".
    expect(region.startsWith("Standard Deduction:")).toBe(true);
    // 3. The ADDITIONAL amount for age and blindness sits inside 400 characters
    //    of the table, in a sentence containing "married ... filing jointly",
    //    so $3,300 is a second married_jointly candidate and the ambiguity
    //    guard would refuse the whole page over a figure that is not a standard
    //    deduction at all.
    expect(region).not.toContain("Additional Amount");
    expect(region).not.toContain("3,300");
  });

  it("cites the document that states the figures, not the tax division's menu", () => {
    expect(adapter.sourceUrl).toContain("ind_tax_rate_sched");
    const citation = current.citation as { sourceUrl: string };
    expect(citation.sourceUrl).toBe(adapter.sourceUrl);
  });
});

describe("adapters: Michigan (Form 446's masthead)", () => {
  const adapter = adaptersForGroup("state-mi")[0]!;
  const current = readShard("state-mi-income-tax-2024.json");
  const raw =
    "446 (Rev. 02-26) 2026 Michigan Income Tax Withholding Guide Withholding Rate: 4.25%" +
    " Personal Exemption Amount: $5,900 INCOME TAX WITHHOLDING: Every Michigan employer";

  it("reads the rate and the exemption the form states side by side", () => {
    // michigan.gov/taxes/iit, which this adapter watched, states neither: it is
    // a menu. "Withholding rate" is only the income-tax rate because Michigan
    // makes them the same figure by statute (MCL 206.51 / 206.351), which is
    // why this is a dedicated parser and not another shared pattern.
    const result = adapter.parse(raw, current);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const b = result.shard.bracketsByFilingStatus as Record<string, { rate: number }[]>;
    expect(b.single![0]!.rate).toBe(0.0425);
    expect(b.married_jointly![0]!.rate).toBe(0.0425);
    expect((result.shard.personalExemptionByFilingStatus as Record<string, number>).single).toBe(
      5900,
    );
    expect(JurisdictionSchema.safeParse(result.shard).success).toBe(true);
  });

  it("refuses a Form 446 from another year", () => {
    // Form 446 is reissued annually at a URL carrying the tax year, so a stale
    // one parses perfectly and states last year's rate — the Iowa failure, and
    // insisting the document names its year is the only defence against it.
    const result = adapter.parse(raw, { ...current, taxYear: 2027 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("not the 2027 Michigan Income Tax Withholding Guide");
  });
});

describe("adapters: state income tax (NY, the per-state template)", () => {
  const adapter = adaptersForGroup("state-ny")[0]!;
  const current = readShard("state-ny-income-tax-2024.json");

  it("overlays the NY standard deduction and validates as a jurisdiction", () => {
    const raw =
      "For 2025, the New York standard deduction for single filers is $8,200, for married filing jointly $16,450, and for head of household $11,500.";
    const result = adapter.parse(raw, current);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sd = result.shard.standardDeductionByFilingStatus as Record<string, number>;
    expect(sd.single).toBe(8200);
    expect(sd.married_jointly).toBe(16450);
    expect(sd.head_of_household).toBe(11500);
    expect(JurisdictionSchema.safeParse(result.shard).success).toBe(true);
  });

  it("skips the row stating a DEPENDENT's deduction", () => {
    // New York's page states two single amounts, and the dependent one is
    // smaller — so reaching it does not produce a number that looks wrong, it
    // produces a number that looks like a stingier state. The shard models a
    // filer who is nobody's dependent, so that row is not its figure under any
    // reading, and skipping it is not a guess. ("cannot be claimed" does not
    // contain "can be claimed", so the wanted row survives.)
    const raw =
      "Filing status Standard deduction amount" +
      " Single (and can be claimed as a dependent on another taxpayer's federal return) $3,100" +
      " Single (and cannot be claimed as a dependent on another taxpayer's federal return) $8,000" +
      " Married filing joint return $16,050 Head of household (with qualifying person) $11,200";
    const result = adapter.parse(raw, current);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sd = result.shard.standardDeductionByFilingStatus as Record<string, number>;
    expect(sd.single).toBe(8000);
    expect(sd.married_jointly).toBe(16050);
    expect(sd.head_of_household).toBe(11200);
  });

  it("decodes numeric HTML entities instead of reading them as amounts", () => {
    // New York numbers its rows with circled digits. Left as literal text,
    // `&#9312;` is four digits sitting exactly where an amount goes, and a
    // status label bridges straight to it — the parser read 9,312 as a
    // deduction, which is a plausible-looking number for a state to have.
    const raw =
      "Standard deduction amount &#9312; Single $8,000 &#9313; Married filing joint return" +
      " $16,050 &#9315; Head of household (with qualifying person) $11,200";
    const result = adapter.parse(raw, current);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.shard.standardDeductionByFilingStatus as Record<string, number>).single).toBe(
      8000,
    );
  });

  it("watches the standard-deduction page, not the bracket tables", () => {
    // The tax tables state brackets — the reviewer's step — and never the
    // deduction, which is the figure this adapter exists to anchor.
    expect(adapter.sourceUrl).toContain("standard_deductions");
  });

  it("fails (-> alert) when no deduction can be anchored (layout changed)", () => {
    expect(
      adapter.parse("the rate schedule was published without deduction figures", current).ok,
    ).toBe(false);
  });
});

describe("adapters: flat-rate state income tax (PA / IL / MI)", () => {
  it("overlays the PA flat rate across every filing status", () => {
    const adapter = adaptersForGroup("state-pa")[0]!;
    const current = readShard("state-pa-income-tax-2024.json");
    const raw = "For 2025 the Pennsylvania personal income tax rate is 3.00%.";
    const result = adapter.parse(raw, current);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const brackets = result.shard.bracketsByFilingStatus as Record<
      string,
      { lowerBound: number; rate: number }[]
    >;
    expect(brackets.single![0]!.rate).toBe(0.03);
    expect(brackets.married_jointly![0]!.rate).toBe(0.03);
    expect(brackets.head_of_household![0]!.rate).toBe(0.03);
    expect(JurisdictionSchema.safeParse(result.shard).success).toBe(true);
  });

  it("overlays the IL flat rate and the personal exemption", () => {
    const adapter = adaptersForGroup("state-il")[0]!;
    const current = readShard("state-il-income-tax-2024.json");
    const raw = "The Illinois income tax rate is 4.95 percent. The personal exemption is $2,850.";
    const result = adapter.parse(raw, current);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const brackets = result.shard.bracketsByFilingStatus as Record<
      string,
      { lowerBound: number; rate: number }[]
    >;
    expect(brackets.single![0]!.rate).toBe(0.0495);
    const exemptions = result.shard.personalExemptionByFilingStatus as Record<string, number>;
    expect(exemptions.single).toBe(2850);
    expect(JurisdictionSchema.safeParse(result.shard).success).toBe(true);
  });

  it("fails (-> alert) when no rate can be anchored", () => {
    const adapter = adaptersForGroup("state-mi")[0]!;
    const current = readShard("state-mi-income-tax-2024.json");
    expect(adapter.parse("the page no longer states a rate", current).ok).toBe(false);
  });

  it("fails (-> alert) on an implausible (out-of-range) rate", () => {
    const adapter = adaptersForGroup("state-mi")[0]!;
    const current = readShard("state-mi-income-tax-2024.json");
    expect(adapter.parse("the combined tax rate is 35%", current).ok).toBe(false);
  });
});

describe("adapters: graduated bracket-table state income tax (OH)", () => {
  const adapter = adaptersForGroup("state-oh")[0]!;
  const current = readShard("state-oh-income-tax-2024.json");

  it("overlays the graduated schedule (rate + threshold) onto every status", () => {
    // Dated, because it is a change: Ohio states one schedule per year, and the
    // shard's year picks the block.
    const raw =
      "For taxable years beginning in 2026: Ohio taxable nonbusiness income up to $26,150" +
      " is taxed at 0%. Income is taxed at 2.75% of the amount in excess of $26,150.";
    const result = adapter.parse(raw, current);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const brackets = result.shard.bracketsByFilingStatus as Record<
      string,
      { lowerBound: number; rate: number }[]
    >;
    expect(brackets.single).toEqual([
      { lowerBound: 0, rate: 0 },
      { lowerBound: 26150, rate: 0.0275 },
    ]);
    // The same schedule is applied to every filing status.
    expect(brackets.married_jointly![1]!.lowerBound).toBe(26150);
    expect(brackets.head_of_household![1]!.rate).toBe(0.0275);
    expect(JurisdictionSchema.safeParse(result.shard).success).toBe(true);
  });

  it("does not let a 0% base tier wrongly pair with a higher threshold", () => {
    const raw =
      "The first $26,050 is taxed at 0%; 2.75% applies to the amount in excess of $26,050.";
    const result = adapter.parse(raw, current);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const brackets = result.shard.bracketsByFilingStatus as Record<
      string,
      { lowerBound: number; rate: number }[]
    >;
    // Base tier stays 0% at $0 — never 0% at $26,050.
    expect(brackets.single![0]).toEqual({ lowerBound: 0, rate: 0 });
    expect(brackets.single![1]!.rate).toBe(0.0275);
  });

  it("takes the shard's year out of a page that states a schedule per year", () => {
    // tax.ohio.gov/individual/resources/annual-tax-rates prints every year since
    // 2005, newest first. Read whole, the years mix into one ladder and the
    // report says "count or shape changed" — true of the mixture and false of
    // the page.
    const perYear =
      "For taxable years beginning in 2026: $0 - $26,150 0.000% of Ohio taxable nonbusiness" +
      " income; 2.75% of the amount in excess of $26,150." +
      " For taxable years beginning in 2025: $0 - $26,050 0.000%; $342 + 2.75% of excess" +
      " over $26,050; $2,394.32 + 3.125% of excess over $100,000.";
    const result = adapter.parse(perYear, current);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const b = result.shard.bracketsByFilingStatus as Record<string, { lowerBound: number }[]>;
      expect(b.single).toHaveLength(2);
      expect(b.single![1]!.lowerBound).toBe(26150);
    }

    // And when the shard's year is not among them, that is the state not having
    // published it — not a parser to fix.
    const notYet = adapter.parse(perYear, { ...current, taxYear: 2027 });
    expect(notYet.ok).toBe(false);
    if (!notYet.ok) {
      expect(notYet.reason).toMatch(/schedules stop at 2026/);
      expect(notYet.settled).toBe(true);
    }
  });

  it("lets an undated schedule confirm the shard but never change it", () => {
    // Missouri's year-changes page printed an eight-tier ladder under "Tax Rate
    // Changes – Indexed for Inflation" with no year anywhere near it, and that
    // ladder was 2025's: $1,313 steps where the 2026 shard carries $1,348. Read
    // whole it parsed cleanly and proposed rolling every threshold in the state
    // back a year, under a live citation. (Missouri now reads its dated
    // withholding formula instead.)
    const moved = "2.75% of the amount in excess of $26,150.";
    const rolled = adapter.parse(moved, current);
    expect(rolled.ok).toBe(false);
    if (!rolled.ok) expect(rolled.reason).toMatch(/no tax year attached to it/);

    // Refusing every undated schedule would be the wrong correction, because
    // confirming the shard is always safe — only changing it on an undated page
    // is unsafe. The state that motivated the carve-out was Mississippi, whose
    // rate had no year to state; it has since moved to a dated by-year table and
    // its own parser, so the rule is now carried by this property rather than by
    // any live source. An undated schedule that agrees is still accepted.
    const confirming = "$332 + 2.75% of the amount in excess of $26,050.";
    expect(adapter.parse(confirming, current).ok).toBe(true);
  });

  it("fails (-> alert) when no tier can be anchored", () => {
    expect(adapter.parse("the schedule was published without rate figures", current).ok).toBe(
      false,
    );
  });

  it("fails (-> alert) on a structural change (a tier added)", () => {
    // Four anchored tiers can't fit the committed two-bracket shape, so the
    // reshape routes to a reviewer rather than being silently overlaid.
    const raw =
      "2.00% in excess of $26,050; 2.75% in excess of $50,000; " +
      "3.50% in excess of $100,000; 4.00% in excess of $250,000.";
    expect(adapter.parse(raw, current).ok).toBe(false);
  });
});

describe("adapters: seventh set — the remaining seeded states", () => {
  it("overlays the AZ flat rate across every status (flat parser reused)", () => {
    const adapter = adaptersForGroup("state-az")[0]!;
    const current = readShard("state-az-income-tax-2024.json");
    const raw = "For 2026 the Arizona individual income tax rate is 2.50%.";
    const result = adapter.parse(raw, current);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const brackets = result.shard.bracketsByFilingStatus as Record<
      string,
      { lowerBound: number; rate: number }[]
    >;
    expect(brackets.single![0]!.rate).toBe(0.025);
    expect(brackets.married_jointly![0]!.rate).toBe(0.025);
    expect(JurisdictionSchema.safeParse(result.shard).success).toBe(true);
  });

  it("overlays the CO flat rate (flat parser reused)", () => {
    const adapter = adaptersForGroup("state-co")[0]!;
    const current = readShard("state-co-income-tax-2024.json");
    const result = adapter.parse("The Colorado income tax rate is 4.40 percent.", current);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const brackets = result.shard.bracketsByFilingStatus as Record<
      string,
      { lowerBound: number; rate: number }[]
    >;
    expect(brackets.single![0]!.rate).toBe(0.044);
    expect(JurisdictionSchema.safeParse(result.shard).success).toBe(true);
  });

  it("overlays the IN flat rate and its personal exemption (like IL)", () => {
    const adapter = adaptersForGroup("state-in")[0]!;
    const current = readShard("state-in-income-tax-2024.json");
    const raw = "The Indiana income tax rate is 2.95%. The personal exemption is $1,000.";
    const result = adapter.parse(raw, current);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const brackets = result.shard.bracketsByFilingStatus as Record<
      string,
      { lowerBound: number; rate: number }[]
    >;
    expect(brackets.single![0]!.rate).toBe(0.0295);
    const exemptions = result.shard.personalExemptionByFilingStatus as Record<string, number>;
    expect(exemptions.single).toBe(1000);
    expect(JurisdictionSchema.safeParse(result.shard).success).toBe(true);
  });

  it("anchors a flat rate out of real agency prose, not a lab sentence", () => {
    // Agencies do not write "the income tax rate is 4.95%". They write these.
    expect(
      anchorFlatRate("The Indiana Individual adjusted gross income tax rate for 2026 is 2.95%."),
    ).toBe(2.95);
    expect(
      anchorFlatRate(
        "Pennsylvania personal income tax is levied at the rate of 3.07 percent against taxable income.",
      ),
    ).toBe(3.07);
    expect(
      anchorFlatRate("The Georgia income tax rate has been reduced to a flat rate of 4.99%."),
    ).toBe(4.99);
    expect(anchorFlatRate("Nothing about rates here at all.")).toBe("none");
  });

  it("refuses rather than guess when a page states two different rates", () => {
    // Bridging words between "rate" and the number is what makes real prose
    // parse, and also what could let a page's OTHER rate through. An adapter
    // that anchors the wrong figure is worse than one that anchors none, so
    // disagreement routes to the fail-safe alert.
    expect(
      anchorFlatRate(
        "The income tax rate for 2025 is 4.25%. The income tax rate for 2026 is 4.05%.",
      ),
    ).toBe("ambiguous");
    // Agreement across several statements of the same rate is not ambiguity.
    expect(
      anchorFlatRate("The income tax rate is 4.95%. Illinois income tax rate: 4.95 percent."),
    ).toBe(4.95);
  });

  it("reads a rate out of a table, which is where flat states actually put it", () => {
    // Illinois states its rate as a table row: a label cell and a value cell,
    // with the word "rate" only in the column heading. In the markup those two
    // cells are a hundred characters of attributes apart, and in the visible
    // text they are adjacent — which is the whole reason the markup is stripped
    // before anything is matched.
    expect(
      anchorFlatRate(
        "<td><strong>Business Income Tax</strong></td>" +
          "<td>Effective July 1, 2017:<ul><li>Corporations – 7 percent of net income</li></ul></td>" +
          "<td><strong>Individual Income Tax</strong></td>" +
          "<td>Effective July 1, 2017:<ul><li>4.95 percent of net income</li></ul></td>",
      ),
    ).toBe(4.95);
    // "Individual" is what keeps that loose pattern honest: the corporate row
    // above states 7% in exactly the same shape.
    expect(anchorFlatRate("Arizona's flat tax rate of 2.5%.")).toBe(2.5);
  });

  it("ignores a page's own stylesheet and meta tags", () => {
    // A mega-menu's CSS is full of percentages (33.3333333333%) and a meta
    // description repeats the body text, so one stated rate could match four
    // times. Both would have made the ambiguity guard mean something else.
    expect(
      anchorFlatRate(
        "<style>.col{width:33.3333333333%;}</style>" +
          '<meta name="description" content="Individual Income Tax: 4.95 percent">' +
          "<p>Individual Income Tax: 4.95 percent of net income</p>",
      ),
    ).toBe(4.95);
  });

  it("reads a by-year rate table for the shard's own year when it has one", () => {
    // A table labelled by year can be asked for a year, and the shard says
    // which one it is — the same anchor the federal revenue procedure uses.
    const table =
      "Colorado Income Tax Rates Tax Year Tax Rate 2022 4.4% 2023 4.4% 2024 4.25% 2026 4.55%";
    expect(anchorFlatRate(table, 2026)).toBe(4.55);
    expect(anchorFlatRate(table, 2024)).toBe(4.25);
  });

  it("reads a year-HEADED rate schedule, not just a year-per-row table", () => {
    // Idaho publishes the same fact in the other layout: a heading per year with
    // a whole schedule under it. The year and its rate are forty characters and
    // two dollar amounts apart, so the row reader cannot see it, and the report
    // said "could not anchor the flat income-tax rate" about a page that states
    // Idaho's rate plainly.
    const idaho =
      "Individual Income Tax Rate Schedule How to Use: Calculate your tax rate based upon" +
      " your taxable income (the first two columns)." +
      " Year 2025 Single At least No more than Tax rate $1 $4,811 0.0% $4,812 5.3%" +
      " Married At least No more than Tax rate $1 $9,622 0.0% $9,623 5.3%" +
      " Year 2024 Single At least No more than Tax rate $1 $4,673 0.0% $4,674 5.695%";
    expect(anchorFlatRate(idaho, 2025)).toBe(5.3);
    expect(anchorFlatRate(idaho, 2024)).toBe(5.695);
    // And the year that is not there is the point: the state has not published
    // it, which is a different fact from a page nobody can read.
    expect(anchorFlatRate(idaho, 2026)).toEqual({ historical: true, latestYear: 2025 });
  });

  it("will not read a year-headed block that states two different rates", () => {
    // A block with more than one non-zero rate is a graduated schedule, which
    // this parser has no business reading. Idaho's repeats 5.3% for single and
    // married, which is why its blocks are legible at all.
    const graduated =
      "Year 2025 First $10,000 3.0% Next $20,000 5.0% Year 2024 First $10,000 3.0% Next 5.0%";
    expect(anchorFlatRate(graduated, 2025)).toBe("none");
  });

  it("needs a run of rows before it will treat anything as a by-year table", () => {
    // One "2026 8%" in a document is a coincidence, and the first draft of the
    // year-row reader found one in Colorado's guide and proposed an 8% flat
    // tax. Three pairs in sequence is a table; nothing else reads like that.
    expect(anchorFlatRate("Filed by 2026 8% of filers used the portal.", 2026)).toBe("none");
  });

  it("refuses to read a rate out of a by-year history table", () => {
    // Colorado's Individual Income Tax Guide prints a rate per year, and every
    // pattern reaches the first row — so the guide would have proposed rolling
    // Colorado back to 2019. Each of these is a real Colorado rate differing by
    // tenths, so no plausibility band separates them; only the shape does.
    const history =
      "Colorado Income Tax Rates Tax Year Tax Rate 2019 4.5% 2020 4.55% 2021 4.5%" +
      " 2022 4.4% 2023 4.4% 2024 4.25% 2025 4.4%";
    expect(anchorFlatRate(history)).toEqual({ historical: true, latestYear: 2025 });
    // And a shard whose year the table has not reached is told exactly that,
    // because a table ending before the shard begins is the state not having
    // published yet — a different thing from a parser that cannot read.
    expect(anchorFlatRate(history, 2026)).toEqual({ historical: true, latestYear: 2025 });
    // A sentence that names the year is not a table row. The difference is the
    // word between the year and the number.
    expect(anchorFlatRate("The income tax rate for 2026 is 2.95%.")).toBe(2.95);
  });

  it("rejects an implausible percentage before it can reach a shard", () => {
    expect(anchorFlatRate("The income tax rate is 95%.")).toBe("none");
    expect(anchorFlatRate("The income tax rate is 0%.")).toBe("none");
  });

  it("refuses an anchored figure that moved implausibly far", () => {
    // A dry run of every adapter found six anchoring page furniture as dollars:
    // California's standard deduction came back as 2019 and Delaware's as 2014.
    // Those are years. An indexed figure moves a few percent a year, so a figure
    // that moves by a third is either a reform a person should transcribe or a
    // number the parser had no business reading.
    expect(implausibleDrift(11412, 2019)).toMatch(/82% away/);
    expect(implausibleDrift(3250, 2014)).toMatch(/38% away/);
    // Ordinary indexation passes untouched.
    expect(implausibleDrift(15300, 15700)).toBeNull();
    expect(implausibleDrift(2470, 2530)).toBeNull();
    // Exactly at the band is still fine; past it is not.
    expect(implausibleDrift(1000, 1250)).toBeNull();
    expect(implausibleDrift(1000, 1251)).toMatch(/away from the committed 1000/);
    // A committed zero has no scale to judge against, so it is not second-guessed.
    expect(implausibleDrift(0, 5000)).toBeNull();
  });

  it("lets the shard's year pick the column when the table labels its columns", () => {
    // Rhode Island's inflation advisory prints "Filing status 2025 2026 / Single
    // $10,900 $11,200" — last year beside this one. Taking the first match rolls
    // the shard BACKWARDS a year, which the dry run caught the day PDF support
    // made that page parseable at all, so it was refused outright.
    //
    // But a table that labels its columns is not ambiguous. The shard knows its
    // own tax year, and the header says which column that is — the same anchor
    // the federal revenue procedure and the SNAP region tables already use. So
    // the refusal now applies only where the page declines to say.
    const ri = adaptersForGroup("state-ri")[0]!;
    const labelled = ri.parse(
      "Rhode Island standard deduction amounts by Tax Year Filing status 2025 2026" +
        " Single $10,900 $11,200 Married filing jointly* $21,800 $22,400" +
        " Head of household $16,350 $16,800 Married filing separately $10,900 $11,200",
      readShard("state-ri-income-tax-2024.json"),
    );
    expect(labelled.ok).toBe(true);
    if (labelled.ok) {
      expect(labelled.shard.standardDeductionByFilingStatus).toEqual({
        single: 11200,
        married_jointly: 22400,
        head_of_household: 16800,
      });
    }

    // Strip the header and the same two columns are a guess again: refused.
    const unlabelled = ri.parse(
      "Single $10,900 $11,200 Married filing jointly $21,800 $22,400",
      readShard("state-ri-income-tax-2024.json"),
    );
    expect(unlabelled.ok).toBe(false);
    if (!unlabelled.ok) expect(unlabelled.reason).toMatch(/no year header above it/);

    // A header that does not name the shard's year is no better than none.
    const wrongYears = ri.parse(
      "Filing status 2023 2024 Single $10,900 $11,200 Married filing jointly $21,800 $22,400",
      readShard("state-ri-income-tax-2024.json"),
    );
    expect(wrongYears.ok).toBe(false);

    // One year stated once still anchors, exactly as before.
    const oneYear = ri.parse(
      "Filing status 2026 Single $11,200 Married filing jointly $22,400 Head of household $16,800",
      readShard("state-ri-income-tax-2024.json"),
    );
    expect(oneYear.ok).toBe(true);
  });

  it("overlays the KY and ID flat rates (flat parser reused)", () => {
    const ky = adaptersForGroup("state-ky")[0]!;
    const kyShard = ky.parse(
      "Kentucky's income tax rate is 3.5%.",
      readShard("state-ky-income-tax-2024.json"),
    );
    expect(kyShard.ok).toBe(true);
    if (kyShard.ok) {
      const b = kyShard.shard.bracketsByFilingStatus as Record<string, { rate: number }[]>;
      expect(b.single![0]!.rate).toBe(0.035);
      expect(JurisdictionSchema.safeParse(kyShard.shard).success).toBe(true);
    }
    const id = adaptersForGroup("state-id")[0]!;
    const idShard = id.parse(
      "The Idaho income tax rate is 5.3%.",
      readShard("state-id-income-tax-2024.json"),
    );
    expect(idShard.ok).toBe(true);
    if (idShard.ok) {
      const b = idShard.shard.bracketsByFilingStatus as Record<
        string,
        { lowerBound: number; rate: number }[]
      >;
      // Idaho is not a one-element ladder: a 0% band sits under its single rate,
      // so the flat parser anchors the one taxed bracket and leaves the band's
      // threshold (which indexes separately) alone.
      expect(b.single!.map((x) => [x.lowerBound, x.rate])).toEqual([
        [0, 0],
        [4811, 0.053],
      ]);
      expect(b.married_jointly![1]!.lowerBound).toBe(9622);
      expect(JurisdictionSchema.safeParse(idShard.shard).success).toBe(true);
    }
  });

  it("reads Iowa's rate from the announcement, not the page that states a repealed one", () => {
    // The IDR's "Individual Income Tax Provisions" page still describes the 2022
    // reform's flat 3.9% for "2026 and later". SF 2442 (2024) superseded it with
    // 3.8%, which the shard carries. The old figure parses perfectly and 3.8 to
    // 3.9 is the size of a real rate cut, so no plausibility guard can tell them
    // apart — the adapter had to refuse that page outright. It watches the IDR's
    // own rate announcement instead, which states the rate that is actually law.
    const ia = adaptersForGroup("state-ia")[0]!;
    expect(ia.sourceUrl).toContain("idr-announces-2026-individual-income-tax");
    const result = ia.parse(
      "Individual Income Tax Rate Since the enactment of Iowa Senate File 2442 in May 2024," +
        " Iowa law provides for a flat tax rate of 3.8 percent.",
      readShard("state-ia-income-tax-2024.json"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const b = result.shard.bracketsByFilingStatus as Record<string, { rate: number }[]>;
    expect(b.single![0]!.rate).toBe(0.038);
    expect(JurisdictionSchema.safeParse(result.shard).success).toBe(true);
  });

  it("overlays the LA flat rate, preserving its standard deduction (flat parser reused)", () => {
    const la = adaptersForGroup("state-la")[0]!;
    const result = la.parse(
      "The Louisiana income tax rate is 3%.",
      readShard("state-la-income-tax-2024.json"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const b = result.shard.bracketsByFilingStatus as Record<string, { rate: number }[]>;
    expect(b.single![0]!.rate).toBe(0.03);
    // The indexed standard deduction (the reviewer's data-only roll) is untouched.
    const std = result.shard.standardDeductionByFilingStatus as Record<string, number>;
    expect(std.head_of_household).toBe(25750);
    expect(JurisdictionSchema.safeParse(result.shard).success).toBe(true);
  });

  it("overlays the UT flat rate, preserving its taxpayer tax credit (flat parser reused)", () => {
    const ut = adaptersForGroup("state-ut")[0]!;
    const result = ut.parse(
      "The Utah income tax rate is 4.45%.",
      readShard("state-ut-income-tax-2024.json"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const b = result.shard.bracketsByFilingStatus as Record<string, { rate: number }[]>;
    expect(b.single![0]!.rate).toBe(0.0445);
    // The credit (which the flat parser leaves untouched) survives the refresh.
    const credit = result.shard.taxpayerCredit as { creditRate: number } | undefined;
    expect(credit?.creditRate).toBe(0.06);
    expect(JurisdictionSchema.safeParse(result.shard).success).toBe(true);
  });

  describe("the dependent's standard deduction — one sentence, two figures", () => {
    const adapter = adaptersForGroup("irs").find((a) => a.id === "child-tax-2024")!;
    const current = readShard("child-tax-2024.json");
    // rp-25-32.pdf: the kiddie-tax paragraph first, then §4.14(2), as printed.
    const raw =
      '.02 Unearned Income of Minor Children Subject to the "Kiddie Tax". For taxable years' +
      " beginning in 2026, the amount in § 1(g)(4)(A)(ii)(I), which is used to reduce the net" +
      ' unearned income reported on the child\'s return that is subject to the "kiddie tax," is' +
      " $1,350. This $1,350 amount is the same as the amount provided in § 63(c)(5)(A), as" +
      " adjusted for inflation." +
      " (2) Dependent. For taxable years beginning in 2026, the standard deduction amount under" +
      " § 63(c)(5) for an individual who may be claimed as a dependent by another taxpayer cannot" +
      " exceed the greater of (1) $1,350, or (2) the sum of $450 and the individual's earned" +
      " income. (3) Aged or blind. For taxable years beginning in 2026, the additional standard" +
      " deduction amount under § 63(f) for the aged or the blind is $1,650.";

    it("reads both figures out of the sentence that states them", () => {
      const result = adapter.parse(raw, current);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.shard.dependentStandardDeductionBase).toBe(1_350);
      expect(result.shard.earnedIncomeAddOn).toBe(450);
    });

    it("anchors on the section, not on the number the kiddie-tax rule shares", () => {
      // The same $1,350 is printed nine thousand characters earlier under
      // § 1(g)(4)(A)(ii)(I). Two rules that agree today and are not the same
      // rule: anchoring on the value would be right by accident and would end
      // silently the first year Congress moved one and not the other. Change
      // only the § 63(c)(5) sentence and the adapter must follow it.
      const moved = raw.replace(
        "greater of (1) $1,350, or (2) the sum of $450",
        "greater of (1) $1,400, or (2) the sum of $500",
      );
      const result = adapter.parse(moved, current);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.shard.dependentStandardDeductionBase).toBe(1_400);
      expect(result.shard.earnedIncomeAddOn).toBe(500);
    });

    it("refuses rather than reaching for the kiddie-tax figure", () => {
      const withoutSection = raw.replace(/ \(2\) Dependent\.[\s\S]*$/, "");
      const result = adapter.parse(withoutSection, current);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/kiddie-tax section states about another rule/);
    });

    it("refuses a procedure for another year", () => {
      const result = adapter.parse(raw, { ...current, taxYear: 2027 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.settled).toBe(true);
    });

    it("refuses a figure that moved implausibly far", () => {
      const moved = raw.replace("greater of (1) $1,350", "greater of (1) $11,350");
      const result = adapter.parse(moved, current);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/dependentStandardDeductionBase 11350 is/);
    });
  });

  describe("AMT — three tables that share a filing-status label", () => {
    const adapter = adaptersForGroup("irs").find((a) => a.id === "amt-2024")!;
    const current = readShard("amt-2024.json");
    // irs.gov/pub/irs-drop/rp-25-32.pdf §4.10, verbatim through the PDF reader.
    const raw =
      ".10 Exemption Amounts for Alternative Minimum Tax. For taxable years beginning in 2026," +
      " the exemption amounts under § 55(d)(1) are: Filing status Exemption amount Joint Returns" +
      " or Surviving Spouses $140,200 Unmarried Individuals (other than Surviving Spouses)" +
      " $90,100 Married Individuals Filing Separate Returns $70,100 Estates and Trusts $31,400" +
      " For taxable years beginning in 2026, under § 55(b)(1), the excess taxable income above" +
      " which the 28 percent tax rate applies is: Filing status Excess taxable income Married" +
      " Individuals Filing Separate Returns $122,250 All Other Taxpayers $244,500 For taxable" +
      " years beginning in 2026, the amounts used under § 55(d)(2) to determine the phaseout of" +
      " the exemption amounts are: 17 Filing status Threshold Phaseout Amount Complete Phaseout" +
      " Amount Joint Returns or Surviving Spouses $1,000,000 $1,280,400 Unmarried Individuals" +
      " (other than Surviving Spouses) $500,000 $680,200 Married Individuals Filing Separate" +
      " Returns $500,000 $640,200 Estates and Trusts $104,800 $167,600 .11 Alternative Minimum" +
      ' Tax Exemption for a Child Subject to the "Kiddie Tax."';

    it("keeps the three tables apart, though two share a row label", () => {
      // "Married Individuals Filing Separate Returns $70,100" is the exemption
      // and "Married Individuals Filing Separate Returns $122,250" is the 28%
      // threshold, eighty words apart. A document-wide search writes one into
      // the other's field and looks entirely healthy doing it.
      const result = adapter.parse(raw, current);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const ex = result.shard.exemptionByFilingStatus as Record<string, number>;
      const r28 = result.shard.rate28ThresholdByFilingStatus as Record<string, number>;
      const po = result.shard.phaseoutThresholdByFilingStatus as Record<string, number>;
      expect(ex.married_separately).toBe(70_100);
      expect(r28.married_separately).toBe(122_250);
      expect(po.married_separately).toBe(500_000);
    });

    it("maps each printed row onto the statuses it covers", () => {
      const result = adapter.parse(raw, current);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const ex = result.shard.exemptionByFilingStatus as Record<string, number>;
      expect(ex.married_jointly).toBe(140_200);
      expect(ex.qualifying_surviving_spouse).toBe(140_200);
      expect(ex.single).toBe(90_100);
      expect(ex.head_of_household).toBe(90_100);
      // "Estates and Trusts" is a fourth row in every table and is not a filing
      // status this engine models. It must not become one.
      expect(Object.values(ex)).not.toContain(31_400);
      // Four printed rows, three modelled statuses' worth: the shard's schedule
      // keeps exactly the statuses it had.
      expect(Object.keys(ex).sort()).toEqual(
        Object.keys(current.exemptionByFilingStatus as Record<string, number>).sort(),
      );
    });

    it("takes the threshold, not the complete-phaseout amount beside it", () => {
      // The phase-out table prints two columns: "$1,000,000 $1,280,400". The
      // second is a different figure sitting directly next to the one wanted.
      const result = adapter.parse(raw, current);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const po = result.shard.phaseoutThresholdByFilingStatus as Record<string, number>;
      expect(po.married_jointly).toBe(1_000_000);
      expect(po.single).toBe(500_000);
      expect(Object.values(po)).not.toContain(1_280_400);
    });

    it("actually reads the document rather than agreeing by construction", () => {
      // The live dry run is a no-op, which is what it should be — and a no-op
      // is also what a parser that writes back what it was given produces. So
      // move the figures and check they land.
      const moved = raw
        .replace(
          "Joint Returns or Surviving Spouses $140,200",
          "Joint Returns or Surviving Spouses $141,000",
        )
        .replace("All Other Taxpayers $244,500", "All Other Taxpayers $245,000");
      const result = adapter.parse(moved, current);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const ex = result.shard.exemptionByFilingStatus as Record<string, number>;
      expect(ex.married_jointly).toBe(141_000);
      expect(ex.qualifying_surviving_spouse).toBe(141_000);
      expect((result.shard.rate28ThresholdByFilingStatus as Record<string, number>).single).toBe(
        245_000,
      );
      // And the rates, which are statutory under § 55 and not adjusted by the
      // procedure, come from the shard rather than being demanded of it.
      expect(result.shard.rateLow).toBe(0.26);
      expect(result.shard.phaseoutRate).toBe(0.25);
    });

    it("refuses a procedure for another year", () => {
      const result = adapter.parse(raw, { ...current, taxYear: 2027 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(/adjusts 2026 and the shard is 2027/);
        expect(result.settled).toBe(true);
      }
    });

    it("fails (-> alert) when a table is missing rather than writing the others", () => {
      const partial = raw.replace(/under § 55\(b\)\(1\)[\s\S]*$/, "");
      const result = adapter.parse(partial, current);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/28% bracket table/);
    });

    it("refuses a figure that moved implausibly far", () => {
      const moved = raw.replace(
        "Unmarried Individuals (other than Surviving Spouses) $90,100",
        "Unmarried Individuals (other than Surviving Spouses) $900,100",
      );
      const result = adapter.parse(moved, current);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/exemptionByFilingStatus\.single 900100 is/);
    });
  });

  describe("gift tax — the revenue procedure the shard has always cited", () => {
    const adapter = adaptersForGroup("irs").find((a) => a.id === "gift-tax-2024")!;
    const current = readShard("gift-tax-2024.json");
    // irs.gov/pub/irs-drop/rp-25-32.pdf, verbatim through the PDF reader.
    const raw =
      "SECTION 4. 2026 ADJUSTED ITEMS .14 Section 70106 of the OBBBA amends § 2010(c)(3) by" +
      " increasing the basic exclusion amount to $15,000,000 for calendar year 2026. The basic" +
      " exclusion amount is a component of the applicable exclusion amount described in §" +
      " 2010(c)(2)." +
      " .42 Annual Exclusion for Gifts and Annual Exception for Covered Gifts and Covered Bequests" +
      " Received from a Covered Expatriate. (1) For calendar year 2026, the first $19,000 of gifts" +
      " to any person (other than gifts of future interests in property) are not included in the" +
      " total amount of taxable gifts under § 2503 made during that year. (2) For calendar year" +
      " 2026, the first $194,000 (instead of the amount provided in paragraph (1) of this section" +
      " 4.42) of gifts to a spouse who is not a citizen of the United States (other than gifts of" +
      " future interests in property) are not included in the total amount of taxable gifts under" +
      " §§ 2503 and 2523(i)(2) made during that year.";

    it("reads all three figures out of the sections that state them", () => {
      // This shard cited this document from the day it was written and nothing
      // read it — one of five naming the very PDF the federal bracket adapter
      // fetches every month. "Watch what you cite" fixed twenty-one adapters
      // pointed at the wrong page; these were pointed at the right one with
      // nobody looking.
      const result = adapter.parse(raw, current);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.shard.annualExclusion).toBe(19_000);
      expect(result.shard.annualExclusionNonCitizenSpouse).toBe(194_000);
      expect(result.shard.lifetimeExemption).toBe(15_000_000);
      // Statutory (§ 2001(c)) and not adjusted by the procedure, so it is not
      // demanded — demanding it would be the Massachusetts mistake, a parser
      // reporting a moved source about a document that says what the shard has.
      expect(result.shard.topRate).toBe(0.4);
    });

    it("reaches past the period inside a section number", () => {
      // "the first $194,000 (instead of the amount provided in paragraph (1) of
      // this section 4.42) of gifts to a spouse who is not a citizen" — a
      // "[^.]*" reach ends at the dot in "4.42" and never arrives, which is
      // exactly what the first dry run of this adapter reported.
      const result = adapter.parse(raw, current);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.shard.annualExclusionNonCitizenSpouse).toBe(194_000);
    });

    it("refuses a procedure that adjusts another year", () => {
      // A revenue procedure at a year-stamped URL is a closed document: read
      // without this check it reports agreement forever and can never report a
      // change, which is how the federal adapter watched Rev. Proc. 2023-34 for
      // three years.
      const result = adapter.parse(raw, { ...current, taxYear: 2027 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(/adjusts 2026 and the shard is 2027/);
        expect(result.settled).toBe(true);
      }
    });

    it("fails (-> alert) when a figure is absent rather than writing the others", () => {
      const partial = raw.replace(/\(2\) For calendar year 2026[\s\S]*$/, "");
      const result = adapter.parse(partial, current);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/non-citizen-spouse exclusion/);
    });

    it("refuses a figure that moved implausibly far", () => {
      const moved = raw.replace("the first $19,000 of gifts", "the first $99,000 of gifts");
      const result = adapter.parse(moved, current);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/annualExclusion 99000 is/);
    });
  });

  describe("MS — the rate is a by-year table, beside two rates that are not it", () => {
    const adapter = adaptersForGroup("state-ms")[0]!;
    const current = readShard("state-ms-income-tax-2024.json");
    // dor.ms.gov/general-information, verbatim. Every *.ms.gov host serves an
    // incomplete certificate chain, so nothing here was readable at all until
    // the shared fetch learned to follow the leaf's AIA pointer.
    const raw =
      "Tax Rates Mississippi has a graduated tax rate. There is no tax schedule for" +
      " Mississippi income taxes. In 2026, the graduated 2025 tax year income tax rate is:" +
      " 0% on the first $10,000 of taxable income. 4.4% on the remaining taxable income in" +
      " excess of $10,000. Tax Rates for Tax years 2025-2027: The 4% rate is eliminated for" +
      " tax year 2024 and forward. Tax Year 2025 Excess of $10,000 of Taxable Income is taxed" +
      " @ 4.4% Tax Year 2026 Excess of $10,000 of Taxable Income is taxed @ 4% Tax Year 2027" +
      " Excess of $10,000 of Taxable Income is taxed @ 3.75% If filing a combined return" +
      " (both spouses work), each spouse can calculate their tax liability separately and add" +
      " the results. Example: In 2025, John is single and has taxable income of $23,000. His" +
      " 2025 tax liability will be: $10,000 X 0% = $0 $13,000 X 4.4% = $572";

    it("takes the shard's year from the table, not the rate the prose leads with", () => {
      // The section opens "In 2026, the graduated 2025 tax year income tax rate
      // is: ... 4.4% on the remaining taxable income in excess of $10,000" — the
      // shard's year in the first two words and the PREVIOUS year's rate, which
      // is DOR describing the return filed during 2026. Reading it rolls the
      // rate back up a year, and the resulting schedule looks entirely healthy.
      const result = adapter.parse(raw, current);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const brackets = result.shard.bracketsByFilingStatus as Record<
        string,
        { lowerBound: number; rate: number }[]
      >;
      expect(brackets.single).toEqual([
        { lowerBound: 0, rate: 0 },
        { lowerBound: 10000, rate: 0.04 },
      ]);
      expect(brackets.married_jointly![1]!.rate).toBe(0.04);
      expect(brackets.head_of_household![1]!.lowerBound).toBe(10000);
      expect(JurisdictionSchema.safeParse(result.shard).success).toBe(true);
    });

    it("reads a different row for a different shard year", () => {
      const back = adapter.parse(raw, { ...current, taxYear: 2025 });
      expect(back.ok).toBe(true);
      if (back.ok) {
        const b = back.shard.bracketsByFilingStatus as Record<string, { rate: number }[]>;
        expect(b.single![1]!.rate).toBeCloseTo(0.044, 6);
      }
      const forward = adapter.parse(raw, { ...current, taxYear: 2027 });
      expect(forward.ok).toBe(true);
      if (forward.ok) {
        const b = forward.shard.bracketsByFilingStatus as Record<string, { rate: number }[]>;
        expect(b.single![1]!.rate).toBeCloseTo(0.0375, 6);
      }
    });

    it("never reads the eliminated bracket's rate as this year's", () => {
      // "The 4% rate is eliminated for tax year 2024 and forward" names the
      // abolished bracket BELOW $10,000 — the same characters as the 2026 rate,
      // meaning its opposite. Only rows in the table's own shape are collected.
      const onlyProse =
        "In 2026, the graduated 2025 tax year income tax rate is: 0% on the first $10,000 of" +
        " taxable income. 4.4% on the remaining taxable income in excess of $10,000." +
        " The 4% rate is eliminated for tax year 2024 and forward.";
      const result = adapter.parse(onlyProse, current);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(/by-year rate row/);
        // The page is readable and states rates; it just states none of them as
        // this figure. That is a parser's problem to solve, not a state's.
        expect(result.settled).toBeUndefined();
      }
    });

    it("refuses a lone row, because one is a sentence and several are a table", () => {
      const one = "Tax Year 2026 Excess of $10,000 of Taxable Income is taxed @ 4%";
      expect(adapter.parse(one, current).ok).toBe(false);
    });

    it("says so when the table stops before the shard's year", () => {
      const result = adapter.parse(raw, { ...current, taxYear: 2028 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(/runs to tax year 2027 and this shard is 2028/);
        // Not a defect: the state has not published it.
        expect(result.settled).toBe(true);
      }
    });

    it("refuses a zero-band ceiling that moved implausibly far", () => {
      const moved = adapter.parse(
        raw.replace(
          "Tax Year 2026 Excess of $10,000 of Taxable Income is taxed @ 4%",
          "Tax Year 2026 Excess of $910,000 of Taxable Income is taxed @ 4%",
        ),
        current,
      );
      expect(moved.ok).toBe(false);
      if (!moved.ok) expect(moved.reason).toMatch(/zero-band ceiling/);
    });
  });

  describe("MA — 5% base rate + 4% surtax (dedicated parser)", () => {
    const adapter = adaptersForGroup("state-ma")[0]!;
    const current = readShard("state-ma-income-tax-2024.json");
    // mass.gov/info-details/massachusetts-4-surtax-on-taxable-income, verbatim.
    const raw =
      "Massachusetts personal income taxpayers pay an additional 4% surtax on taxable income" +
      " that exceeds the surtax threshold. This surtax threshold increases annually for" +
      " inflation. The surtax threshold for: Tax year 2026 is $1,107,750 Tax year 2025 is" +
      " $1,083,150 Tax year 2024 is $1,053,750 Tax year 2023 is $1,000,000." +
      " Can pass-through entities elect to pay a 9% PTE excise to take into account the 4%" +
      " surtax? No. The elective PTE excise is imposed at a statutory rate of 5%.";

    it("reads the surtax rate and the by-year threshold the page actually states", () => {
      // The old parser demanded the 5% base rate off this page, which is about
      // the surtax and states no base rate — the only "5%" on it is the
      // pass-through excise, in an answer explaining that the excise is NOT the
      // surtax. And it wanted "4% surtax ... in excess of $X" on one line, where
      // the threshold is a by-year list. So it reported a moved source about a
      // page that says exactly what the shard carries.
      const result = adapter.parse(raw, current);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const brackets = result.shard.bracketsByFilingStatus as Record<
        string,
        { lowerBound: number; rate: number }[]
      >;
      // Base bracket keeps the statutory 5% (M.G.L. c. 62 §4, not on this page);
      // the surtax bracket carries the combined 9% at the year's threshold.
      expect(brackets.single).toEqual([
        { lowerBound: 0, rate: 0.05 },
        { lowerBound: 1107750, rate: 0.09 },
      ]);
      expect(brackets.married_jointly![1]!.lowerBound).toBe(1107750);
      expect(brackets.head_of_household![1]!.rate).toBeCloseTo(0.09, 6);
      expect(JurisdictionSchema.safeParse(result.shard).success).toBe(true);
    });

    it("takes the shard's own year from the list, not the first row", () => {
      // Every year DOR has ever published is on that page, newest first. Reading
      // "the first one" is right this year and wrong the moment the list grows a
      // row, which is the Rhode Island lesson on a different page.
      const result = adapter.parse(raw, { ...current, taxYear: 2024 });
      expect(result.ok).toBe(true);
      if (result.ok) {
        const b = result.shard.bracketsByFilingStatus as Record<string, { lowerBound: number }[]>;
        expect(b.single![1]!.lowerBound).toBe(1053750);
      }
    });

    it("says so when the list stops before the shard's year", () => {
      const result = adapter.parse(raw, { ...current, taxYear: 2027 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(/stops at tax year 2026 and this shard is 2027/);
        // Not a defect: the state has not published it.
        expect(result.settled).toBe(true);
      }
    });

    it("fails (-> alert) when the page states no threshold list at all", () => {
      expect(adapter.parse("A 4% surtax also applies to high earners.", current).ok).toBe(false);
    });

    it("refuses a threshold that moved implausibly far", () => {
      const moved = adapter.parse(
        raw.replace("Tax year 2026 is $1,107,750", "Tax year 2026 is $9,107,750"),
        current,
      );
      expect(moved.ok).toBe(false);
      if (!moved.ok) expect(moved.reason).toMatch(/surtax threshold 9107750 is/);
    });
  });

  describe("NJ — per-filing-status schedules; top millionaire's rate (dedicated parser)", () => {
    const adapter = adaptersForGroup("state-nj")[0]!;
    const current = readShard("state-nj-income-tax-2024.json");

    it("reads the schedule's own layout: threshold first, rate as a decimal", () => {
      // The Division states its brackets only in the rate-schedule PDF, and the
      // page the adapter used to watch is a menu of PDFs by year. The schedule
      // writes the top tier backwards from the prose form and in decimals:
      // "$1,000,000 and over __________ .1075 = __________ – $ 32,926.25".
      const raw =
        "New Jersey Tax Rate Schedules 2020 FILING STATUS: Single Table A" +
        " $ 500,000 $ 1,000,000 __________  .0897 = __________ – $ 15,126.25 = _________" +
        " $1,000,000 and over __________  .1075 = __________ – $ 32,926.25 = _________" +
        " FILING STATUS: Married/CU couple, filing joint return Table B" +
        " $1,000,000 and over __________  .1075 = __________ – $ 34,842.50 = _________";
      const result = adapter.parse(raw, current);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const b = result.shard.bracketsByFilingStatus as Record<
        string,
        { lowerBound: number; rate: number }[]
      >;
      expect(b.single!.at(-1)).toEqual({ lowerBound: 1000000, rate: 0.1075 });
      expect(b.married_jointly!.at(-1)!.rate).toBeCloseTo(0.1075, 6);
      // The $500,000 / .0897 tier above it is never mistaken for the top one.
      expect(b.single!.at(-2)!.lowerBound).toBe(500000);
    });

    it("refuses when the two tables state different top tiers", () => {
      const disagreeing =
        "Table A $1,000,000 and over __________  .1075 = _________" +
        " Table B $2,000,000 and over __________  .1075 = _________";
      const result = adapter.parse(disagreeing, current);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/different top tiers/);
    });

    it("anchors the top rate + $1M threshold onto every status's top bracket, ignoring $500k", () => {
      const raw =
        "New Jersey rate: 8.97% on income over $500,000; 10.75% on taxable income in excess of $1,000,000.";
      const result = adapter.parse(raw, current);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const brackets = result.shard.bracketsByFilingStatus as Record<
        string,
        { lowerBound: number; rate: number }[]
      >;
      // The millions-only threshold pattern anchors the 10.75% / $1M tier, never
      // the 8.97% / $500,000 tier below it. Applied to both 7- and 8-bracket schedules.
      const sTop = brackets.single![brackets.single!.length - 1]!;
      const jTop = brackets.married_jointly![brackets.married_jointly!.length - 1]!;
      expect(sTop).toEqual({ lowerBound: 1000000, rate: 0.1075 });
      expect(jTop).toEqual({ lowerBound: 1000000, rate: 0.1075 });
      expect(brackets.single!).toHaveLength(7);
      expect(brackets.married_jointly!).toHaveLength(8);
      expect(JurisdictionSchema.safeParse(result.shard).success).toBe(true);
    });

    it("catches a raised millionaire's rate", () => {
      const raw = "The top rate is 11.75% on income over $1,000,000.";
      const result = adapter.parse(raw, current);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const brackets = result.shard.bracketsByFilingStatus as Record<
        string,
        { lowerBound: number; rate: number }[]
      >;
      expect(brackets.single![brackets.single!.length - 1]!.rate).toBeCloseTo(0.1175, 6);
    });

    it("fails (-> alert) when no millions-level threshold is present", () => {
      expect(adapter.parse("Rates run from 1.4% up to 6.37% over $75,000.", current).ok).toBe(
        false,
      );
    });

    it("fails (-> alert) on an implausible top rate", () => {
      expect(adapter.parse("A 95% rate applies over $1,000,000.", current).ok).toBe(false);
    });
  });
});

describe("adapters: USDA SNAP (one table, a column per region)", () => {
  const adapter = adaptersForGroup("usda-snap")[0]!;
  const current = readShard("snap-fy2024-contiguous.json");
  // FNS Table 1 as the page states it: seven region columns, and the figure
  // this shard wants is the first of them.
  const raw =
    "SNAP FY 2026 Cost-of-Living Adjustments ... Table 1. Maximum Monthly Allotment" +
    " Household Size 48 States and District of Columbia Alaska (Urban) Alaska (Rural 1)" +
    " Alaska (Rural 2) Guam Hawaii Virgin Islands" +
    " 1 $298 $385 $491 $598 $439 $506 $383" +
    " 2 $546 $707 $901 $1,097 $806 $929 $703" +
    " 3 $785 $1,015 $1,295 $1,576 $1,157 $1,334 $1,009" +
    " 4 $994 $1,285 $1,639 $1,995 $1,465 $1,689 $1,278" +
    " 5 $1,183 $1,529 $1,950 $2,374 $1,743 $2,010 $1,521" +
    " 6 $1,421 $1,838 $2,344 $2,853 $2,095 $2,415 $1,827" +
    " 7 $1,571 $2,031 $2,590 $3,152 $2,315 $2,668 $2,019" +
    " 8 $1,789 $2,314 $2,950 $3,591 $2,637 $3,040 $2,300" +
    " Each Additional Member $218 $282 $360 $438 $322 $371 $281" +
    " Deductions Table 2. Standard Deductions Household Size 48 States and District of" +
    " Columbia Alaska Guam Hawaii Virgin Islands 1 $209 $358 $420 $295 $184";

  it("reads the shard's own region column, not the first amount in the row", () => {
    const result = adapter.parse(raw, current);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const a = result.shard.maxAllotmentByHouseholdSize as Record<string, number>;
    expect(a["1"]).toBe(298);
    expect(a["4"]).toBe(994);
    expect(a["8"]).toBe(1789);
    expect(result.shard.additionalPersonAllotment).toBe(218);
    expect(SnapSchema.safeParse(result.shard).success).toBe(true);
  });

  it("refuses a row that is not the header's width rather than counting into it", () => {
    // A dropped or added column shifts every row one region to the side, and
    // Alaska (Rural 2) is twice the contiguous figure — plausible money, wrong
    // households. The only thing that catches it is the count.
    const narrowed = raw.replace(
      " 4 $994 $1,285 $1,639 $1,995 $1,465 $1,689 $1,278",
      " 4 $994 $1,285 $1,639 $1,995 $1,465 $1,689",
    );
    const result = adapter.parse(narrowed, current);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("the table's shape changed");
  });

  it("refuses a page that does not state the shard's fiscal year", () => {
    const rolled = { ...current, fiscalYear: 2028 };
    const result = adapter.parse(raw, rolled);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("no FY 2028 figures");
  });

  it("watches the COLA index, not the per-year page that renders its tables in JS", () => {
    expect(adapter.sourceUrl).toBe("https://www.fna.usda.gov/snap/allotment/cola");
  });

  it("fails (-> alert) when Table 1 is absent", () => {
    expect(adapter.parse("SNAP FY 2026 Cost-of-Living Adjustments", current).ok).toBe(false);
  });
});

describe("adapters: TreasuryDirect I-bond rates (one figure stated, one checked)", () => {
  const adapter = adaptersForGroup("treasurydirect")[0]!;
  const current = readShard("treasury-bonds-2024.json");
  // The page's current-rate block, as TreasuryDirect writes it.
  const page = (composite: string, fixed: string, month = "May", year = "2026") =>
    `Current Interest Rate Series I Savings Bonds ${composite}% This includes a fixed rate of ` +
    `${fixed}% For I bonds issued ${month} 1, ${year} to October 31, ${year}.`;

  it("writes the fixed rate the page states, into the period the page names", () => {
    const result = adapter.parse(page("4.26", "0.90"), current);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rates = result.shard.rates as {
      period: string;
      fixedRate: number;
      inflationRate: number;
    }[];
    const entry = rates.find((r) => r.period === "2026-05")!;
    expect(entry.fixedRate).toBe(0.009);
    // The inflation rate is not on the page, so it is never written — only
    // checked against the published composite.
    expect(entry.inflationRate).toBe(0.0167);
    expect(rates[0]!.inflationRate).toBe(0.0356);
    expect(TreasuryBondsSchema.safeParse(result.shard).success).toBe(true);
  });

  it("names both figures when the committed rate does not reproduce the composite", () => {
    // composite = fixed + 2 × semiannual + fixed × semiannual. The shard's
    // 1.67% with a 0.90% fixed rate implies 4.26%, so 4.90% means one of them
    // moved — and the arithmetic cannot say which.
    const result = adapter.parse(page("4.90", "0.90"), current);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("implies a composite of 4.26%");
    expect(result.reason).toContain("page publishes 4.90%");
  });

  it("refuses a new six-month period rather than overwriting the last one", () => {
    // The parser this replaces wrote into rates[length - 1] whatever period the
    // page described, so the morning Treasury announces a new period it would
    // have rewritten the previous one — in a series that exists to be a history.
    const result = adapter.parse(page("4.26", "0.90", "November", "2026"), current);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("2026-11");
    expect(result.reason).toContain("reviewer's step");
  });

  it("fails (-> alert) when the current-rate block is missing", () => {
    expect(adapter.parse("I bond rates are announced each May and November.", current).ok).toBe(
      false,
    );
  });

  it("fails (-> alert) on an implausible fixed rate", () => {
    expect(adapter.parse(page("4.26", "47.0"), current).ok).toBe(false);
  });
});

describe("adapters: CMS Medicaid expansion (anchored prose)", () => {
  const adapter = adaptersForGroup("cms-medicaid")[0]!;
  const current = readShard("medicaid-2024.json");

  it("anchors the effective expansion threshold and validates", () => {
    const raw =
      "In expansion states, adults qualify with income at or below 138 percent of the federal poverty level.";
    const result = adapter.parse(raw, current);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shard.expansionThresholdPctFpl).toBe(138);
    // The per-state expansion map is preserved (a reviewer flips a state).
    expect((result.shard.expansionByState as Record<string, boolean>).CA).toBe(true);
    expect(MedicaidSchema.safeParse(result.shard).success).toBe(true);
  });

  it("fails (-> alert) when the threshold cannot be anchored", () => {
    expect(adapter.parse("eligibility rules vary by state and category", current).ok).toBe(false);
  });

  it("files 133-against-138 as settled and any other disagreement as not", () => {
    // CMS writes the STATUTORY 133%; eligibility turns on that plus the 5-point
    // disregard, an effective 138%, which is what the shard carries and what
    // every tile computes against. Two correct statements of one rule, so no
    // pattern-tightening lets a scrape choose — and nobody needs to act on it.
    const statutory = adapter.parse(
      "adults with income at or below 133 percent of the federal poverty line",
      current,
    );
    expect(statutory.ok).toBe(false);
    if (!statutory.ok) expect(statutory.settled).toBe(true);

    // Any other number is a surprise that wants a person now, and must not be
    // filed under "nothing to do here".
    const surprise = adapter.parse(
      "adults with income at or below 100 percent of the federal poverty line",
      current,
    );
    expect(surprise.ok).toBe(false);
    if (!surprise.ok) expect(surprise.settled).toBe(false);
  });
});

describe("runner: planRefresh (no I/O)", () => {
  const adapter = adaptersForGroup("hhs-poverty")[0]!;
  const current = readShard("federal-poverty-level-2024-contiguous.json");

  it("settles rather than alerting when the adapter refused on purpose", () => {
    // Delaware's deduction has not moved since 2000, so its adapter refuses with
    // `settled`. The shard is left alone exactly as for an alert; the difference
    // is that nothing is opened and nothing is written to the diff log.
    const de = adaptersForGroup("state-de")[0]!;
    const plan = planRefresh(
      de,
      readShard("state-de-income-tax-2024.json"),
      { ok: true, raw: "The Delaware Code, Title 30, Chapter 11." },
      TODAY,
    );
    expect(plan.outcome).toBe("settled");
    expect(plan.shard).toBeNull();
    expect(plan.reason).toMatch(/does not index/);
  });

  it("alerts and writes no shard when the fetch fails", () => {
    const plan = planRefresh(adapter, current, { ok: false, reason: "HTTP 404" }, TODAY);
    expect(plan.outcome).toBe("alert-pr");
    expect(plan.shard).toBeNull();
    expect(plan.logEntry).toContain("Alert");
  });

  it("no-ops when the source repeats the committed values", () => {
    const raw =
      "2026 POVERTY GUIDELINES FOR THE 48 CONTIGUOUS STATES AND THE DISTRICT OF COLUMBIA 1 $15,960 For families/households with more than 8 persons, add $5,680 for each additional person.";
    const plan = planRefresh(adapter, current, { ok: true, raw }, TODAY);
    expect(plan.outcome).toBe("no-op");
    expect(plan.shard).toBeNull();
  });

  it("opens a PR with a date-stamped shard when values change", () => {
    const raw =
      "2026 POVERTY GUIDELINES FOR THE 48 CONTIGUOUS STATES AND THE DISTRICT OF COLUMBIA 1 $15,600 For families/households with more than 8 persons, add $5,500 for each additional person.";
    const plan = planRefresh(adapter, current, { ok: true, raw }, TODAY);
    expect(plan.outcome).toBe("open-pr");
    expect(plan.shard).not.toBeNull();
    expect((plan.shard!.citation as Record<string, unknown>).dateRetrieved).toBe(TODAY);
    expect(plan.logEntry).toContain("base: 15960 -> 15600");
  });
});

describe("runner: file helpers", () => {
  it("serializes a shard like the committed files (2-space + trailing newline)", () => {
    expect(serializeShard({ a: 1 })).toBe('{\n  "a": 1\n}\n');
  });

  it("prepends a diff-log entry after the entries marker, newest first", () => {
    const log = "# Source diff log\n\nintro\n\n<!-- entries -->\n\n## old entry\n";
    const updated = insertLogEntry(log, "## new entry\n");
    expect(updated.indexOf("## new entry")).toBeLessThan(updated.indexOf("## old entry"));
    expect(updated).toContain("<!-- entries -->");
  });
});
