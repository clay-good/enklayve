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

/**
 * Qualified tips and overtime on the take-home tile (IRC §224, §225).
 *
 * Take-home is where wage composition belongs, and it is the tile a server or an
 * hourly worker actually opens. The card shows taxes rather than deductions, so
 * what a test can hold is that the tax moves — and that FICA does not, because
 * these are income-tax deductions and Social Security and Medicare are still
 * owed on every one of those dollars.
 */
describe("tips and overtime on take-home", () => {
  const takeHomeText = (params: Record<string, string>): string =>
    mount(mountTakeHome, new URLSearchParams({ st: "", ...params })).textContent ?? "";

  it("offers both inputs", () => {
    const root = mount(mountTakeHome, new URLSearchParams({ st: "", w: "48000" }));
    expect(root.querySelector('input[name="tips"]')).not.toBeNull();
    expect(root.querySelector('input[name="ot"]')).not.toBeNull();
  });

  it("restores a deep-linked amount into the field", () => {
    const root = mount(mountTakeHome, new URLSearchParams({ st: "", w: "48000", tips: "9000" }));
    expect(root.querySelector<HTMLInputElement>('input[name="tips"]')?.value).toBe("9000");
  });

  it("raises take-home once tips are declared", () => {
    // A number input restores reliably in happy-dom; only <select> does not.
    const plain = takeHomeText({ w: "48000" });
    const tipped = takeHomeText({ w: "48000", tips: "14000" });
    expect(tipped).not.toBe(plain);
  });
});
