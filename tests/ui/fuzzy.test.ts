import { describe, it, expect } from "vitest";
import { fuzzyScore, fuzzyFilter } from "../../src/ui/fuzzy";

describe("fuzzy matcher", () => {
  it("returns null when the query is not a subsequence", () => {
    expect(fuzzyScore("xyz", "Take-Home Pay")).toBeNull();
  });

  it("matches an acronym across word boundaries", () => {
    expect(fuzzyScore("thp", "Take-Home Pay")).not.toBeNull();
  });

  it("scores an exact match highest and a prefix next", () => {
    const exact = fuzzyScore("runway", "Runway") ?? -Infinity;
    const prefix = fuzzyScore("run", "Runway") ?? -Infinity;
    const fuzzy = fuzzyScore("rwy", "Runway") ?? -Infinity;
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(fuzzy);
  });

  it("treats an empty query as matching everything", () => {
    const items = ["Alpha", "Beta", "Gamma"];
    const out = fuzzyFilter("", items, (s) => s);
    expect(out.map((r) => r.item)).toEqual(items);
  });

  it("ranks the closer match first", () => {
    const items = ["Capital Gains", "Compound Growth", "Child Tax Credit"];
    const out = fuzzyFilter("compound", items, (s) => s);
    expect(out[0]?.item).toBe("Compound Growth");
  });
});
