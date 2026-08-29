import { describe, it, expect, beforeAll } from "vitest";
import { freeFilingOptions } from "../../src/engine/freeFiling";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import type { FreeFilingData } from "../../src/data/schemas";

/**
 * Free filing (SPEC-4 §A5). The load-bearing property is that **someone always
 * qualifies for something**: Free File Fillable Forms has no income limit, so
 * "you have to pay to file" is never the honest answer. The tests pin that at
 * both extremes of income and pin the two non-income routes (disability and
 * limited English proficiency) that a reader of the raw rules would most easily
 * miss.
 */
let data: BundledData;
let rules: FreeFilingData;
beforeAll(async () => {
  data = await loadBundledData();
  rules = data.freeFiling()!;
});

const at = (adjustedGrossIncome: number, rest = {}) =>
  freeFilingOptions({ adjustedGrossIncome, ...rest }, rules);

const ids = (list: { channel: { id: string } }[]): string[] => list.map((e) => e.channel.id);

describe("the shard", () => {
  it("is bundled, cited to the IRS, and names the season it governs", () => {
    expect(rules.citation.sourceUrl).toContain("irs.gov");
    expect(rules.filingSeason).toBe(2026);
    expect(rules.taxYear).toBe(2025);
  });

  it("records Direct File as checked-and-unavailable, not silently dropped", () => {
    const df = rules.omitted.find((o) => o.id === "direct-file");
    expect(df).toBeDefined();
    expect(df!.reason).toContain("not available");
  });
});

describe("freeFilingOptions", () => {
  it("opens guided software and VITA to a low-income household", () => {
    const r = at(38_000);
    expect(ids(r.eligible)).toContain("free-file-guided");
    expect(ids(r.eligible)).toContain("vita");
  });

  it("closes VITA above its guideline but keeps guided software", () => {
    const r = at(75_000);
    expect(ids(r.eligible)).toContain("free-file-guided");
    expect(ids(r.ineligible)).toContain("vita");
    expect(r.ineligible.find((e) => e.channel.id === "vita")!.reason).toContain(
      "above the $69,000",
    );
  });

  it("always leaves at least one free federal option, however high the income", () => {
    for (const income of [0, 89_000, 89_001, 500_000, 5_000_000]) {
      const r = at(income);
      expect(r.anyFree, `at ${income}`).toBe(true);
      expect(ids(r.eligible), `at ${income}`).toContain("free-file-fillable");
    }
  });

  it("says by how much an income misses a ceiling, not just that it does", () => {
    const guided = at(94_000).ineligible.find((e) => e.channel.id === "free-file-guided")!;
    expect(guided.reason).toContain("$89,000");
    expect(guided.reason).toContain("$5,000");
  });

  it("carries a household past the VITA ceiling on disability", () => {
    const r = at(120_000, { disability: true });
    const vita = r.eligible.find((e) => e.channel.id === "vita");
    expect(vita).toBeDefined();
    expect(vita!.viaCondition).toBe(true);
    expect(vita!.reason).toContain("disabilities");
  });

  it("carries a household past the VITA ceiling on limited English proficiency", () => {
    const vita = at(120_000, { limitedEnglish: true }).eligible.find(
      (e) => e.channel.id === "vita",
    );
    expect(vita?.viaCondition).toBe(true);
    expect(vita?.reason).toContain("limited English");
  });

  it("opens TCE at 60 with no income limit, and explains the gate below it", () => {
    expect(ids(at(400_000, { age: 61 }).eligible)).toContain("tce");
    const under = at(400_000, { age: 45 }).ineligible.find((e) => e.channel.id === "tce")!;
    expect(under.reason).toContain("60 and older");
    expect(under.reason).toContain("no income limit");
  });

  it("gates MilTax on military status rather than income", () => {
    expect(ids(at(300_000, { military: true }).eligible)).toContain("miltax");
    expect(ids(at(10_000).eligible)).not.toContain("miltax");
  });

  it("gives every channel a reason, eligible or not — never a bare no", () => {
    const r = at(75_000, { age: 30 });
    for (const e of [...r.eligible, ...r.ineligible]) {
      expect(e.reason.length, e.channel.id).toBeGreaterThan(10);
    }
    expect(r.eligible.length + r.ineligible.length).toBe(rules.channels.length);
  });

  it("degrades hostile input instead of throwing", () => {
    for (const income of [Number.NaN, -5000, Number.POSITIVE_INFINITY]) {
      expect(() => at(income, { age: Number.NaN })).not.toThrow();
      expect(at(income, { age: Number.NaN }).anyFree).toBe(true);
    }
  });
});
