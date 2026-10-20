import { describe, it, expect, beforeAll } from "vitest";
import axe from "axe-core";
import { hsaMedicareTiming } from "../../src/engine/medicare";
import { hsaMedicareTimingTile } from "../../src/tiles/hsaMedicareTiming";
import { mountHsaMedicareTiming } from "../../src/tiles/hsaMedicareTimingView";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import { checkHarmTier, type AuditTile } from "../../scripts/audit-release";
import type { MedicareCostsData } from "../../src/data/schemas";
import type { TileContext } from "../../src/tiles/types";

/**
 * HSA and Medicare Timing (SPEC-5 Phase 29, later-life L7): the last month is
 * read from when Part A starts (42 CFR §406.6(d)(4)), never from the date the
 * reader applies, and a golden case proves the two differ.
 */
let data: BundledData;
let costs: MedicareCostsData;
const LIMITS = { selfOnly: 4400, family: 8750, catchUp55: 1000 };
beforeAll(async () => {
  data = await loadBundledData();
  await data.loadDeferred("medicare-costs-2026");
  costs = data.medicareCosts()!;
});

const timing = (birthDate: string, applyMonth: string, coverage: "self" | "family" = "family") =>
  hsaMedicareTiming({ birthDate, applyMonth, coverage, limits: LIMITS }, costs);

describe("when HSA contributions stop", () => {
  it("reaches back six months from a late application, not to the month applied", () => {
    // Eligible March 2026; applying in December starts Part A in June.
    const r = timing("1961-03-15", "2026-12");
    expect(r.eligibleFrom).toEqual({ year: 2026, month: 3 });
    expect(r.partAFrom).toEqual({ year: 2026, month: 6 });
    expect(r.backdatedMonths).toBe(6);
    expect(r.lastContributionMonth).toEqual({ year: 2026, month: 5 });
    // ($8,750 + $1,000) × 5 / 12.
    expect(r.eligibleMonths).toBe(5);
    expect(r.limit.toNumber()).toBe(4062.5);
  });

  it("reaches back only to the month of eligibility inside the window", () => {
    const r = timing("1961-03-15", "2026-05");
    expect(r.partAFrom).toEqual({ year: 2026, month: 3 });
    expect(r.backdatedMonths).toBe(2);
    expect(timing("1961-03-15", "2025-12").partAFrom).toEqual({ year: 2026, month: 3 });
  });

  it("makes a first-of-the-month birthday eligible the month before", () => {
    expect(timing("1961-04-01", "2026-04").eligibleFrom).toEqual({ year: 2026, month: 3 });
  });

  it("leaves nothing to contribute when Part A starts in January", () => {
    const r = timing("1961-01-15", "2026-01", "self");
    expect(r.lastContributionMonth).toBeNull();
    expect(r.limit.toNumber()).toBe(0);
  });
});

function mount(params: URLSearchParams, bundled: BundledData | null = data): HTMLElement {
  const root = document.createElement("div");
  mountHsaMedicareTiming({
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

const CASE = new URLSearchParams({ born: "1961-03-15", apply: "2026-12", cov: "family" });

describe("HSA and Medicare Timing", () => {
  it("shows Part A's real start, the last month, the limit and the excess, cited", () => {
    const root = mount(CASE);
    const text = root.textContent ?? "";
    expect(text).toContain("Premium-free Part A starts 6 months before you apply");
    expect(text).toContain("June 2026");
    expect(text).toContain("May 2026");
    expect(text).toContain("$4,062.50");
    expect(text).toContain("excess contribution, even though you had not applied yet");
    expect(root.querySelectorAll("a.cite-link").length).toBeGreaterThanOrEqual(3);
  });

  it("asks for both dates before answering, and degrades to a banner without rules", () => {
    expect(mount(new URLSearchParams()).textContent).toContain("Enter your date of birth");
    const root = mount(CASE, null);
    expect(root.querySelector(".verify-banner")).not.toBeNull();
    expect(root.textContent).not.toMatch(/\$\d/);
  });

  it("declares harm tier 2 with the advice line, and clears the gate", async () => {
    await hsaMedicareTimingTile.loadHow!();
    expect(hsaMedicareTimingTile.harmTier).toBe(2);
    expect(checkHarmTier([hsaMedicareTimingTile as AuditTile])).toEqual([]);
  });

  it("has no axe violations", async () => {
    const root = mount(CASE);
    document.body.append(root);
    const results = await axe.run(root, { rules: { "color-contrast": { enabled: false } } });
    root.remove();
    expect(results.violations).toEqual([]);
  });
});
