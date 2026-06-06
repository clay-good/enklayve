import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import axe from "axe-core";
import { mountKiddieTax } from "../../src/tiles/kiddieTax";
import { mountEducationCredits } from "../../src/tiles/educationCredits";
import { mountCompoundGrowth } from "../../src/tiles/compoundGrowth";
import { capitalGainsTile } from "../../src/tiles/capitalGains";
import { tileHowResources } from "../../src/ui/explainer";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import type { TileContext } from "../../src/tiles/types";

/**
 * SPEC-3 §4 second wave: the kiddie-tax and education-credit tiles, the opt-in
 * sensitivity bands (§4.9), and the cross-tool "related" links (§4.1). Each tile
 * mounts over adversarial params with no NaN/Infinity text (§2.9), shows the
 * verify banner when data is absent, and is axe-clean.
 */
let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

function mount(
  mountFn: (ctx: TileContext) => void,
  params: URLSearchParams,
  bundled: BundledData | null = data,
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
    data: bundled,
    profile: new SituationStore(),
  });
  return { root, lastParams: () => captured };
}

function rowValue(root: HTMLElement, labelStarts: string): string | undefined {
  const row = Array.from(root.querySelectorAll(".bd-row")).find((r) =>
    (r.querySelector(".bd-label")?.textContent ?? "").startsWith(labelStarts),
  );
  return row?.querySelector(".bd-value")?.textContent ?? undefined;
}

function assertNoBadNumbers(root: HTMLElement): void {
  expect(root.textContent ?? "").not.toMatch(/NaN|\$?Infinity|\$∞/);
}

afterEach(() => document.body.replaceChildren());

describe("Kiddie Tax Estimator", () => {
  it("shows the three-band stack for a worked example", () => {
    const { root } = mount(mountKiddieTax, new URLSearchParams({ u: "8000", pr: "0.24" }));
    expect(rowValue(root, "Dependent standard deduction")).toBe("$1,350.00");
    expect(rowValue(root, "Estimated total tax")).toBe("$1,407.00");
  });

  it("shows the verify banner when data is missing and stays finite on junk input", () => {
    expect(
      mount(mountKiddieTax, new URLSearchParams(), null).root.querySelector(".verify-banner"),
    ).not.toBeNull();
    const { root } = mount(mountKiddieTax, new URLSearchParams({ u: "-5", e: "x", pr: "9" }));
    assertNoBadNumbers(root);
  });
});

describe("Education Credit Comparison", () => {
  it("compares the AOTC and LLC and names the larger", () => {
    const { root } = mount(
      mountEducationCredits,
      new URLSearchParams({ magi: "70000", exp: "4000", aotc: "1", mfj: "0" }),
    );
    expect(rowValue(root, "American Opportunity Credit (per student)")).toBe("$2,500.00");
    expect(rowValue(root, "Lifetime Learning Credit")).toBe("$800.00");
    expect(rowValue(root, "Which saves more")).toContain("American Opportunity");
  });

  it("shows the verify banner when data is missing and stays finite on junk input", () => {
    expect(
      mount(mountEducationCredits, new URLSearchParams(), null).root.querySelector(
        ".verify-banner",
      ),
    ).not.toBeNull();
    const { root } = mount(mountEducationCredits, new URLSearchParams({ magi: "-1", exp: "NaN" }));
    assertNoBadNumbers(root);
  });
});

describe("Sensitivity bands (§4.9)", () => {
  it("is off by default and renders a low/base/high table when toggled on", () => {
    const off = mount(
      mountCompoundGrowth,
      new URLSearchParams({ p: "10000", c: "500", r: "6", y: "30" }),
    );
    expect(off.root.querySelector(".sensitivity-table")).toBeNull();

    const on = mount(
      mountCompoundGrowth,
      new URLSearchParams({ p: "10000", c: "500", r: "6", y: "30", band: "1" }),
    );
    const table = on.root.querySelector(".sensitivity-table");
    expect(table).not.toBeNull();
    expect(table!.querySelectorAll("tbody .bd-row")).toHaveLength(3);
    // The middle row is the user's own 6% assumption.
    expect(table!.querySelector("tbody .bd-row--total .bd-value")?.textContent).toBe("6.0%");
  });

  it("the toggle writes the band into the deep link", () => {
    const { root, lastParams } = mount(
      mountCompoundGrowth,
      new URLSearchParams({ p: "10000", r: "6", y: "30" }),
    );
    const box = root.querySelector<HTMLInputElement>('input[name="band"]')!;
    box.checked = true;
    box.dispatchEvent(new Event("change"));
    expect(lastParams()?.get("band")).toBe("1");
  });
});

describe("Cross-tool linking (§4.1)", () => {
  it("renders a related-tool link that navigates to the right hub + tool", () => {
    const navigate = vi.fn();
    const section = tileHowResources(capitalGainsTile, navigate)!;
    const link = section.querySelector<HTMLButtonElement>(".related-link");
    expect(link?.textContent).toBe("Marginal Rate Explorer");
    link!.click();
    expect(navigate).toHaveBeenCalledTimes(1);
    const [hubId, params] = navigate.mock.calls[0]!;
    expect(hubId).toBe("paycheck-taxes");
    expect((params as URLSearchParams).get("tool")).toBe("marginal-explorer");
  });

  it("omits the related section when no navigate is provided", () => {
    const section = tileHowResources(capitalGainsTile)!;
    expect(section.querySelector(".related-link")).toBeNull();
  });
});

describe("the new tiles are axe-clean", () => {
  it("has no structural accessibility violations", async () => {
    for (const [fn, params] of [
      [mountKiddieTax, new URLSearchParams({ u: "8000", pr: "0.24" })],
      [mountEducationCredits, new URLSearchParams({ magi: "70000", exp: "4000" })],
      [mountCompoundGrowth, new URLSearchParams({ p: "10000", r: "6", y: "30", band: "1" })],
    ] as const) {
      const { root } = mount(fn, params);
      document.body.append(root);
      const results = await axe.run(root, { rules: { "color-contrast": { enabled: false } } });
      expect(results.violations.map((v) => v.id).join(", ")).toBe("");
      document.body.replaceChildren();
    }
  }, 30000);
});
