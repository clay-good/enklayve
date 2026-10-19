import { describe, it, expect, beforeAll } from "vitest";
import axe from "axe-core";
import { mountUiEstimator, uiEstimatorTile } from "../../src/tiles/uiEstimator";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import { checkHarmTier, type AuditTile } from "../../scripts/audit-release";
import type { TileContext } from "../../src/tiles/types";

/**
 * Unemployment Benefit Estimate (SPEC-4-safety-net §B5), harm tier 1.
 *
 * The gate the spec sets is the thing under test: a state with a bundled rule
 * set gets its own arithmetic, cited; any other state gets no dollar figure at
 * all, because a "typical state" estimate is worse than nothing.
 */
let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

function mount(
  params: URLSearchParams,
  profile = new SituationStore(),
  bundled: BundledData | null = data,
): { root: HTMLElement; written: URLSearchParams[] } {
  const root = document.createElement("div");
  const written: URLSearchParams[] = [];
  mountUiEstimator({
    root,
    params,
    setParams: (p: URLSearchParams) => written.push(p),
    permalink: (p) => `https://enklayve.com/#/x?${(p ?? params).toString()}`,
    navigate: () => {},
    locale: "en-US",
    data: bundled,
    profile,
  } as TileContext);
  return { root, written };
}

const TX = new URLSearchParams({ st: "TX", q1: "12000", q2: "10000", q3: "8000", q4: "6000" });

describe("Unemployment Benefit Estimate", () => {
  it("estimates a bundled state with its own arithmetic, cited", () => {
    const { root } = mount(TX);
    const text = root.textContent ?? "";
    // $12,000 / 25 = $480; 27% of $36,000 = $9,720 < 26 × 480.
    expect(text).toContain("About $480 a week, up to $9,720 in total.");
    expect(text).toContain("divided by 25");
    expect(text).toContain("27% of $36,000");
    expect(root.querySelectorAll("a.cite-link").length).toBeGreaterThan(0);
    // What the estimate leaves out, from the shard, under the figure.
    expect(text).toContain("What this leaves out for Texas");
  });

  it("gives a state with no rule set no figure at all, and says which states it covers", () => {
    const { root } = mount(new URLSearchParams({ st: "NC", q1: "12000", q2: "10000" }));
    const text = root.textContent ?? "";
    expect(text).toContain("No estimate for North Carolina yet");
    expect(text).toContain(
      "California, Texas, Florida, New York, Pennsylvania, Illinois, Ohio, Michigan",
    );
    expect(text).not.toMatch(/\$\d/);
    expect(root.querySelector(".uie-office a")?.getAttribute("href")).toContain("careeronestop");
  });

  it("says what is short when the wage test is not met, without a figure", () => {
    const { root } = mount(
      new URLSearchParams({ st: "FL", q1: "5000", q2: "2000", q3: "0", q4: "0" }),
    );
    const text = root.textContent ?? "";
    expect(text).toContain("do not meet Florida's wage test");
    expect(text).toContain("1.5 times the high quarter");
    expect(text).not.toContain("a week, up to");
  });

  it("starts from the state My Situation holds", () => {
    const profile = new SituationStore();
    profile.set("stateCode", "ca");
    const { root } = mount(
      new URLSearchParams({ q1: "10000", q2: "9000", q3: "8000", q4: "7000" }),
      profile,
    );
    expect(root.textContent).toContain("About $385 a week");
  });

  it("writes every input to the link, so the link reproduces the answer", () => {
    const { root, written } = mount(TX);
    const input = root.querySelector<HTMLInputElement>(
      'input[aria-label="Wages paid in base-period quarter 1"]',
    )!;
    input.value = "13000";
    input.dispatchEvent(new Event("input"));
    const p = written.at(-1)!;
    expect(p.get("st")).toBe("TX");
    expect([p.get("q1"), p.get("q2"), p.get("q3"), p.get("q4")]).toEqual([
      "13000",
      "10000",
      "8000",
      "6000",
    ]);
    expect(mount(p).root.textContent).toContain("About $520 a week");
  });

  it("asks Pennsylvania for credit weeks and dependents, and no other state", () => {
    const pa = mount(
      new URLSearchParams({ st: "PA", q1: "7500", q2: "2000", q3: "1500", q4: "924" }),
    );
    const credit = pa.root.querySelector<HTMLInputElement>(
      'input[aria-label="Weeks that count in the base period"]',
    )!;
    expect(credit.closest<HTMLElement>(".uie-credit")!.hidden).toBe(false);
    // Uncounted credit weeks are a prompt, never an assumed 26.
    expect(pa.root.textContent).toContain("fewer than 18 weeks that count");
    const tx = mount(TX);
    const txCredit = tx.root.querySelector<HTMLInputElement>(
      'input[aria-label="Weeks that count in the base period"]',
    )!;
    expect(txCredit.closest<HTMLElement>(".uie-credit")!.hidden).toBe(true);
  });

  it("states Pennsylvania's payment reduction in the figure, and adds dependents", () => {
    const { root, written } = mount(
      new URLSearchParams({ st: "PA", q1: "7500", q2: "2000", q3: "1500", q4: "924", cw: "26" }),
    );
    // A $295 rate less 3.2% pays $285 (L&I's own example row).
    expect(root.textContent).toContain(
      "About $285 a week after Pennsylvania's 3.2% payment reduction, on a $295 rate",
    );
    const deps = root.querySelector<HTMLInputElement>(
      'input[aria-label="Dependents you support"]',
    )!;
    deps.value = "2";
    deps.dispatchEvent(new Event("input"));
    expect(root.textContent).toContain("That includes $8 a week for dependents.");
    expect(written.at(-1)!.get("dep")).toBe("2");
    expect(written.at(-1)!.get("cw")).toBe("26");
  });

  it("says what Ohio is short of without inventing a table it does not have", () => {
    const { root } = mount(new URLSearchParams({ st: "OH", q1: "5000", q2: "5000", cw: "0" }));
    const text = root.textContent ?? "";
    expect(text).toContain("fewer than 20 weeks that count");
    expect(text).not.toContain("benefit table");
    expect(text).toContain("A qualifying week is any week");
  });

  it("names New York's two-quarter average when it is the rule that applied", () => {
    const { root } = mount(
      new URLSearchParams({ st: "NY", q1: "4500", q2: "4288", q3: "0", q4: "0" }),
    );
    expect(root.textContent).toContain("About $169 a week");
    expect(root.textContent).toContain("average of your two highest quarters");
  });

  it("degrades to a banner, never a number, when the data is missing", () => {
    const { root } = mount(TX, new SituationStore(), null);
    expect(root.querySelector(".verify-banner")).not.toBeNull();
    expect(root.textContent).not.toMatch(/\$\d/);
  });

  it("clears the Pillar 4 gate at tier 1", () => {
    expect(uiEstimatorTile.harmTier).toBe(1);
    expect(checkHarmTier([uiEstimatorTile as AuditTile])).toEqual([]);
    expect(uiEstimatorTile.how).toMatch(/not a benefits-eligibility determination/);
  });

  it("has no axe violations", async () => {
    const { root } = mount(TX);
    document.body.append(root);
    const results = await axe.run(root, { rules: { "color-contrast": { enabled: false } } });
    root.remove();
    expect(results.violations).toEqual([]);
  });
});
