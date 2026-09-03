import { describe, it, expect, beforeAll } from "vitest";
import { fplPercentText } from "../../src/ui/form";
import { mountAcaPtc } from "../../src/tiles/acaPtc";
import { mountFpl } from "../../src/tiles/fpl";
import { mountOwedScreener } from "../../src/tiles/owedScreener";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import type { TileContext } from "../../src/tiles/types";

/**
 * A figure rounded onto a line it is not on.
 *
 * Every threshold on this site is a whole number of percent — 100 and 400 for
 * the premium tax credit, 138 for Medicaid expansion — and every surface that
 * showed a household's position printed it with `toFixed(0)`. So the three
 * incomes that matter most were shown standing exactly on a line they were over
 * or under, beside the sentence explaining the answer for the other side:
 *
 *   $63,900, household of one → 400.38% → "400% FPL", above
 *     "Above 400% of the poverty line there is no premium tax credit."
 *   $15,900 → 99.62% → "100% FPL", above
 *     "Below 100% of the poverty line the premium tax credit does not reach you."
 *   $22,100 → 138.47% → "138%", beside a Medicaid row that is absent.
 *
 * Each of those is the page contradicting itself in the one place a reader
 * cannot check without redoing the division. The figure keeps its decimal when
 * it would otherwise land on a line the surface decides with, and only then.
 */
let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

function mount(
  mountFn: (ctx: TileContext) => void,
  params: URLSearchParams,
  profile = new SituationStore(),
): HTMLElement {
  const root = document.createElement("div");
  mountFn({
    root,
    params,
    setParams: () => {},
    permalink: (p?: URLSearchParams) => `https://enklayve.com/#/x?${(p ?? params).toString()}`,
    navigate: () => {},
    locale: "en-US",
    data,
    profile,
  } as unknown as TileContext);
  return root;
}

function rowValue(root: HTMLElement, label: string): string | undefined {
  for (const row of root.querySelectorAll(".breakdown-row, .bd-row, li, div")) {
    const text = row.textContent ?? "";
    if (text.startsWith(label)) return text;
  }
  return undefined;
}

describe("fplPercentText", () => {
  it("keeps the whole number when nothing decisive is nearby", () => {
    expect(fplPercentText(400.38)).toBe("400%");
    expect(fplPercentText(212.4, [100, 400])).toBe("212%");
    expect(fplPercentText(0, [100])).toBe("0%");
  });

  it("shows the decimal only when rounding would land on a decisive line", () => {
    expect(fplPercentText(400.38, [100, 400])).toBe("400.4%");
    expect(fplPercentText(399.62, [100, 400])).toBe("399.6%");
    expect(fplPercentText(99.62, [100, 400])).toBe("99.6%");
    expect(fplPercentText(138.47, [138])).toBe("138.5%");
  });

  it("prints a household that is exactly on the line as being on it", () => {
    // The whole point is the reader's trust in the figure, so a household that
    // really is at 400% must not be pushed off the line by a spurious decimal.
    expect(fplPercentText(400, [100, 400])).toBe("400%");
    expect(fplPercentText(100, [100, 400])).toBe("100%");
  });

  it("checks each threshold the caller named, not a hardcoded list", () => {
    // DC expands Medicaid to 215%, which no shared constant would have known.
    expect(fplPercentText(215.3, [138])).toBe("215%");
    expect(fplPercentText(215.3, [215])).toBe("215.3%");
  });

  it("does not print NaN% for a household with no poverty line to divide by", () => {
    expect(fplPercentText(Number.NaN, [100])).toBe("(out of range)");
    expect(fplPercentText(Number.POSITIVE_INFINITY)).toBe("(out of range)");
  });
});

describe("the surfaces that show a household where it stands", () => {
  it("does not print 400% beside a sentence about being above 400%", () => {
    // $63,900 for a household of one is 400.38% of the 2026 contiguous line.
    const root = mount(mountAcaPtc, new URLSearchParams({ hh: "1", inc: "63900", bm: "800" }));
    expect(rowValue(root, "Income vs poverty line")).toContain("400.4% FPL");
    expect(rowValue(root, "Heads up")).toContain("Above 400%");
  });

  it("does not print 100% beside a sentence about being below 100%", () => {
    // $15,900 is 99.62%: a dollar figure of nothing, and a heads-up explaining
    // that the credit does not reach a household below the line.
    const root = mount(mountAcaPtc, new URLSearchParams({ hh: "1", inc: "15900", bm: "800" }));
    expect(rowValue(root, "Income vs poverty line")).toContain("99.6% FPL");
    expect(rowValue(root, "Estimated premium tax credit")).toContain("$0.00/mo");
  });

  it("does not print 138% in a screener summary for a household over 138%", () => {
    const root = mount(mountOwedScreener, new URLSearchParams({ inc: "22100", hh: "1", st: "ca" }));
    const summary = root.querySelector(".screener-summary")?.textContent ?? "";
    expect(summary).toContain("138.5%");
    expect(summary).not.toMatch(/\b138% of the federal poverty line/);
  });

  it("still prints a clean whole number for the ordinary case", () => {
    // 200% exactly, which is the figure a worked example lands on and the one a
    // reader is most likely to recognize.
    const root = mount(mountFpl, new URLSearchParams({ inc: "31920", hh: "1" }));
    expect(rowValue(root, "Income as % of poverty line")).toContain("200%");
    expect(rowValue(root, "Income as % of poverty line")).not.toContain("200.0%");
  });
});
