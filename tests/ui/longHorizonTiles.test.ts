import { describe, it, expect, beforeAll, afterEach } from "vitest";
import axe from "axe-core";
import { mountDrawdown } from "../../src/tiles/drawdown";
import { mountCollegeCost } from "../../src/tiles/collegeCost";
import { mountEstateChecklist } from "../../src/tiles/estateChecklist";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import type { TileContext } from "../../src/tiles/types";

/**
 * Long-horizon (BUILD-SPEC-2 §6.7) + protection (§6.6) tiles, Phase 17 sixth
 * wave: retirement drawdown with the RMD timeline (reads the cited RMD dataset),
 * the college cost planner, and the estate checklist. All deterministic,
 * deep-linkable, and axe-clean.
 */
let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

function mount(
  mountFn: (ctx: TileContext) => void,
  params: URLSearchParams,
  profile = new SituationStore(),
): { root: HTMLElement; lastParams: () => URLSearchParams | null } {
  const root = document.createElement("div");
  let captured: URLSearchParams | null = null;
  mountFn({
    root,
    params,
    setParams: (p) => {
      captured = p;
    },
    permalink: (p) => `https://enklayve.com/#/x?${(p ?? params).toString()}`,
    navigate: () => {},
    locale: "en-US",
    data,
    profile,
  });
  return { root, lastParams: () => captured };
}

function rowValue(root: HTMLElement, labelStarts: string): string | undefined {
  const rows = Array.from(root.querySelectorAll(".bd-row"));
  const row = rows.find((r) =>
    (r.querySelector(".bd-label")?.textContent ?? "").startsWith(labelStarts),
  );
  return row?.querySelector(".bd-value")?.textContent ?? undefined;
}
function clickExample(root: HTMLElement): void {
  Array.from(root.querySelectorAll("button"))
    .find((b) => b.textContent === "Try an example")!
    .click();
}

afterEach(() => document.body.replaceChildren());

describe("Retirement Drawdown & RMD Timeline", () => {
  it("reports how long a flat-return balance lasts", () => {
    const { root } = mount(
      mountDrawdown,
      new URLSearchParams({ bal: "100000", age: "60", w: "10000", r: "0" }),
    );
    expect(rowValue(root, "Where you stand")).toContain("age 69");
    expect(rowValue(root, "Total withdrawn")).toContain("$100,000");
  });

  it("surfaces the first required distribution from the cited RMD table", () => {
    const { root } = mount(
      mountDrawdown,
      new URLSearchParams({ bal: "500000", age: "73", w: "20000", r: "4" }),
    );
    // 500,000 ÷ 26.5 = $18,867.92 at age 73 (below the 20k chosen draw, so the draw binds,
    // but the RMD line still reports the required figure and cites it).
    expect(rowValue(root, "First required distribution (age 73)")).toContain("$18,867.92");
    expect(root.querySelector("a.cite-link")).not.toBeNull();
  });

  it("prompts for a balance and prefills a worked example", () => {
    const { root, lastParams } = mount(mountDrawdown, new URLSearchParams({ bal: "0" }));
    expect(root.querySelector(".ph-empty")).not.toBeNull();
    clickExample(root);
    expect(root.querySelector<HTMLInputElement>('input[name="bal"]')?.value).toBe("800000");
    expect(lastParams()?.get("bal")).toBe("800000");
  });

  it("signposts an extreme real-return assumption without clamping it (SPEC-3 §2.4)", () => {
    const base = { bal: "500000", age: "65", w: "20000" };
    const calm = mount(mountDrawdown, new URLSearchParams({ ...base, r: "4" }));
    expect(calm.root.querySelector(".assumption-hint")).toBeNull();
    const wild = mount(mountDrawdown, new URLSearchParams({ ...base, r: "25" }));
    expect(wild.root.querySelector(".assumption-hint")?.textContent).toContain("unusually high");
    expect(wild.root.querySelector(".result-card")).not.toBeNull();
  });
});

