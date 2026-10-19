import { describe, it, expect, beforeAll } from "vitest";
import axe from "axe-core";
import { earlyDistributionCost, incomeTaxOnDistribution } from "../../src/engine/earlyDistribution";
import { Money } from "../../src/engine/money";
import { retirementCashOutTile } from "../../src/tiles/retirementCashOut";
import { mountRetirementCashOut } from "../../src/tiles/retirementCashOutView";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import { checkHarmTier, type AuditTile } from "../../scripts/audit-release";
import type { EarlyDistributionData } from "../../src/data/schemas";
import type { TileContext } from "../../src/tiles/types";

/**
 * Cashing Out a 401(k) (SPEC-5 Phase 28, layoff-month J1).
 *
 * The federal figures are worked by hand from the 2026 single schedule the
 * federal shard carries: a $16,100 standard deduction, 12% to $50,400 and 22%
 * above. $60,000 of wages is $43,900 taxable; $20,000 more is $63,900, so the
 * distribution adds $6,500 at 12% and $13,500 at 22%: $3,750.
 */
let data: BundledData;
let rules: EarlyDistributionData;
beforeAll(async () => {
  data = await loadBundledData();
  await data.loadDeferred("early-distribution-2026");
  rules = data.earlyDistribution()!;
});

const base = {
  amount: 20000,
  age: 40,
  separatedAtSeparationAge: false,
  publicSafetySeparation: false,
  wholeException: false,
  emergency: false,
  otherExcepted: 0,
  federalTax: Money.from(3750),
  stateTax: Money.zero(),
};

describe("IRC §72(t) and §3405(c)", () => {
  it("reads its rates and ages from the cited shard", () => {
    expect(rules.additionalTaxRate).toBe(0.1);
    expect(rules.mandatoryWithholdingRate).toBe(0.2);
    expect(rules.penaltyFreeAge).toBe(59.5);
    expect(rules.separationAge).toBe(55);
    expect(rules.emergencyExpenseLimit).toBe(1000);
  });

  it("stacks the distribution on the year's income through the tax engine", () => {
    const tax = incomeTaxOnDistribution(
      20000,
      { filingStatus: "single", wages: 60000 },
      { federal: data.federal()!, fica: data.fica()! },
    );
    expect(tax.federal.toNumber()).toBe(3750);
    expect(tax.state.toNumber()).toBe(0);
  });

  it("at 40, owes more at filing than the 20% withheld", () => {
    const r = earlyDistributionCost(base, rules);
    expect(r.withheld.toNumber()).toBe(4000);
    expect(r.check.toNumber()).toBe(16000);
    expect(r.additionalTax.toNumber()).toBe(2000);
    expect(r.totalCost.toNumber()).toBe(5750);
    expect(r.federalDueAtFiling.toNumber()).toBe(1750);
    expect(r.kept.toNumber()).toBe(14250);
  });

  it("at 56, separated this year, owes no additional tax", () => {
    const r = earlyDistributionCost({ ...base, age: 56, separatedAtSeparationAge: true }, rules);
    expect(r.additionalTax.toNumber()).toBe(0);
    expect(r.noAdditionalTaxBecause).toBe("separation");
    // $3,750 of tax against $4,000 withheld: a $250 refund.
    expect(r.federalDueAtFiling.toNumber()).toBe(-250);
  });

  it("excepts $1,000 for the emergency distribution, and no more", () => {
    const r = earlyDistributionCost({ ...base, emergency: true }, rules);
    expect(r.excepted.toNumber()).toBe(1000);
    expect(r.additionalTax.toNumber()).toBe(1900);
  });

  it("owes no additional tax from 59½, and whole for a whole exception", () => {
    expect(earlyDistributionCost({ ...base, age: 59.5 }, rules).additionalTax.toNumber()).toBe(0);
    expect(earlyDistributionCost({ ...base, age: 59.4 }, rules).additionalTax.toNumber()).toBe(
      2000,
    );
    expect(
      earlyDistributionCost({ ...base, wholeException: true }, rules).noAdditionalTaxBecause,
    ).toBe("exception");
    expect(
      earlyDistributionCost({ ...base, otherExcepted: 50000 }, rules).additionalTax.toNumber(),
    ).toBe(0);
  });
});

function mount(params: URLSearchParams, bundled: BundledData | null = data): HTMLElement {
  const root = document.createElement("div");
  mountRetirementCashOut({
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

const AT_40 = new URLSearchParams({
  amt: "20000",
  age: "40",
  fs: "single",
  st: "TX",
  oth: "60000",
});

describe("Cashing Out a 401(k)", () => {
  it("shows the check, the tax, the additional tax and the bill, each cited", () => {
    const root = mount(AT_40);
    const text = root.textContent ?? "";
    expect(text).toContain("$16,000.00");
    expect(text).toContain("$3,750.00");
    expect(text).toContain("$2,000.00");
    expect(text).toContain("Federal balance due at filing, after the withholding");
    expect(text).toContain("$1,750.00");
    const sources = [...root.querySelectorAll("a.cite-link")].map((a) => a.getAttribute("href"));
    expect(sources).toContain(rules.citation.sourceUrl);
    expect(sources).toContain(data.federal()!.citation.sourceUrl);
  });

  it("renders the 60-day rollover clock from the date received, with its section", () => {
    const root = mount(new URLSearchParams({ ...Object.fromEntries(AT_40), rec: "2026-10-01" }));
    const deadline = root.querySelector("[data-deadline]");
    expect(deadline?.textContent).toContain("Roll over a distribution you were paid");
    expect(deadline?.querySelector("a.cite-link")?.getAttribute("href")).toContain("/26/402");
  });

  it("flags a growth rate outside the usual band, without clamping it", () => {
    const text =
      mount(new URLSearchParams({ ...Object.fromEntries(AT_40), rr: "40" })).textContent ?? "";
    expect(text).toContain("unusually high");
  });

  it("degrades to a banner, never a figure, when the rules are missing", () => {
    const root = mount(AT_40, null);
    expect(root.querySelector(".verify-banner")).not.toBeNull();
    expect(root.textContent).not.toMatch(/\$\d/);
  });

  it("declares harm tier 2 with the advice line, and clears the gate", () => {
    expect(retirementCashOutTile.harmTier).toBe(2);
    expect(checkHarmTier([retirementCashOutTile as AuditTile])).toEqual([]);
  });

  it("is what the job-loss sequence's retirement step opens", () => {
    const seq = data.lifeEvents()!.sequences.find((s) => s.id === "job-loss")!;
    expect(seq.steps.find((s) => s.id === "retirement-account")?.tileId).toBe(
      "retirement-cash-out",
    );
  });

  it("has no axe violations", async () => {
    const root = mount(AT_40);
    document.body.append(root);
    const results = await axe.run(root, { rules: { "color-contrast": { enabled: false } } });
    root.remove();
    expect(results.violations).toEqual([]);
  });
});
