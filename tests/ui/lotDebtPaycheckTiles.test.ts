import { describe, it, expect, beforeAll, afterEach } from "vitest";
import axe from "axe-core";
import { mountLotPicker } from "../../src/tiles/lotPicker";
import { mountBalanceTransfer } from "../../src/tiles/balanceTransfer";
import { mountPaycheckOptimizer } from "../../src/tiles/paycheckOptimizer";
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
  ]) {
    it(`${tc.name} has no axe violations`, async () => {
      const { root } = mount(tc.mount, tc.params);
      document.body.append(root);
      const results = await axe.run(root, { rules: { "color-contrast": { enabled: false } } });
      expect(results.violations.map((v) => v.id).join(", ")).toBe("");
    }, 30000);
  }
});
