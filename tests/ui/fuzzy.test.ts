import { describe, it, expect } from "vitest";
import { fuzzyScore, fuzzyFilter } from "../../src/ui/fuzzy";
import { SEARCH_ENTRIES, searchEntryText } from "../../src/tiles/registry";

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

  it("scores a word inside the text like a word, not like a scatter of letters", () => {
    // The scorer knew only about the start of the whole string. "pay" was worth
    // 727 against "Paycheck Optimizer paycheck optimizer 401k hsa pre-tax take
    // home tax savings" — a prefix — and 24.6 against "Take-Home Pay paycheck
    // net pay salary withholding fica state tax", where it is a whole word,
    // matched as a subsequence like any other. See the catalog test below for
    // what that cost.
    const takeHome = "take-home pay paycheck net pay";
    const paycheck = "paycheck optimizer take home";
    expect(fuzzyScore("pay", takeHome)!).toBeGreaterThan(200);
    // An earlier word still beats a later one, so position keeps breaking ties.
    expect(fuzzyScore("pay", paycheck)!).toBeGreaterThan(fuzzyScore("pay", takeHome)!);
    // And a word start still loses to matching the whole string exactly.
    expect(fuzzyScore("pay", "pay")!).toBeGreaterThan(fuzzyScore("pay", paycheck)!);
  });
});

/**
 * Every tool is findable by its own name (SPEC-2 §1: search is one of the two
 * primary browse paths, the crawlable All Tools index being the other).
 *
 * The palette's suite drove one query, "take home", and the catalog was never
 * asked the obvious question: can a reader who knows what a tool is called type
 * that and press Enter? For one of the 81 entries the answer was no. A
 * multi-word query sums its tokens, and the scorer's only notion of a strong
 * match was a prefix of the whole string — so typing **"Take-Home Pay"** scored
 * 775.4 for the *Paycheck Optimizer* (whose text starts with "pay") against
 * 769.6 for Take-Home Pay itself, and Enter takes the top row. A reader typing
 * a tool's exact full name opened a different tool.
 *
 * Both halves are asserted, because they fail in different directions: the
 * title has to come back *first*, and a curated keyword has to come back at all.
 */
describe("the search index over the whole catalog", () => {
  it("puts a tool first when its own full name is typed", () => {
    const wrong = SEARCH_ENTRIES.filter((e) => {
      const top = fuzzyFilter(e.title, SEARCH_ENTRIES, searchEntryText)[0]?.item;
      return top?.title !== e.title || top?.tool !== e.tool;
    }).map((e) => `${e.title} (${e.tool ?? "hub"})`);
    expect(wrong, "typing this tool's own name opens a different tool").toEqual([]);
  });

  it("finds a tool by every keyword it claims", () => {
    const missing: string[] = [];
    for (const e of SEARCH_ENTRIES) {
      for (const keyword of e.keywords) {
        const hit = fuzzyFilter(keyword, SEARCH_ENTRIES, searchEntryText).some(
          (r) => r.item.title === e.title && r.item.tool === e.tool,
        );
        if (!hit) missing.push(`"${keyword}" does not find ${e.title}`);
      }
    }
    expect(missing, "a keyword is a promise that the word leads here").toEqual([]);
  });
});
