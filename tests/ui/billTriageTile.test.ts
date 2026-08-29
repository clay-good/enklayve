import { describe, it, expect, beforeAll } from "vitest";
import axe from "axe-core";
import { mountBillTriage, billTriageTile } from "../../src/tiles/billTriage";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import { getTile } from "../../src/tiles/registry";
import type { TileContext } from "../../src/tiles/types";

/**
 * Bill Triage (SPEC-4 §A3), harm tier 2. The tier-2 obligations are asserted
 * here, not left to review: consequences render inline on every ranked line, the
 * tool never tells anyone to skip a bill, and state-set timing is a pointer.
 */
let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

function mount(
  params: URLSearchParams,
  bundled: BundledData | null = data,
): { root: HTMLElement; lastParams: () => URLSearchParams | null } {
  const root = document.createElement("div");
  let captured: URLSearchParams | null = null;
  mountBillTriage({
    root,
    params,
    setParams: (p) => {
      captured = p;
    },
    permalink: (p) => `https://enklayve.com/#/x?${(p ?? params).toString()}`,
    navigate: () => {},
    locale: "en-US",
    data: bundled,
    profile: new SituationStore(),
  } as TileContext);
  return { root, lastParams: () => captured };
}

/** A month that doesn't close: $1,600 against $2,255 of bills. */
const SHORT_MONTH = new URLSearchParams({
  have: "1600",
  k: "4",
  n0: "Visa",
  c0: "credit-cards",
  a0: "95",
  n1: "Rent",
  c1: "housing",
  a1: "1450",
  n2: "Electric",
  c2: "utilities",
  a2: "190",
  n3: "Car payment",
  c3: "job-transport",
  a3: "520",
});

describe("Bill Triage", () => {
  it("puts housing and utilities ahead of the highest-rate card", () => {
    const { root } = mount(SHORT_MONTH);
    const names = [...root.querySelectorAll(".triage-item__name")].map((n) => n.textContent);
    expect(names).toEqual(["Rent", "Electric", "Car payment", "Visa"]);
  });

  it("renders the consequence inline on every ranked line (tier-2 obligation)", () => {
    const { root } = mount(SHORT_MONTH);
    const items = [...root.querySelectorAll(".triage-item")];
    expect(items.length).toBe(4);
    for (const item of items) {
      const consequence = item.querySelector(".triage-item__consequence");
      expect(consequence).not.toBeNull();
      expect((consequence!.textContent ?? "").length).toBeGreaterThan(20);
      expect(item.querySelectorAll(".triage-item__relief li").length).toBeGreaterThan(0);
    }
  });

  it("never tells anyone to skip, ignore, or not pay a bill", () => {
    const text = (mount(SHORT_MONTH).root.textContent ?? "").toLowerCase();
    for (const forbidden of ["skip ", "don't pay", "do not pay", "ignore this", "stop paying"]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });

  it("shows the partial payment where the money runs out, not just unpaid", () => {
    const { root } = mount(SHORT_MONTH);
    const partial = root.querySelector(".triage-item--partial .triage-item__amount");
    expect(partial?.textContent).toContain(" of ");
  });

  it("flags state-set timing as the state's rule rather than a number", () => {
    const { root } = mount(SHORT_MONTH);
    const notes = [...root.querySelectorAll(".triage-note")].map((n) => n.textContent ?? "");
    const stateNote = notes.find((n) => n.includes("set by your state"));
    expect(stateNote).toBeDefined();
    for (const timing of [...root.querySelectorAll(".triage-item__timing")]) {
      expect(timing.textContent).not.toMatch(/\b\d+\s*(day|days|week|weeks|month|months)\b/);
    }
  });

  it("cites the source and says the default order is adjustable", () => {
    const { root } = mount(SHORT_MONTH);
    const source = root.querySelector(".triage-source");
    expect(source?.querySelector("a")?.getAttribute("href")).toContain("consumerfinance.gov");
    expect(source?.textContent).toContain("change it to fit your situation");
  });

  it("leads with the gap in plain words, without repeating the same figure", () => {
    const lead = mount(SHORT_MONTH).root.querySelector(".triage-lead")?.textContent ?? "";
    expect(lead).toContain("You have $1,600.00 against $2,255.00 of bills");
    expect(lead).toContain("$655.00 short");
  });

  it("says plainly when no triage is needed", () => {
    const p = new URLSearchParams(SHORT_MONTH);
    p.set("have", "99999");
    expect(mount(p).root.querySelector(".triage-lead")?.textContent).toContain("No triage needed");
  });

  it("paints no NaN over adversarial params", () => {
    for (const params of [
      new URLSearchParams({ have: "abc", k: "2", a0: "abc", c0: "nope", a1: "-5" }),
      new URLSearchParams({ have: "-1", k: "9999" }),
      new URLSearchParams({ have: "1e15", k: "1", a0: "1e15", c0: "housing" }),
    ]) {
      const { root } = mount(params);
      expect(root.textContent).not.toMatch(/NaN|Infinity/);
    }
  });

  it("caps the row count a crafted link can allocate", () => {
    const { root } = mount(new URLSearchParams({ have: "100", k: "9999" }));
    expect(root.querySelectorAll(".triage-row").length).toBeLessThanOrEqual(40);
  });

  it("shows the verify banner when the rules are unavailable", () => {
    expect(mount(SHORT_MONTH, null).root.querySelector(".verify-banner")).not.toBeNull();
  });

  it("carries harm tier 2 itself, and its hub inherits the strictest tier it hosts", () => {
    expect(billTriageTile.harmTier).toBe(2);
    expect(billTriageTile.how).toMatch(/not\s+legal/i);
    const hub = getTile("when-money-is-tight");
    expect(hub).toBeDefined();
    // The hub hosts the tier-3 charity-care screener, so the hub is tier 3.
    expect(hub!.harmTier).toBe(3);
  });

  it("is axe-clean", async () => {
    const { root } = mount(SHORT_MONTH);
    document.body.append(root);
    const results = await axe.run(root);
    document.body.removeChild(root);
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});
