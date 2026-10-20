import { describe, it, expect, beforeAll, afterEach } from "vitest";
import axe from "axe-core";
import { mountLotPicker } from "../../src/tiles/lotPicker";
import { mountBalanceTransfer } from "../../src/tiles/balanceTransfer";
import { mountPaycheckOptimizer } from "../../src/tiles/paycheckOptimizer";
import { mountW4Withholding } from "../../src/tiles/w4Withholding";
import { supplementalWithholding } from "../../src/engine/supplemental";
import { evaluateTaxes } from "../../src/engine/tax";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import type { TileContext } from "../../src/tiles/types";

/**
 * Phase 17 seventh wave: the cost-basis lot picker (Phase 5 §3.2), the balance-
 * transfer break-even (§6.2), and the paycheck optimizer (§6.4). All
 * deterministic, deep-linkable, axe-clean; the optimizer runs on the existing
 * tax engine, the other two are pure arithmetic.
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
function dollars(text: string | undefined): number {
  return Number((text ?? "").replace(/[^0-9.-]/g, ""));
}

afterEach(() => document.body.replaceChildren());

describe("Cost-Basis Lot Picker", () => {
  it("computes a FIFO long-term gain across two lots", () => {
    const { root } = mount(
      mountLotPicker,
      new URLSearchParams({
        px: "60",
        n: "150",
        k: "3",
        s0: "100",
        b0: "10",
        lt0: "1",
        s1: "100",
        b1: "20",
        lt1: "1",
        s2: "100",
        b2: "50",
        lt2: "0",
      }),
    );
    expect(rowValue(root, "Shares sold")).toBe("150");
    expect(rowValue(root, "Proceeds")).toContain("$9,000");
    expect(rowValue(root, "Long-term gain")).toContain("$7,000");
    expect(rowValue(root, "Total realized gain")).toContain("$7,000");
  });

  it("says so when the lots cannot cover the sale that was asked for", () => {
    // FIFO stops when the lots run out. Until then the card answered a
    // different transaction than the one typed, with an accurate share count
    // beside a headline gain for a smaller sale.
    const { root } = mount(
      mountLotPicker,
      new URLSearchParams({ px: "60", n: "150", k: "1", s0: "100", b0: "10", lt0: "1" }),
    );
    expect(rowValue(root, "Shares sold")).toBe("100");
    expect(rowValue(root, "Short of the sale you asked for")).toContain("100 of 150");
    // It says "everything below", so it has to be above what it qualifies.
    const labels = Array.from(root.querySelectorAll(".bd-label")).map((n) => n.textContent ?? "");
    expect(labels.indexOf("Short of the sale you asked for")).toBeLessThan(
      labels.indexOf("Total realized gain"),
    );
    expect(labels.indexOf("Short of the sale you asked for")).toBeLessThan(
      labels.findIndex((l) => l.startsWith("Proceeds")),
    );
    expect(dollars(rowValue(root, "Total realized gain"))).toBe(5000);
  });

  it("says nothing about a shortfall when the lots cover the sale", () => {
    const { root } = mount(
      mountLotPicker,
      new URLSearchParams({ px: "60", n: "100", k: "1", s0: "100", b0: "10", lt0: "1" }),
    );
    expect(rowValue(root, "Short of the sale you asked for")).toBeFalsy();
  });

  it("names the wash-sale rule when a lot sells below its basis", () => {
    // This tile's own "How this works" recommends specific identification
    // "often to harvest losses", and said nothing about §1091 — the rule that
    // most often makes a harvested loss not real. The Tax-Loss Harvesting tile
    // has named it since it was written; this is the tile where a person
    // actually picks which shares go.
    const { root } = mount(
      mountLotPicker,
      new URLSearchParams({
        px: "30",
        m: "specific",
        k: "1",
        s0: "100",
        b0: "50",
        lt0: "0",
        ss0: "100",
      }),
    );
    expect(dollars(rowValue(root, "Total realized gain"))).toBe(-2000);
    expect(rowValue(root, "Watch the wash-sale rule")).toContain("30 days");
    const hrefs = Array.from(root.querySelectorAll("a.cite-link")).map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs.some((h) => h?.includes("publications/p550"))).toBe(true);
  });

  it("names it per lot, not on the net — a sale can gain overall and still wash", () => {
    // §1091 disallows the loss on the replaced shares, so a net gain does not
    // mean there is nothing to warn about.
    const { root } = mount(
      mountLotPicker,
      new URLSearchParams({
        px: "60",
        m: "specific",
        k: "2",
        s0: "100",
        b0: "10",
        lt0: "1",
        ss0: "100",
        s1: "10",
        b1: "90",
        lt1: "0",
        ss1: "10",
      }),
    );
    expect(dollars(rowValue(root, "Total realized gain"))).toBeGreaterThan(0);
    expect(rowValue(root, "Watch the wash-sale rule")).toBeDefined();
  });

  it("stays quiet when every lot sells at a gain", () => {
    const { root } = mount(
      mountLotPicker,
      new URLSearchParams({
        px: "60",
        m: "specific",
        k: "1",
        s0: "100",
        b0: "50",
        lt0: "0",
        ss0: "100",
      }),
    );
    expect(rowValue(root, "Watch the wash-sale rule")).toBeUndefined();
  });

  it("uses per-lot quantities in specific-ID mode", () => {
    const { root } = mount(
      mountLotPicker,
      new URLSearchParams({
        px: "60",
        m: "specific",
        k: "1",
        s0: "100",
        b0: "50",
        lt0: "0",
        ss0: "50",
      }),
    );
    // 50 short-term shares at $60 with $50 basis → $500 short-term gain.
    expect(rowValue(root, "Short-term gain")).toContain("$500");
  });

  it("prefills a worked example and deep-links it", () => {
    const { root, lastParams } = mount(mountLotPicker, new URLSearchParams());
    clickExample(root);
    expect(root.querySelector<HTMLInputElement>('input[name="px"]')?.value).toBe("60");
    expect(lastParams()?.get("n")).toBe("150");
  });
});

describe("Balance Transfer Break-Even", () => {
  it("nets the saving after the fee", () => {
    const { root } = mount(
      mountBalanceTransfer,
      new URLSearchParams({
        bal: "6000",
        apr: "24",
        pay: "1000",
        fee: "3",
        intro: "0",
        im: "12",
        post: "18",
      }),
    );
    expect(rowValue(root, "Transfer fee")).toContain("$180");
    expect(rowValue(root, "Verdict")).toContain("saves $277.83");
  });

  it("prompts before a balance and payment are entered", () => {
    const { root } = mount(mountBalanceTransfer, new URLSearchParams({ bal: "0", pay: "0" }));
    expect(root.querySelector(".ph-empty")).not.toBeNull();
  });

  it("signposts an extreme transfer fee without clamping it (SPEC-3 §2.4)", () => {
    const base = { bal: "6000", apr: "24", pay: "1000" };
    const calm = mount(mountBalanceTransfer, new URLSearchParams({ ...base, fee: "3" }));
    expect(calm.root.querySelector(".assumption-hint")).toBeNull();
    const wild = mount(mountBalanceTransfer, new URLSearchParams({ ...base, fee: "30" }));
    expect(wild.root.querySelector(".assumption-hint")?.textContent).toContain("unusually high");
    expect(wild.root.querySelector(".result-card")).not.toBeNull();
  });
});

describe("Paycheck Optimizer", () => {
  it("shows take-home and the HSA's FICA edge over the 401(k)", () => {
    const { root } = mount(
      mountPaycheckOptimizer,
      new URLSearchParams({ fs: "single", st: "ca", w: "95000", k: "8000", hsa: "2000" }),
    );
    const k401 = dollars(rowValue(root, "Tax saved per $1,000 into your 401(k)"));
    const hsa = dollars(rowValue(root, "Tax saved per $1,000 into your HSA"));
    // The HSA also escapes FICA (~7.65%), so it saves strictly more per $1,000.
    expect(hsa).toBeGreaterThan(k401);
    expect(hsa - k401).toBeGreaterThan(70); // roughly the FICA on $1,000
    expect(root.querySelector("a.cite-link")).not.toBeNull();
  });

  it("reads filing status, state, and income from My Situation", () => {
    const profile = new SituationStore();
    profile.set("filingStatus", "married_jointly");
    profile.set("stateCode", "tx");
    profile.set("annualIncome", 120000);
    const { root } = mount(mountPaycheckOptimizer, new URLSearchParams(), profile);
    expect(root.querySelector<HTMLSelectElement>('select[name="fs"]')?.value).toBe(
      "married_jointly",
    );
    expect(root.querySelector<HTMLSelectElement>('select[name="st"]')?.value).toBe("tx");
    expect(root.querySelector<HTMLInputElement>('input[name="w"]')?.value).toBe("120000");
  });
});

describe("W-4 Withholding & Refund Check", () => {
  it("frames a large over-withholding as an interest-free loan and suggests withholding less", () => {
    // $600/paycheck × 26 ≈ $15,600 withheld, far above a single filer's tax on $70k.
    const { root } = mount(
      mountW4Withholding,
      new URLSearchParams({ fs: "single", w: "70000", pf: "26", wh: "600" }),
    );
    const text = root.textContent ?? "";
    expect(rowValue(root, "Projected refund")).toBeDefined();
    expect(text).toContain("interest-free loan to the government");
    expect(text).toContain("Reduce withholding by about");
    // The projected federal income tax line carries its source.
    expect(root.querySelector("a.cite-link")).not.toBeNull();
  });

  it("flags under-withholding and suggests withholding more", () => {
    // $100/paycheck × 26 = $2,600 withheld, well below the tax on $70k.
    const { root } = mount(
      mountW4Withholding,
      new URLSearchParams({ fs: "single", w: "70000", pf: "26", wh: "100" }),
    );
    const text = root.textContent ?? "";
    expect(rowValue(root, "Projected balance due")).toBeDefined();
    expect(text).toContain("under-withholding");
    expect(text).toContain("Withhold about");
  });

  /**
   * Extra pay (SPEC-5 layoff-month J4): severance or a bonus withheld at
   * Pub. 15's flat rate, set beside what it actually adds to the tax.
   */
  const addsToTax = (wages: number, extra: number): number => {
    const tax = (w: number) =>
      evaluateTaxes(
        { filingStatus: "single", wages: w },
        { federal: data.federal()!, fica: data.fica()! },
      ).federal.incomeTax.toNumber();
    return Math.round((tax(wages + extra) - tax(wages)) * 100) / 100;
  };

  it("withholds 22% of a year's extra pay, and 37% of what passes $1 million", async () => {
    await data.loadDeferred("supplemental-withholding-2026");
    const rules = data.supplementalWithholding()!;
    expect(rules.flatRate).toBe(0.22);
    expect(supplementalWithholding(20000, rules).toNumber()).toBe(4400);
    // $220,000 on the first million and $74,000 on the $200,000 above it.
    expect(supplementalWithholding(1200000, rules).toNumber()).toBe(294000);
  });

  it("shows 22% under-withholding a bonus at a high marginal rate", async () => {
    await data.loadDeferred("supplemental-withholding-2026");
    const { root } = mount(
      mountW4Withholding,
      new URLSearchParams({ fs: "single", w: "260000", pf: "26", wh: "2400", xp: "20000" }),
    );
    expect(dollars(rowValue(root, "Withheld from the extra pay at the flat rate (22.0%)"))).toBe(
      4400,
    );
    const adds = addsToTax(260000, 20000);
    expect(adds).toBeGreaterThan(4400);
    expect(dollars(rowValue(root, "What the extra pay adds to your tax"))).toBe(adds);
    expect(root.querySelectorAll("a.cite-link").length).toBeGreaterThanOrEqual(2);
  });

  it("shows 22% over-withholding severance at a low one", async () => {
    await data.loadDeferred("supplemental-withholding-2026");
    const { root } = mount(
      mountW4Withholding,
      new URLSearchParams({ fs: "single", w: "20000", pf: "26", wh: "40", xp: "5000" }),
    );
    const adds = addsToTax(20000, 5000);
    expect(adds).toBeLessThan(1100);
    expect(dollars(rowValue(root, "What the extra pay adds to your tax"))).toBe(adds);
  });

  it("waits for the extra-pay rules, and gives no figure if they cannot load", async () => {
    const root = document.createElement("div");
    mountW4Withholding({
      root,
      params: new URLSearchParams({ fs: "single", w: "60000", pf: "26", wh: "300", xp: "8000" }),
      setParams: () => {},
      permalink: () => "",
      navigate: () => {},
      locale: "en-US",
      data: {
        ...data,
        supplementalWithholding: () => null,
        loadDeferred: async () => ({ status: "invalid" }) as never,
      } as BundledData,
      profile: new SituationStore(),
    });
    expect(root.textContent).toContain("Loading the withholding rules for extra pay");
    await new Promise((r) => setTimeout(r, 0));
    expect(root.querySelector(".verify-banner")).not.toBeNull();
    expect(root.textContent).not.toMatch(/\$\d/);
  });

  it("reads filing status and income from My Situation", () => {
    const profile = new SituationStore();
    profile.set("filingStatus", "head_of_household");
    profile.set("annualIncome", 88000);
    const { root } = mount(mountW4Withholding, new URLSearchParams(), profile);
    expect(root.querySelector<HTMLSelectElement>('select[name="fs"]')?.value).toBe(
      "head_of_household",
    );
    expect(root.querySelector<HTMLInputElement>('input[name="w"]')?.value).toBe("88000");
  });
});

describe("seventh-wave tiles accessibility", () => {
  for (const tc of [
    {
      name: "cost-basis",
      mount: mountLotPicker,
      params: new URLSearchParams({ px: "60", n: "150", k: "1", s0: "100", b0: "10", lt0: "1" }),
    },
    {
      name: "balance-transfer",
      mount: mountBalanceTransfer,
      params: new URLSearchParams({ bal: "6000", apr: "24", pay: "1000" }),
    },
    {
      name: "paycheck-optimizer",
      mount: mountPaycheckOptimizer,
      params: new URLSearchParams({ fs: "single", st: "ca", w: "95000", k: "8000", hsa: "2000" }),
    },
    {
      name: "w4-withholding",
      mount: mountW4Withholding,
      params: new URLSearchParams({ fs: "single", w: "70000", pf: "26", wh: "600" }),
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
