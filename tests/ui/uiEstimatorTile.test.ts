import { describe, it, expect, beforeAll, vi } from "vitest";
import axe from "axe-core";
import { mountUiEstimator, uiEstimatorTile } from "../../src/tiles/uiEstimator";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { evaluateTaxes } from "../../src/engine/tax";
import { renderUiNet } from "../../src/tiles/uiNetView";
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
  // Loaded up front so these tests read the figure synchronously; the
  // on-demand path itself is tested below with data that has not loaded yet.
  await Promise.all(data.stateUiCodes().map((code) => data.loadStateUi(code)));
});

/** The bundle as a first visit sees it: no state's rules loaded yet. */
function unloaded(load: BundledData["loadStateUi"] = (c) => data.loadStateUi(c)): BundledData {
  return { ...data, loadedStateUi: () => undefined, loadStateUi: load } as BundledData;
}

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
      "California, Texas, Florida, New York, Pennsylvania, Illinois, Ohio, Michigan, New Jersey, Virginia, Washington, Arizona, Massachusetts",
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

  it("names Alabama's rounding, and its floor as no claim rather than $45", () => {
    const paid = mount(new URLSearchParams({ st: "AL", q1: "1183", q2: "1183", q3: "600" }));
    expect(paid.root.textContent).toContain("rounded to the nearest dollar, an even 50 cents down");
    expect(paid.root.textContent).toContain("About $45 a week");
    const none = mount(new URLSearchParams({ st: "AL", q1: "1157", q2: "1157", q3: "600" }));
    expect(none.root.textContent).toContain("a weekly benefit under the $45 minimum");
    expect(none.root.textContent).not.toContain("a week, up to");
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

  it("asks Washington for hours, and no other state", () => {
    const wa = mount(new URLSearchParams({ st: "WA", q1: "20000", q2: "20000", q3: "0", q4: "0" }));
    const hours = wa.root.querySelector<HTMLInputElement>(
      'input[aria-label="Hours worked in the base period"]',
    )!;
    expect(hours.closest<HTMLElement>("label, .field, div")!.hidden).toBe(false);
    expect(wa.root.textContent).toContain("fewer than 680 hours worked");
    hours.value = "2080";
    hours.dispatchEvent(new Event("input"));
    expect(wa.root.textContent).toContain("About $770 a week");
    expect(wa.root.textContent).toContain("average quarterly wage");
    expect(wa.written.at(-1)!.get("hrs")).toBe("2080");
    const tx = mount(TX);
    const txHours = tx.root.querySelector<HTMLInputElement>(
      'input[aria-label="Hours worked in the base period"]',
    )!;
    expect(txHours.closest<HTMLElement>("label, .field, div")!.hidden).toBe(true);
  });

  it("tells a New Jersey claimant on the $15,500 alternative they may qualify, without a figure", () => {
    const { root } = mount(
      new URLSearchParams({ st: "NJ", q1: "8000", q2: "8000", q3: "0", q4: "0", cw: "19" }),
    );
    const text = root.textContent ?? "";
    expect(text).toContain("may qualify under New Jersey's alternative wage test");
    expect(text).not.toContain("do not meet");
    expect(text).not.toContain("a week, up to");
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

  it("loads a state's rules when it is asked for, and says so while it does", async () => {
    const { root } = mount(TX, new SituationStore(), unloaded());
    const result = root.querySelector(".tile-result")!;
    expect(result.getAttribute("aria-busy")).toBe("true");
    expect(root.textContent).toContain("Loading Texas's rules");
    await vi.waitFor(() => expect(result.getAttribute("aria-busy")).toBeNull());
    expect(root.textContent).toContain("About $480 a week, up to $9,720 in total.");
  });

  it("drops a slow answer for a state the reader has already moved off", async () => {
    const pending = new Map<string, (v: Awaited<ReturnType<BundledData["loadStateUi"]>>) => void>();
    const { root } = mount(
      TX,
      new SituationStore(),
      unloaded((code) => new Promise((resolve) => pending.set(code, resolve))),
    );
    const select = root.querySelector("select")!;
    select.value = "FL";
    select.dispatchEvent(new Event("change"));
    pending.get("FL")!(await data.loadStateUi("fl"));
    await vi.waitFor(() => expect(root.textContent).toContain("Florida"));
    pending.get("TX")!(await data.loadStateUi("tx"));
    await Promise.resolve();
    expect(root.textContent).not.toContain("What this leaves out for Texas");
    expect(root.textContent).toContain("What this leaves out for Florida");
  });

  it("reports an altered rule set as one, never as a state with no rules", async () => {
    const { root } = mount(
      TX,
      new SituationStore(),
      unloaded(async () => ({
        id: "state-ui-tx-2026",
        kind: "state-ui",
        version: "x",
        status: "invalid",
        effectiveYear: 2026,
        data: null,
        problems: ["content hash mismatch"],
      })),
    );
    await vi.waitFor(() => expect(root.querySelector(".verify-banner")).not.toBeNull());
    expect(root.textContent).toContain("did not pass their integrity check");
    expect(root.textContent).not.toContain("No estimate for Texas yet");
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

/**
 * What the check nets after tax (SPEC-5 layoff-month J3): federal from §85 and
 * §3402(p)(2), the state half from each state's own page.
 */
describe("what the unemployment check nets", () => {
  const net = async (st: string, other = 50000): Promise<string> => {
    await data.loadDeferred("ui-taxation-2026");
    const profile = new SituationStore();
    profile.set("annualIncome", other);
    const { root } = mount(
      new URLSearchParams({ st, q1: "12000", q2: "10000", q3: "8000", q4: "6000" }),
      profile,
    );
    await vi.waitFor(() => expect(root.querySelector(".uie-net")).not.toBeNull());
    return root.querySelector(".uie-net-box")?.textContent ?? "";
  };
  const federalOn = (benefits: number, other: number): string => {
    const tax = (o: number) =>
      evaluateTaxes(
        { filingStatus: "single", wages: other, otherIncome: o },
        { federal: data.federal()!, fica: data.fica()! },
      ).federal.incomeTax;
    return tax(benefits).subtract(tax(0)).format("en-US");
  };

  it("adds the claim to the year's income for the federal tax, and offers 10%", async () => {
    // Texas: $480 a week, $9,720 for the claim.
    const text = await net("TX");
    expect(text).toContain(
      "You can ask for 10% to be withheld, which leaves $432.00 of each $480.00",
    );
    expect(text).toContain(`the claim adds about ${federalOn(9720, 50000)} of federal income tax`);
    expect(text).toContain("If you elect no withholding, that is what you would owe in April");
    expect(text).toContain("Texas has no income tax");
  });

  it("names a state that taxes benefits, one that does not, and one that taxes part", async () => {
    expect(await net("IL")).toContain("Illinois taxes them too");
    expect(await net("CA")).toContain("California does not tax unemployment benefits");
    expect(await net("WI")).toContain("Wisconsin taxes part of them");
    expect(await net("CO")).toContain("Ask the agency whether it will withhold state tax");
  });

  it("gives no state figure for a state whose treatment has not been read", async () => {
    await data.loadDeferred("ui-taxation-2026");
    const rules = { ...data.uiTaxation()!, states: {} };
    const text = renderUiNet(
      {
        stateCode: "TX",
        stateName: "Texas",
        weekly: 480,
        yearBenefits: 9720,
        filingStatus: "single",
        otherIncome: 0,
        locale: "en-US",
      },
      rules,
      data,
    )
      .map((n) => n.textContent)
      .join(" ");
    expect(text).toContain("State treatment not yet read for Texas");
  });

  it("taxes the year a confirmed 1099-G reports (SPEC-5 §7.2)", async () => {
    await data.loadDeferred("ui-taxation-2026");
    const input = {
      stateCode: "TX",
      stateName: "Texas",
      weekly: 480,
      yearBenefits: 9720,
      filingStatus: "single" as const,
      otherIncome: 30000,
      locale: "en-US",
    };
    const without = renderUiNet(input, data.uiTaxation()!, data)
      .map((n) => n.textContent)
      .join(" ");
    expect(without).not.toContain("1099-G");
    const text = renderUiNet({ ...input, reportedBenefits: 8000 }, data.uiTaxation()!, data)
      .map((n) => n.textContent)
      .join(" ");
    // $8,000 on top of $30,000 of wages, single: all of it in the 12% band.
    const ctx = { federal: data.federal()!, fica: data.fica()! };
    const base = evaluateTaxes({ filingStatus: "single", wages: 30000 }, ctx);
    const withIt = evaluateTaxes({ filingStatus: "single", wages: 30000, otherIncome: 8000 }, ctx);
    const added = withIt.federal.incomeTax.subtract(base.federal.incomeTax).format("en-US");
    expect(text).toContain(`Your 1099-G reports $8,000.00 of benefits`);
    expect(text).toContain(`about ${added} of federal income tax`);
  });

  it("covers every state the estimator covers, each with its own citation", async () => {
    await data.loadDeferred("ui-taxation-2026");
    const states = data.uiTaxation()!.states;
    for (const code of data.stateUiCodes()) {
      expect(states[code], `${code} has no tax treatment`).toBeDefined();
      expect(states[code]!.citation.sourceUrl).toMatch(/^https:/);
    }
  });
});
