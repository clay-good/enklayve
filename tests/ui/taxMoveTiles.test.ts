import { describe, it, expect, beforeAll, afterEach } from "vitest";
import axe from "axe-core";
import { mountTaxLossHarvesting } from "../../src/tiles/taxLossHarvesting";
import { mountRothLadder } from "../../src/tiles/rothLadder";
import { mountSocialSecurity } from "../../src/tiles/socialSecurity";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import type { TileContext } from "../../src/tiles/types";

/**
 * Tax moves (BUILD-SPEC-2 §6.5) + Social Security claiming (§6.7), Phase 17
 * fourth wave. Each is deterministic, deep-linkable, worked-example-first, and
 * passes axe. Tax-loss harvesting and the Roth ladder cite the IRC inline; the
 * Social Security tile reads its rule from the bundled, cited dataset.
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

describe("Tax-Loss Harvesting", () => {
  it("harvests losses against gains and shows the tax saved with a cited limit", () => {
    const { root } = mount(
      mountTaxLossHarvesting,
      new URLSearchParams({ ltg: "20000", ltl: "15000", ord: "24", lt: "15" }),
    );
    expect(rowValue(root, "Net long-term")).toContain("$5,000");
    expect(rowValue(root, "Estimated tax saved")).toContain("$2,250");
    // The $3,000 limit and the wash-sale rule cite the IRC.
    expect(root.querySelector("a.cite-link")).not.toBeNull();
  });

  it("offsets ordinary income up to the limit and carries the rest forward", () => {
    const { root } = mount(
      mountTaxLossHarvesting,
      new URLSearchParams({ ltl: "10000", ord: "24", lt: "15" }),
    );
    expect(rowValue(root, "Net capital loss")).toContain("$10,000");
    expect(rowValue(root, "Offsets ordinary income")).toContain("$3,000");
    expect(rowValue(root, "Carries forward")).toContain("$7,000");
    expect(rowValue(root, "Estimated tax saved")).toContain("$720");
  });

  it("uses the $1,500 limit when My Situation is married filing separately", () => {
    const profile = new SituationStore();
    profile.set("filingStatus", "married_separately");
    const { root } = mount(
      mountTaxLossHarvesting,
      new URLSearchParams({ ltl: "10000", ord: "22", lt: "15" }),
      profile,
    );
    expect(rowValue(root, "Offsets ordinary income")).toContain("$1,500");
  });

  it("prefills a worked example and deep-links it", () => {
    const { root, lastParams } = mount(mountTaxLossHarvesting, new URLSearchParams());
    clickExample(root);
    expect(root.querySelector<HTMLInputElement>('input[name="ltl"]')?.value).toBe("15000");
    expect(lastParams()?.get("ltl")).toBe("15000");
  });
});

describe("Roth Conversion Ladder", () => {
  it("lays out the 5-year seasoning schedule and the steady stream", () => {
    const { root } = mount(
      mountRothLadder,
      new URLSearchParams({ y0: "2026", amt: "40000", n: "5", ord: "12" }),
    );
    expect(rowValue(root, "Convert in 2026")).toContain("penalty-free in 2031");
    expect(rowValue(root, "Total converted")).toContain("$200,000");
    expect(rowValue(root, "Estimated conversion tax")).toContain("$24,000");
    expect(rowValue(root, "Steady amount unlocked")).toContain("starting 2031");
    expect(root.querySelector("a.cite-link")).not.toBeNull();
  });

  it("prompts before an amount and a year count are entered", () => {
    const { root } = mount(mountRothLadder, new URLSearchParams({ amt: "0", n: "0" }));
    expect(root.querySelector(".ph-empty")).not.toBeNull();
  });
});

describe("Social Security Claiming Age", () => {
  it("compares claiming at 62, FRA, and 70 for a 1965 birth (FRA 67)", () => {
    const { root } = mount(
      mountSocialSecurity,
      new URLSearchParams({ pia: "2000", born: "1965", age: "62" }),
    );
    expect(rowValue(root, "Full retirement age for 1965")).toContain("age 67");
    expect(rowValue(root, "If you claim at 62")).toContain("$1,400");
    expect(rowValue(root, "If you claim at full retirement age")).toContain("$2,000");
    expect(rowValue(root, "If you claim at 70")).toContain("$2,480");
    expect(rowValue(root, "Your choice: age 62")).toContain("$1,400");
    // The benefit rule cites the SSA dataset.
    expect(root.querySelector("a.cite-link")).not.toBeNull();
  });

  it("prefills a worked example and deep-links it", () => {
    const { root, lastParams } = mount(mountSocialSecurity, new URLSearchParams());
    clickExample(root);
    expect(root.querySelector<HTMLInputElement>('input[name="pia"]')?.value).toBe("2000");
    expect(lastParams()?.get("born")).toBe("1965");
  });
});

describe("tax-move + claiming tiles accessibility", () => {
  for (const tc of [
    {
      name: "tax-loss-harvesting",
      mount: mountTaxLossHarvesting,
      params: new URLSearchParams({ ltg: "20000", ltl: "15000", ord: "24", lt: "15" }),
    },
    {
      name: "roth-ladder",
      mount: mountRothLadder,
      params: new URLSearchParams({ y0: "2026", amt: "40000", n: "5", ord: "12" }),
    },
    {
      name: "social-security",
      mount: mountSocialSecurity,
      params: new URLSearchParams({ pia: "2000", born: "1965", age: "62" }),
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
