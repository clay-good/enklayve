import { describe, it, expect } from "vitest";
import {
  assertCited,
  cite,
  citationProblems,
  isCited,
  type Citation,
} from "../src/engine/citation";

const goodCitation: Citation = {
  sourceUrl: "https://www.irs.gov/pub/irs-drop/rp-23-34.pdf",
  sourceDocument: "IRS Rev. Proc. 2023-34",
  effectiveYear: 2024,
  dateRetrieved: "2024-01-15",
  contentHash: "a3f1c0deadbeef",
};

describe("provenance assertion (no orphan numbers, BUILD-SPEC §9)", () => {
  it("returns the value when the citation is complete", () => {
    const c = cite(12345, goodCitation);
    expect(assertCited(c, "standard deduction")).toBe(12345);
    expect(isCited(goodCitation)).toBe(true);
    expect(citationProblems(goodCitation)).toEqual([]);
  });

  it("throws when the citation is missing", () => {
    // @ts-expect-error intentionally passing a value with no citation
    expect(() => assertCited({ value: 1 }, "rate")).toThrow(/Uncited rate/);
  });

  it("flags each empty field", () => {
    expect(citationProblems({ ...goodCitation, sourceUrl: "  " })).toContain("sourceUrl is empty");
    expect(citationProblems({ ...goodCitation, sourceDocument: "" })).toContain(
      "sourceDocument is empty",
    );
    expect(citationProblems({ ...goodCitation, contentHash: "" })).toContain(
      "contentHash is empty",
    );
  });

  it("rejects an invalid effective year", () => {
    expect(isCited({ ...goodCitation, effectiveYear: 0 })).toBe(false);
    expect(isCited({ ...goodCitation, effectiveYear: 1800 })).toBe(false);
  });

  it("rejects a non-ISO retrieval date", () => {
    expect(isCited({ ...goodCitation, dateRetrieved: "01/15/2024" })).toBe(false);
    expect(isCited({ ...goodCitation, dateRetrieved: "2024-1-5" })).toBe(false);
  });

  it("reports all problems for a fully empty citation", () => {
    const empty: Citation = {
      sourceUrl: "",
      sourceDocument: "",
      effectiveYear: 0,
      dateRetrieved: "",
      contentHash: "",
    };
    expect(citationProblems(empty).length).toBe(5);
  });
});
