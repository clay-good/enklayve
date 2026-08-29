import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { diffShards, decideOutcome, renderDiffLogEntry } from "../../scripts/refresh/contract";
import {
  ADAPTERS,
  adaptersForGroup,
  REFRESH_GROUPS,
  anchorFlatRate,
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
    expect(ADAPTERS).toHaveLength(49);
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

describe("adapters: HHS poverty (anchored prose)", () => {
  const adapter = adaptersForGroup("hhs-poverty")[0]!;
  const current = readShard("federal-poverty-level-2024-contiguous.json");

  it("anchors the one-person guideline and the per-person increment", () => {
    const raw =
      "Persons in family\n1 $15,600\n2 $21,000\nFor more than 8, add $5,500 for each additional person.";
    const result = adapter.parse(raw, current);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shard.base).toBe(15600);
    expect(result.shard.perAdditionalPerson).toBe(5500);
    expect(FederalPovertyLevelSchema.safeParse(result.shard).success).toBe(true);
  });

  it("fails (-> alert) when the anchors are missing", () => {
    expect(adapter.parse("the guidelines were not published in this format", current).ok).toBe(
      false,
    );
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

describe("adapters: jurisdiction standard deductions (IRS + CA)", () => {
  const adapter = adaptersForGroup("irs")[0]!;
  const current = readShard("federal-income-tax-2024.json");
  const raw =
    "For tax year 2025 the standard deduction for married couples filing jointly rises to $30,000. For single taxpayers the standard deduction is $15,000. For heads of household it rises to $22,500.";

  it("overlays the deductions it can anchor and validates as a jurisdiction", () => {
    const result = adapter.parse(raw, current);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sd = result.shard.standardDeductionByFilingStatus as Record<string, number>;
    expect(sd.married_jointly).toBe(30000);
    expect(sd.single).toBe(15000);
    expect(sd.head_of_household).toBe(22500);
    // Unstated statuses are preserved from the committed shard for review.
    expect(sd.married_separately).toBe(16100);
    expect(JurisdictionSchema.safeParse(result.shard).success).toBe(true);
  });

  it("fails (-> alert) when no deduction can be anchored", () => {
    expect(adapter.parse("no dollar figures in this layout", current).ok).toBe(false);
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
    const raw =
      "For 2026, Ohio taxable nonbusiness income up to $26,150 is taxed at 0%. " +
      "Income is taxed at 2.75% of the amount in excess of $26,150.";
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

  it("refuses to read a rate out of a by-year history table", () => {
    // Colorado's Individual Income Tax Guide prints a rate per year, and every
    // pattern reaches the first row — so the guide would have proposed rolling
    // Colorado back to 2019. Each of these is a real Colorado rate differing by
    // tenths, so no plausibility band separates them; only the shape does.
    expect(
      anchorFlatRate(
        "Colorado Income Tax Rates Tax Year Tax Rate 2019 4.5% 2020 4.55% 2021 4.5%" +
          " 2022 4.4% 2023 4.4% 2024 4.25% 2025 4.4%",
      ),
    ).toBe("historical");
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

  it("refuses a deduction page that prints two years side by side", () => {
    // Rhode Island's inflation advisory prints "Filing status 2025 2026 / Single
    // $10,900 $11,200". Taking the first match rolls the shard BACKWARDS a year,
    // which the dry run caught the day PDF support made that page parseable at
    // all. One year stated once is fine; two is a refusal.
    const ri = adaptersForGroup("state-ri")[0]!;
    const twoYears = ri.parse(
      "Filing status 2025 2026 Single $10,900 $11,200 Married filing jointly $21,800 $22,400",
      readShard("state-ri-income-tax-2024.json"),
    );
    expect(twoYears.ok).toBe(false);
    if (!twoYears.ok) expect(twoYears.reason).toMatch(/two-column table, probably two tax years/);

    // The same page with only the current year still anchors.
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

  it("overlays the MS two-tier '0% then a flat rate over a floor' (graduated parser reused)", () => {
    const adapter = adaptersForGroup("state-ms")[0]!;
    const current = readShard("state-ms-income-tax-2024.json");
    const raw =
      "For 2026, Mississippi taxes the first $10,000 of taxable income at 0%, " +
      "and 4% on taxable income in excess of $10,000.";
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
    expect(JurisdictionSchema.safeParse(result.shard).success).toBe(true);
  });

  describe("MA — 5% base rate + 4% surtax (dedicated parser)", () => {
    const adapter = adaptersForGroup("state-ma")[0]!;
    const current = readShard("state-ma-income-tax-2024.json");

    it("anchors the base rate, surtax rate, and inflation-adjusted threshold", () => {
      const raw =
        "The Massachusetts income tax rate is 5.0%. A 4% surtax applies to taxable " +
        "income in excess of $1,107,750 for tax year 2026.";
      const result = adapter.parse(raw, current);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const brackets = result.shard.bracketsByFilingStatus as Record<
        string,
        { lowerBound: number; rate: number }[]
      >;
      // Base bracket carries the 5% rate; the surtax bracket carries the combined
      // 9% at the inflation-adjusted threshold, applied to every filing status.
      expect(brackets.single).toEqual([
        { lowerBound: 0, rate: 0.05 },
        { lowerBound: 1107750, rate: 0.09 },
      ]);
      expect(brackets.married_jointly![1]!.lowerBound).toBe(1107750);
      expect(brackets.head_of_household![1]!.rate).toBeCloseTo(0.09, 6);
      expect(JurisdictionSchema.safeParse(result.shard).success).toBe(true);
    });

    it("catches a moved (inflation-adjusted) surtax threshold", () => {
      const raw = "The income tax rate is 5.0%. The 4% surtax applies to income over $1,150,000.";
      const result = adapter.parse(raw, current);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const brackets = result.shard.bracketsByFilingStatus as Record<
        string,
        { lowerBound: number }[]
      >;
      expect(brackets.single![1]!.lowerBound).toBe(1150000);
    });

    it("fails (-> alert) when the surtax threshold cannot be anchored", () => {
      expect(adapter.parse("The income tax rate is 5.0%. A surtax also applies.", current).ok).toBe(
        false,
      );
    });

    it("fails (-> alert) on an implausible base rate", () => {
      const raw = "The income tax rate is 55%. A 4% surtax applies to income over $1,107,750.";
      expect(adapter.parse(raw, current).ok).toBe(false);
    });
  });

  describe("NJ — per-filing-status schedules; top millionaire's rate (dedicated parser)", () => {
    const adapter = adaptersForGroup("state-nj")[0]!;
    const current = readShard("state-nj-income-tax-2024.json");

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

describe("adapters: USDA SNAP (anchored prose)", () => {
  const adapter = adaptersForGroup("usda-snap")[0]!;
  const current = readShard("snap-fy2024-contiguous.json");

  it("anchors the one-person allotment and each-additional-person amount", () => {
    const raw =
      "Maximum allotments, FY2025:\n1 $292\n2 $536\n8 $1,756\nEach additional person, add $220.";
    const result = adapter.parse(raw, current);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.shard.maxAllotmentByHouseholdSize as Record<string, number>)["1"]).toBe(292);
    expect(result.shard.additionalPersonAllotment).toBe(220);
    // The unstated sizes are preserved from the committed shard for review.
    expect((result.shard.maxAllotmentByHouseholdSize as Record<string, number>)["4"]).toBe(994);
    expect(SnapSchema.safeParse(result.shard).success).toBe(true);
  });

  it("accepts the reversed each-additional-person phrasing", () => {
    const raw = "1 $292\n$220 for each additional person beyond eight.";
    const result = adapter.parse(raw, current);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shard.additionalPersonAllotment).toBe(220);
  });

  it("fails (-> alert) when the anchors are missing", () => {
    expect(adapter.parse("the COLA memo did not state allotments this way", current).ok).toBe(
      false,
    );
  });
});

describe("adapters: TreasuryDirect I-bond rates (anchored prose)", () => {
  const adapter = adaptersForGroup("treasurydirect")[0]!;
  const current = readShard("treasury-bonds-2024.json");

  it("anchors the fixed and semiannual inflation rates onto the latest period", () => {
    const raw =
      "The composite rate for I bonds issued from November 2024 through April 2025 is 3.11%. " +
      "This rate applies for the first six months you own the bond. The fixed rate will be 1.20%. " +
      "The semiannual inflation rate is 0.95%.";
    const result = adapter.parse(raw, current);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rates = result.shard.rates as { fixedRate: number; inflationRate: number }[];
    const latest = rates[rates.length - 1]!;
    expect(latest.fixedRate).toBeCloseTo(0.012, 6);
    expect(latest.inflationRate).toBeCloseTo(0.0095, 6);
    // Earlier periods are preserved (appending a new period is the reviewer's step).
    expect(rates[0]!.inflationRate).toBe(0.0356);
    expect(TreasuryBondsSchema.safeParse(result.shard).success).toBe(true);
  });

  it("fails (-> alert) when the rate anchors are missing", () => {
    expect(adapter.parse("I bond rates are announced each May and November.", current).ok).toBe(
      false,
    );
  });

  it("fails (-> alert) on an implausible rate read", () => {
    const raw = "The fixed rate will be 1.30%. The semiannual inflation rate is 47.0%.";
    expect(adapter.parse(raw, current).ok).toBe(false);
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
});

describe("runner: planRefresh (no I/O)", () => {
  const adapter = adaptersForGroup("hhs-poverty")[0]!;
  const current = readShard("federal-poverty-level-2024-contiguous.json");

  it("alerts and writes no shard when the fetch fails", () => {
    const plan = planRefresh(adapter, current, { ok: false, reason: "HTTP 404" }, TODAY);
    expect(plan.outcome).toBe("alert-pr");
    expect(plan.shard).toBeNull();
    expect(plan.logEntry).toContain("Alert");
  });

  it("no-ops when the source repeats the committed values", () => {
    const raw = `1 $15,960\nadd $5,680 for each additional person`;
    const plan = planRefresh(adapter, current, { ok: true, raw }, TODAY);
    expect(plan.outcome).toBe("no-op");
    expect(plan.shard).toBeNull();
  });

  it("opens a PR with a date-stamped shard when values change", () => {
    const raw = `1 $15,600\nadd $5,500 for each additional person`;
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
