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
  profile: SituationStore = new SituationStore(),
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

  it("gives a separate filer who lived with their spouse no exempt tier at all", () => {
    // §86(c)(1)(C)(ii): the base amount is zero for a married individual filing
    // separately who did not live apart from their spouse for the whole year,
    // so the benefit is taxable from the first dollar of provisional income.
    // The tile offered three statuses and documented this one as "left out —
    // see the shard note", which reads fine in a comment and does something
    // else on screen: the reader found nothing describing them, picked Single,
    // and was told $25,000 of provisional income was safe.
    const { root } = mount(
      new URLSearchParams({ fs: "married_separately", ss: "20000", oi: "10000" }),
    );
    // The same inputs that produce $0.00 for a single filer, one row up.
    expect(rowValue(root, "Provisional income")).toBe("$20,000.00");
    expect(rowValue(root, "Taxable portion")).toBe("$17,000.00");
    expect(rowValue(root, "Why there is no exempt tier")).toContain("lived apart");
  });

  it("sends a separate filer who lived apart all year to the single amounts", () => {
    // The other half of §86(c)(1)(C), and the reason the option is labelled
    // "lived with spouse" rather than "married filing separately": a separate
    // filer who lived apart all year uses $25,000 / $34,000, and would be
    // wrongly taxed from the first dollar by an option that did not ask.
    const { root } = mount(
      new URLSearchParams({ fs: "married_separately", ss: "20000", oi: "10000" }),
    );
    expect(rowValue(root, "Why there is no exempt tier")).toContain("use Single");
    const options = [...root.querySelectorAll('select[name="fs"] option')].map(
      (o) => o.textContent ?? "",
    );
    expect(options).toContain("Married filing separately, lived with spouse");
  });

  /**
   * Every other calculator with a "Filing status" control pre-fills it from My
   * Situation. This one defaulted to single and asked again — and its whole
   * answer is a pair of base amounts, so a joint filer who had told the site so
   * was measured against $25,000/$34,000 instead of $32,000/$44,000 and read a
   * taxable portion that was not theirs.
   */
  it("opens on the filing status the reader already gave", () => {
    const profile = new SituationStore();
    profile.set("filingStatus", "married_jointly");
    const params = new URLSearchParams({ ss: "24000", oi: "30000" });
    const { root } = mount(params, data, profile);
    expect(root.querySelector<HTMLSelectElement>('select[name="fs"]')?.value).toBe(
      "married_jointly",
    );
    // Provisional income is unchanged at 42,000; the joint bases put it between
    // 32,000 and 44,000, so half the excess is carried rather than 85% of it.
    expect(rowValue(root, "Provisional income")).toBe("$42,000.00");
    expect(rowValue(root, "Taxable portion")).toBe("$5,000.00");
  });

  it("lets the link win over the profile, like every other shared field", () => {
    const profile = new SituationStore();
    profile.set("filingStatus", "married_jointly");
    const { root } = mount(
      new URLSearchParams({ fs: "single", ss: "24000", oi: "30000" }),
      data,
      profile,
    );
    expect(rowValue(root, "Taxable portion")).toBe("$11,300.00");
  });

  it("puts a qualifying surviving spouse on the single amounts, not a fifth option", () => {
    // §86(c)(1)(A) gives them the $25,000/$34,000 bases, which is what the four
    // entries in the select already cover — so the tile computes the right
    // money and writes nothing back, because a four-value control narrowing a
    // five-value field is the bug Education Credits was fixed out of.
    const profile = new SituationStore();
    profile.set("filingStatus", "qualifying_surviving_spouse");
    const { root } = mount(new URLSearchParams({ ss: "24000", oi: "30000" }), data, profile);
    expect(root.querySelector<HTMLSelectElement>('select[name="fs"]')?.value).toBe("single");
    expect(rowValue(root, "Taxable portion")).toBe("$11,300.00");
    expect(profile.get("filingStatus")).toBe("qualifying_surviving_spouse");
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
