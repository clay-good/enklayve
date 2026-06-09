import { describe, it, expect, beforeAll, afterEach } from "vitest";
import axe from "axe-core";
import { mountSocialSecurityTax, socialSecurityTaxTile } from "../../src/tiles/socialSecurityTax";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";

/**
 * Social Security Taxation tile (IRC §86). Mounts over a worked example and
 * adversarial params with no NaN/Infinity text (§2.9), shows the verify banner
 * when data is absent, deep-links its state, and is axe-clean (§11).
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
  mountSocialSecurityTax({
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

afterEach(() => document.body.replaceChildren());

describe("Social Security Taxation tile", () => {
  it("computes the taxable portion for a worked example (single, $24k benefit, $30k other)", () => {
    const { root } = mount(new URLSearchParams({ fs: "single", ss: "24000", oi: "30000" }));
    // provisional 30,000 + 12,000 = 42,000 (> 34,000): carried 4,500 + 0.85·8,000
    // = 11,300, under the 0.85·24,000 = 20,400 cap.
    expect(rowValue(root, "Provisional income")).toBe("$42,000.00");
    expect(rowValue(root, "Taxable portion")).toBe("$11,300.00");
  });

  it("shows $0 taxable below the first base amount, and a source link (no orphan numbers)", () => {
    const { root } = mount(new URLSearchParams({ fs: "single", ss: "20000", oi: "10000" }));
    expect(rowValue(root, "Taxable portion")).toBe("$0.00");
    expect(root.querySelector("a.cite-link")?.getAttribute("href")).toMatch(/^https?:\/\//);
  });

  it("shows the verify banner when data is missing and stays finite on junk input", () => {
    expect(mount(new URLSearchParams(), null).root.querySelector(".verify-banner")).not.toBeNull();
    const { root } = mount(new URLSearchParams({ fs: "zzz", ss: "x", oi: "-9", ti: "NaN" }));
    expect(root.textContent ?? "").not.toMatch(/NaN|\$?Infinity|\$∞/);
  });

  it("deep-links its inputs back to the URL fragment", () => {
    const { root, lastParams } = mount(new URLSearchParams({ fs: "single", ss: "24000" }));
    const ss = root.querySelector<HTMLInputElement>('input[name="ss"]')!;
    ss.value = "40000";
    ss.dispatchEvent(new Event("input"));
    expect(lastParams()?.get("ss")).toBe("40000");
  });

  it("is registered as a ready retirement tool with the §86 keywords", () => {
    expect(socialSecurityTaxTile.status).toBe("ready");
    expect(socialSecurityTaxTile.pillar).toBe("retirement");
    expect(socialSecurityTaxTile.keywords).toContain("provisional income");
  });

  it("the tile form is axe-clean", async () => {
    const { root } = mount(
      new URLSearchParams({ fs: "married_jointly", ss: "40000", oi: "40000" }),
    );
    document.body.append(root);
    const results = await axe.run(root, {
      rules: { region: { enabled: false }, "color-contrast": { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });
});
