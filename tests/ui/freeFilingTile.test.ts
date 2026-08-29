import { describe, it, expect, beforeAll } from "vitest";
import axe from "axe-core";
import { mountFreeFiling, freeFilingTile } from "../../src/tiles/freeFiling";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import { getTile } from "../../src/tiles/registry";
import type { TileContext } from "../../src/tiles/types";

/**
 * Free Filing (SPEC-4 §A5). The properties worth pinning at the UI layer are the
 * honesty ones: the tile shows what you *don't* qualify for and why, it lists
 * what was checked and found gone, and it never leaves a high earner believing
 * they have to pay.
 */
let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

function mount(params: URLSearchParams, bundled: BundledData | null = data): HTMLElement {
  const root = document.createElement("div");
  mountFreeFiling({
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

const headings = (root: HTMLElement): string[] =>
  [...root.querySelectorAll(".ff-heading")].map((h) => h.textContent ?? "");

describe("Do I Have to Pay to File?", () => {
  it("lists the open options for a low-income household", () => {
    const root = mount(new URLSearchParams({ agi: "38000", age: "34" }));
    const open = [...root.querySelectorAll(".ff-channel--yes")].map((n) => n.textContent ?? "");
    expect(open.join(" ")).toContain("IRS Free File");
    expect(open.join(" ")).toContain("VITA");
  });

  it("shows what you don't qualify for and exactly why", () => {
    const root = mount(new URLSearchParams({ agi: "94000", age: "34" }));
    expect(headings(root)).toContain("Not open to you, and why");
    const closed = [...root.querySelectorAll(".ff-channel--no")].map((n) => n.textContent ?? "");
    expect(closed.join(" ")).toContain("$89,000");
    expect(closed.join(" ")).toContain("$5,000");
  });

  it("never tells a high earner they have to pay", () => {
    const root = mount(new URLSearchParams({ agi: "2000000", age: "40" }));
    const open = [...root.querySelectorAll(".ff-channel--yes")].map((n) => n.textContent ?? "");
    expect(open.join(" ")).toContain("Free File Fillable Forms");
  });

  it("lists a discontinued option as checked, not silently dropped", () => {
    const root = mount(new URLSearchParams({ agi: "40000" }));
    expect(headings(root)).toContain("Checked, and not available this year");
    const gone = root.querySelector(".ff-channel--gone")?.textContent ?? "";
    expect(gone).toContain("Direct File");
    expect(gone).toContain("not available");
  });

  it("opens the in-person program past its income ceiling on a qualifying condition", () => {
    const root = mount(new URLSearchParams({ agi: "120000", dis: "1" }));
    const open = [...root.querySelectorAll(".ff-channel--yes")].map((n) => n.textContent ?? "");
    expect(open.join(" ")).toContain("VITA");
    expect(open.join(" ")).toContain("disabilities");
  });

  it("names the tax year and filing season, since these move annually", () => {
    const lead = mount(new URLSearchParams({ agi: "40000" })).querySelector(".ff-lead");
    expect(lead?.textContent).toContain("Tax year 2025, filed in 2026");
  });

  it("cites the IRS and says the thresholds move", () => {
    const source = mount(new URLSearchParams({ agi: "40000" })).querySelector(".ff-source");
    expect(source?.querySelector("a")?.getAttribute("href")).toContain("irs.gov");
    expect(source?.textContent).toContain("change every filing season");
  });

  it("paints no NaN over adversarial params", () => {
    for (const params of [
      new URLSearchParams({ agi: "abc", age: "abc" }),
      new URLSearchParams({ agi: "-1", age: "-1" }),
      new URLSearchParams({ agi: "1e15", age: "99999" }),
    ]) {
      expect(mount(params).textContent).not.toMatch(/NaN|Infinity/);
    }
  });

  it("shows the verify banner when the data is unavailable", () => {
    expect(mount(new URLSearchParams(), null).querySelector(".verify-banner")).not.toBeNull();
  });

  it("is tier 1 itself, inside a hub that inherits the strictest tier it hosts", () => {
    expect(freeFilingTile.harmTier).toBe(1);
    const hub = getTile("when-money-is-tight");
    expect(hub).toBeDefined();
    // The hub also hosts the tier-3 charity-care screener.
    expect(hub!.harmTier).toBe(3);
  });

  it("is axe-clean", async () => {
    const root = mount(new URLSearchParams({ agi: "40000", age: "34" }));
    document.body.append(root);
    const results = await axe.run(root);
    document.body.removeChild(root);
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});
