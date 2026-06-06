import { describe, it, expect, beforeAll, afterEach } from "vitest";
import axe from "axe-core";
import { mountIraDeduction } from "../../src/tiles/iraDeduction";
import { mountGiftTax } from "../../src/tiles/giftTax";
import { mountAmtScreener } from "../../src/tiles/amtScreener";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import type { TileContext } from "../../src/tiles/types";

/**
 * SPEC-3 §4 next-wave tiles (IRA deduction, gift tax, AMT screener). Each mounts
 * over adversarial params with no NaN/Infinity text node reaching the screen
 * (§2.9), round-trips its deep link, shows the verify banner when its data is
 * absent, and is axe-clean.
 */
let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

function mount(
  mountFn: (ctx: TileContext) => void,
  params: URLSearchParams,
  bundled: BundledData | null = data,
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
    data: bundled,
    profile,
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
  const text = root.textContent ?? "";
  expect(text).not.toMatch(/NaN/);
  expect(text).not.toMatch(/\$?Infinity/);
  expect(text).not.toMatch(/\$∞/);
}

afterEach(() => document.body.replaceChildren());

describe("IRA Deduction Checker", () => {
  it("shows a partial deduction inside the phase-out range", () => {
    const { root } = mount(
      mountIraDeduction,
      new URLSearchParams({ fs: "single", magi: "86000", c: "7500", cov: "1" }),
    );
    expect(rowValue(root, "Deductible amount")).toBe("$3,750.00");
    expect(rowValue(root, "Nondeductible basis")).toBe("$3,750.00");
    expect(rowValue(root, "Phase-out range")).toContain("$81,000");
  });

  it("round-trips its deep link", () => {
    const { root, lastParams } = mount(
      mountIraDeduction,
      new URLSearchParams({ fs: "married_jointly", magi: "245000", c: "7500", scov: "1" }),
    );
    root.querySelector<HTMLInputElement>('input[name="magi"]')!.dispatchEvent(new Event("input"));
    const p = lastParams();
    expect(p?.get("scov")).toBe("1");
    expect(p?.get("fs")).toBe("married_jointly");
  });

  it("shows the verify banner when limit data is missing", () => {
    const { root } = mount(mountIraDeduction, new URLSearchParams(), null);
    expect(root.querySelector(".verify-banner")).not.toBeNull();
  });

  it("stays finite on adversarial input", () => {
    const { root } = mount(
      mountIraDeduction,
      new URLSearchParams({ fs: "x", magi: "-5", c: "abc", cov: "1" }),
    );
    assertNoBadNumbers(root);
  });
});

describe("Gift Tax Checker", () => {
  it("splits a gift into the exclusion and the taxable remainder", () => {
    const { root } = mount(mountGiftTax, new URLSearchParams({ g: "50000", r: "other" }));
    expect(rowValue(root, "Covered by the annual exclusion")).toBe("$19,000.00");
    expect(rowValue(root, "Taxable gift")).toBe("$31,000.00");
  });

  it("shows the marital deduction for a citizen spouse", () => {
    const { root } = mount(mountGiftTax, new URLSearchParams({ g: "1000000", r: "spouse" }));
    expect(rowValue(root, "Gifts to a US-citizen spouse")).toContain("Unlimited");
    assertNoBadNumbers(root);
  });

  it("shows the verify banner when gift-tax data is missing", () => {
    const { root } = mount(mountGiftTax, new URLSearchParams(), null);
    expect(root.querySelector(".verify-banner")).not.toBeNull();
  });
});

describe("AMT Screener", () => {
  it("flags a high earner with a large preference add-back", () => {
    const { root } = mount(
      mountAmtScreener,
      new URLSearchParams({ fs: "married_jointly", ti: "200000", ab: "250000" }),
    );
    expect(rowValue(root, "AMT exemption")).toBe("$140,200.00");
    expect(rowValue(root, "Tentative minimum tax")).toBe("$81,854.00");
    expect(rowValue(root, "Do you owe AMT?")).toContain("Likely");
  });

  it("stays finite on adversarial input and round-trips its link", () => {
    const { root, lastParams } = mount(
      mountAmtScreener,
      new URLSearchParams({ fs: "z", ti: "-1", ab: "NaN" }),
    );
    assertNoBadNumbers(root);
    root.querySelector<HTMLInputElement>('input[name="ti"]')!.dispatchEvent(new Event("input"));
    expect(lastParams()?.get("fs")).toBe("single");
  });

  it("shows the verify banner when AMT data is missing", () => {
    const { root } = mount(mountAmtScreener, new URLSearchParams(), null);
    expect(root.querySelector(".verify-banner")).not.toBeNull();
  });
});

describe("the three new tiles are axe-clean", () => {
  it("has no structural accessibility violations", async () => {
    for (const [fn, params] of [
      [mountIraDeduction, new URLSearchParams({ fs: "single", magi: "86000", cov: "1" })],
      [mountGiftTax, new URLSearchParams({ g: "50000", r: "other" })],
      [mountAmtScreener, new URLSearchParams({ fs: "married_jointly", ti: "520000", ab: "60000" })],
    ] as const) {
      const { root } = mount(fn, params);
      document.body.append(root);
      const results = await axe.run(root, { rules: { "color-contrast": { enabled: false } } });
      expect(results.violations.map((v) => v.id).join(", ")).toBe("");
      document.body.replaceChildren();
    }
  }, 30000);
});
