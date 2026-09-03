import { describe, it, expect, beforeAll } from "vitest";
import axe from "axe-core";
import { mountCharityCare, charityCareTile } from "../../src/tiles/charityCare";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import { checkHarmTier, type AuditTile } from "../../scripts/audit-release";
import type { TileContext } from "../../src/tiles/types";

/**
 * Hospital Financial Assistance (SPEC-4 §A6), harm tier 3. The tier-3 rule is
 * screener-only: it may say what the law requires and where the household sits
 * on the poverty scale, and it may never say whether they qualify. These tests
 * exist to make that impossible to erode later, since "you likely qualify" is
 * exactly the phrasing a well-meaning future edit would add.
 */
let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

function mount(params: URLSearchParams, bundled: BundledData | null = data): HTMLElement {
  const root = document.createElement("div");
  mountCharityCare({
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

const LOW = new URLSearchParams({ inc: "30000", size: "4", st: "tx" });
const HIGH = new URLSearchParams({ inc: "300000", size: "2", st: "tx" });

describe("Hospital Financial Assistance", () => {
  it("reports the household's position on the poverty scale, cited", () => {
    const figure = mount(LOW).querySelector(".cc-figure");
    expect(figure?.textContent).toMatch(/\d+% of the Federal Poverty Level/);
    expect(figure?.querySelector("a.cc-link, a.cite-link")).not.toBeNull();
  });

  it("never says the household qualifies, at any income", () => {
    for (const params of [LOW, HIGH, new URLSearchParams({ inc: "0", size: "1", st: "tx" })]) {
      const text = (mount(params).textContent ?? "").toLowerCase();
      expect(text).not.toContain("you qualify");
      expect(text).not.toContain("you are eligible");
      expect(text).not.toContain("you likely qualify");
      expect(text).not.toContain("you do not qualify");
      expect(text).toContain("only the hospital");
    }
  });

  it("still tells a high earner it is worth asking", () => {
    expect(mount(HIGH).querySelector(".cc-screen")?.textContent).toContain("worth asking");
  });

  it("states the legal requirement with its statutory citation", () => {
    const law = mount(LOW).querySelector(".cc-law");
    expect(law?.textContent).toContain("paper copy on request");
    expect(law?.querySelector("a")?.getAttribute("href")).toContain("501r4");
  });

  it("names the collection clocks, which are the half with a deadline on them", () => {
    // §501(r)(4) tells a patient that help exists; 26 CFR §1.501(r)-6 tells
    // them how long they have to ask and what the hospital may not do
    // meanwhile, and this tile said nothing about it. A person holding a
    // hospital bill is being told to pay it now: that the application period
    // runs to at least the 240th day after the first post-discharge statement,
    // and that no lawsuit, credit report, lien or garnishment may start for 120
    // days from it, is the most useful thing on the page.
    const laws = [...mount(LOW).querySelectorAll(".cc-law")].map((n) => n.textContent ?? "");
    const collection = laws.find((t) => t.includes("240th day"));
    expect(collection, "the collection clocks are not on the page").toBeDefined();
    expect(collection).toContain("120 days");
    expect(collection).toContain("30 days' written warning");
    // The named actions matter more than the phrase "extraordinary collection
    // action", which means nothing to the person receiving one.
    expect(collection).toContain("wage garnishment");
    expect(collection).toContain("credit reporting");
    const href = [...mount(LOW).querySelectorAll(".cc-law a")]
      .map((a) => a.getAttribute("href") ?? "")
      .find((h) => h.includes("501(r)-6"));
    expect(href, "the collection rule is uncited").toBeDefined();
  });

  it("keeps the can't-determine limit visible rather than buried", () => {
    expect(mount(LOW).querySelector(".cc-limit")?.textContent).toContain(
      "not an eligibility determination",
    );
  });

  it("gives the questions to ask, starting with the policy itself", () => {
    const items = [...mount(LOW).querySelectorAll(".cc-ask li")].map((n) => n.textContent ?? "");
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(items[0]).toContain("financial assistance policy");
  });

  it("still points to the policy when the poverty data is unavailable", () => {
    const root = mount(LOW, null);
    const banner = root.querySelector(".verify-banner");
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toContain("required to have one");
  });

  it("paints no NaN over adversarial params", () => {
    for (const params of [
      new URLSearchParams({ inc: "abc", size: "abc", st: "zz" }),
      new URLSearchParams({ inc: "-1", size: "0" }),
      new URLSearchParams({ inc: "1e15", size: "1e9" }),
    ]) {
      expect(mount(params).textContent).not.toMatch(/NaN|Infinity/);
    }
  });

  it("satisfies the tier-3 bar: channels named, advice line present", () => {
    expect(charityCareTile.harmTier).toBe(3);
    expect(charityCareTile.channels?.length).toBeGreaterThan(0);
    expect(checkHarmTier([charityCareTile as AuditTile])).toEqual([]);
  });

  it("is axe-clean", async () => {
    const root = mount(LOW);
    document.body.append(root);
    const results = await axe.run(root);
    document.body.removeChild(root);
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});
