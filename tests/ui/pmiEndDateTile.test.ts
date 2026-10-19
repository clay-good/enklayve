import { describe, it, expect, beforeAll } from "vitest";
import axe from "axe-core";
import { pmiEndDates } from "../../src/engine/pmi";
import { mountPmiEndDate, pmiEndDateTile, paymentMonth } from "../../src/tiles/pmiEndDate";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import { checkHarmTier, type AuditTile } from "../../scripts/audit-release";
import type { TileContext } from "../../src/tiles/types";

/**
 * When PMI ends (SPEC-5 Phase 28), from 12 U.S.C. §§4901-4902.
 *
 * The expected payments below were computed outside this codebase, with the
 * same cent rounding a servicer's schedule uses: the level payment rounded to
 * the cent, each month's interest rounded to the cent.
 */
let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

const lines = () => {
  const r = data.pmiCancellation()!;
  return {
    requestShare: r.requestShareOfOriginalValue,
    automaticShare: r.automaticShareOfOriginalValue,
  };
};

describe("the Homeowners Protection Act's dates", () => {
  it("reads the lines from the cited shard: 80% to ask, 78% automatically", () => {
    expect(lines()).toEqual({ requestShare: 0.8, automaticShare: 0.78 });
    expect(data.pmiCancellation()!.citation.sourceUrl).toContain("/12/4902");
  });

  it("puts the request date before the automatic date, both on the original schedule", () => {
    // $360,000 on a $400,000 home at 6.5% for 30 years: $2,275.44 a month.
    const r = pmiEndDates({
      originalValue: 400000,
      loanAmount: 360000,
      annualRatePct: 6.5,
      termYears: 30,
      extraMonthly: 0,
      ...lines(),
    });
    expect(r.scheduledPayment.toNumber()).toBe(2275.44);
    expect(r.request).toEqual({ payment: 95 });
    expect(r.automatic).toEqual({ payment: 109 });
    // The midpoint of 360 payments is 180; the cutoff is the month after.
    expect(r.final).toEqual({ payment: 181 });
    expect(r.requestLine.toNumber()).toBe(320000);
    expect(r.automaticLine.toNumber()).toBe(312000);
  });

  it("lets extra principal move the request date and never the automatic one", () => {
    const base = {
      originalValue: 400000,
      loanAmount: 360000,
      annualRatePct: 6.5,
      termYears: 30,
      ...lines(),
    };
    const plain = pmiEndDates({ ...base, extraMonthly: 0 });
    const extra = pmiEndDates({ ...base, extraMonthly: 200 });
    expect(extra.requestWithExtra).toEqual({ payment: 64 });
    expect(extra.request).toEqual(plain.request);
    expect(extra.automatic).toEqual(plain.automatic);
    expect(extra.final).toEqual(plain.final);
  });

  it("handles a 5%-down loan and a zero-rate one", () => {
    const fivePct = pmiEndDates({
      originalValue: 300000,
      loanAmount: 285000,
      annualRatePct: 7,
      termYears: 30,
      extraMonthly: 0,
      ...lines(),
    });
    expect(fivePct.request).toEqual({ payment: 130 });
    expect(fivePct.automatic).toEqual({ payment: 142 });
    const zero = pmiEndDates({
      originalValue: 250000,
      loanAmount: 225000,
      annualRatePct: 0,
      termYears: 15,
      extraMonthly: 0,
      ...lines(),
    });
    expect(zero.request).toEqual({ payment: 20 });
    expect(zero.automatic).toEqual({ payment: 24 });
    expect(zero.final).toEqual({ payment: 91 });
  });

  it("says a loan already at or under the line needs no PMI", () => {
    const r = pmiEndDates({
      originalValue: 400000,
      loanAmount: 320000,
      annualRatePct: 6.5,
      termYears: 30,
      extraMonthly: 0,
      ...lines(),
    });
    expect(r.atOrUnderRequestLine).toBe(true);
  });

  it("counts payment months from the first payment", () => {
    expect(paymentMonth("2026-12", 1, "en-US")).toBe("December 2026");
    expect(paymentMonth("2026-12", 109, "en-US")).toBe("December 2035");
    expect(paymentMonth("2026-12", 2, "en-US")).toBe("January 2027");
  });
});

function mount(params: URLSearchParams, bundled: BundledData | null = data): HTMLElement {
  const root = document.createElement("div");
  mountPmiEndDate({
    root,
    params,
    setParams: () => {},
    permalink: (p) => `https://enklayve.com/#/x?${(p ?? params).toString()}`,
    navigate: () => {},
    locale: "en-US",
    data: bundled,
    profile: new SituationStore(),
  } as TileContext);
  return root;
}

const EXAMPLE = new URLSearchParams({
  v: "400000",
  p: "360000",
  r: "6.5",
  y: "30",
  x: "200",
  fp: "2026-12",
});

describe("When PMI Ends", () => {
  it("shows each date with its month, each line cited", () => {
    const text = mount(EXAMPLE).textContent ?? "";
    expect(text).toContain("payment 95, 7 yr 11 mo in (October 2034)");
    expect(text).toContain("payment 64, 5 yr 4 mo in (March 2032)");
    expect(text).toContain("payment 109, 9 yr 1 mo in (December 2035)");
    expect(text).toContain("payment 181, 15 yr 1 mo in (December 2041)");
    expect(mount(EXAMPLE).querySelectorAll("a.cite-link").length).toBeGreaterThanOrEqual(4);
  });

  it("gives no dates without a value and a loan, and none for a loan under the line", () => {
    expect(mount(new URLSearchParams()).textContent).toContain("Enter the home's original value");
    const under = mount(new URLSearchParams({ v: "400000", p: "300000" })).textContent ?? "";
    expect(under).toContain("already at or under the 80% line");
    expect(under).not.toMatch(/payment \d/);
  });

  it("degrades to a banner, never a date, when the rules are missing", () => {
    const root = mount(EXAMPLE, null);
    expect(root.querySelector(".verify-banner")).not.toBeNull();
    expect(root.textContent).not.toMatch(/payment \d/);
  });

  it("declares harm tier 1 and clears the gate", () => {
    expect(pmiEndDateTile.harmTier).toBe(1);
    expect(checkHarmTier([pmiEndDateTile as AuditTile])).toEqual([]);
  });

  it("has no axe violations", async () => {
    const root = mount(EXAMPLE);
    document.body.append(root);
    const results = await axe.run(root, { rules: { "color-contrast": { enabled: false } } });
    root.remove();
    expect(results.violations).toEqual([]);
  });
});