describe("College Cost Planner", () => {
  it("projects the cost and solves the monthly contribution (no inflation)", () => {
    const { root } = mount(
      mountCollegeCost,
      new URLSearchParams({ cost: "25000", yrs: "10", dur: "4", ci: "0", r: "0" }),
    );
    expect(rowValue(root, "Projected cost")).toContain("$100,000");
    expect(rowValue(root, "Where you stand")).toContain("$833.33");
    expect(root.querySelector("a.cite-link")).toBeNull();
  });

  it("recognizes when current savings already cover the cost", () => {
    const { root } = mount(
      mountCollegeCost,
      new URLSearchParams({ cost: "25000", yrs: "10", dur: "4", ci: "0", c: "200000", r: "0" }),
    );
    expect(rowValue(root, "Where you stand")).toContain("on track");
  });

  it("prompts for a cost before planning", () => {
    const { root } = mount(mountCollegeCost, new URLSearchParams({ cost: "0" }));
    expect(root.querySelector(".ph-empty")).not.toBeNull();
  });

  it("signposts extreme inflation or return assumptions without clamping them (SPEC-3 §2.4)", () => {
    const calm = mount(mountCollegeCost, new URLSearchParams({ cost: "25000", ci: "5", r: "5" }));
    expect(calm.root.querySelector(".assumption-hint")).toBeNull();
    // Extreme inflation alone → the singular wording.
    const infl = mount(mountCollegeCost, new URLSearchParams({ cost: "25000", ci: "40", r: "5" }));
    expect(infl.root.querySelector(".assumption-hint")?.textContent).toContain("unusually high");
    // Extreme expected return alone is now caught too (the second assumption).
    const ret = mount(mountCollegeCost, new URLSearchParams({ cost: "25000", ci: "5", r: "90" }));
    expect(ret.root.querySelector(".assumption-hint")?.textContent).toContain("Expected return");
    // Both extreme → one combined line, not two notes.
    const both = mount(mountCollegeCost, new URLSearchParams({ cost: "25000", ci: "40", r: "90" }));
    expect(both.root.querySelectorAll(".assumption-hint").length).toBe(1);
    expect(both.root.querySelector(".assumption-hint")?.textContent).toContain(
      "are outside the usual range",
    );
    expect(both.root.querySelector(".result-card")).not.toBeNull();
  });
});

describe("Estate & Beneficiary Checklist", () => {
  it("counts the items in place and deep-links the selection", () => {
    const { root, lastParams } = mount(
      mountEstateChecklist,
      new URLSearchParams({ d: "will,poa" }),
    );
    expect(rowValue(root, "Items in place")).toContain("2 of 8");
    expect(rowValue(root, "A will that names an executor")).toContain("In place");
    expect(rowValue(root, "A durable financial power of attorney")).toContain("In place");
    expect(rowValue(root, "A healthcare directive")).toContain("To do");
    // Checking another box updates the count and the URL.
    const box = root.querySelector<HTMLInputElement>('input[name="hcd"]')!;
    box.checked = true;
    box.dispatchEvent(new Event("change"));
    expect(rowValue(root, "Items in place")).toContain("3 of 8");
    expect(lastParams()?.get("d")).toBe("will,poa,hcd");
  });

  it("prefills a worked example", () => {
    const { root } = mount(mountEstateChecklist, new URLSearchParams());
    expect(rowValue(root, "Items in place")).toContain("0 of 8");
    clickExample(root);
    expect(rowValue(root, "Items in place")).toContain("4 of 8");
  });
});

describe("long-horizon tiles accessibility", () => {
  for (const tc of [
    {
      name: "retirement-drawdown",
      mount: mountDrawdown,
      params: new URLSearchParams({ bal: "800000", age: "65", w: "40000", r: "4" }),
    },
    {
      name: "college-cost",
      mount: mountCollegeCost,
      params: new URLSearchParams({
        cost: "28000",
        yrs: "10",
        dur: "4",
        ci: "5",
        c: "10000",
        r: "5",
      }),
    },
    {
      name: "estate-checklist",
      mount: mountEstateChecklist,
      params: new URLSearchParams({ d: "will,bene,poa,hcd" }),
    },
  ]) {
    it(`${tc.name} has no axe violations`, async () => {
      const { root } = mount(tc.mount, tc.params);
      document.body.append(root);
      const results = await axe.run(root, { rules: { "color-contrast": { enabled: false } } });
      expect(results.violations.map((v) => v.id).join(", ")).toBe("");
    }, 30000);
  }
});
