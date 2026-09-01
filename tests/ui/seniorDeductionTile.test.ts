import { describe, it, expect, beforeAll } from "vitest";
import { mountFederalIncomeTax } from "../../src/tiles/federalIncomeTax";
import { mountTakeHome } from "../../src/tiles/takeHome";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import type { TileContext } from "../../src/tiles/types";

let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

function mount(fn: (c: TileContext) => void, params: URLSearchParams): HTMLElement {
  const root = document.createElement("div");
  fn({
    root,
    params,
    profile: new SituationStore(),
    data,
    locale: "en-US",
    setParams: () => {},
    permalink: () => "#/x",
  } as unknown as TileContext);
  return root;
}

describe("the deduction at 65 reaches the page", () => {
  it("shows its own line and lowers the tax", () => {
    const without = mount(
      mountFederalIncomeTax,
      new URLSearchParams({ fs: "single", inc: "60000" }),
    );
    const with65 = mount(
      mountFederalIncomeTax,
      new URLSearchParams({ fs: "single", inc: "60000", age65: "1" }),
    );
    expect(without.textContent).not.toContain("Deduction at 65");
    expect(with65.textContent).toContain("Deduction at 65");
    expect(with65.textContent).toContain("$6,000");
  });

  it("computes from a deep-linked count on a joint return", () => {
    // Whether the SELECT shows "2" is a question for a real browser: happy-dom
    // mis-reports `<select>.value` when options are built with `selected` set
    // before insertion, which e2e/app.spec.ts already says in as many words. So
    // this asserts the arithmetic, and the e2e asserts the control.
    const root = mount(
      mountFederalIncomeTax,
      new URLSearchParams({ fs: "married_jointly", inc: "100000", age65: "2" }),
    );
    expect(root.textContent).toContain("$12,000");
  });

  it("clamps a hostile deep link rather than trusting it", () => {
    const root = mount(
      mountFederalIncomeTax,
      new URLSearchParams({ fs: "married_jointly", inc: "100000", age65: "99" }),
    );
    // Two is the most anyone can be, so 99 is 2 and not 99 × $6,000.
    expect(root.textContent).toContain("$12,000");
  });

  it("take-home has the control too", () => {
    const root = mount(mountTakeHome, new URLSearchParams({ w: "60000", st: "", age65: "1" }));
    expect(root.querySelector('select[name="age65"]')).not.toBeNull();
  });
});
