import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { diffShards, decideOutcome, renderDiffLogEntry } from "../../scripts/refresh/contract";
import { ADAPTERS, adaptersForGroup, REFRESH_GROUPS } from "../../scripts/refresh/adapters";
import { planRefresh, serializeShard, insertLogEntry } from "../../scripts/refresh/run";
import {
  CpiSchema,
  FederalPovertyLevelSchema,
  FicaSchema,
  JurisdictionSchema,
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
  it("covers the first set across distinct groups", () => {
    expect(REFRESH_GROUPS.sort()).toEqual(["cpi", "hhs-poverty", "irs", "ssa", "state-ca"]);
    expect(ADAPTERS).toHaveLength(5);
    for (const a of ADAPTERS) expect(a.sourceUrl).toMatch(/^https:\/\//);
  });
  it("maps a group to its adapters", () => {
    expect(adaptersForGroup("cpi").map((a) => a.id)).toEqual(["cpi-u-annual"]);
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
    expect(sd.married_separately).toBe(14600);
    expect(JurisdictionSchema.safeParse(result.shard).success).toBe(true);
  });

  it("fails (-> alert) when no deduction can be anchored", () => {
    expect(adapter.parse("no dollar figures in this layout", current).ok).toBe(false);
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
    const raw = `1 $15,060\nadd $5,380 for each additional person`;
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
    expect(plan.logEntry).toContain("base: 15060 -> 15600");
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
