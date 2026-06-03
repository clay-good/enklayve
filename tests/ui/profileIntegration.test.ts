import { describe, it, expect, beforeAll } from "vitest";
import { mountTakeHome } from "../../src/tiles/takeHome";
import { mountFederalIncomeTax } from "../../src/tiles/federalIncomeTax";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import type { TileContext } from "../../src/tiles/types";

let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

function mount(
  mountFn: (ctx: TileContext) => void,
  params: URLSearchParams,
  profile: SituationStore,
): HTMLElement {
  const root = document.createElement("div");
  mountFn({
    root,
    params,
    setParams: () => {},
    permalink: () => "https://enklayve.com/#/x",
    navigate: () => {},
    locale: "en-US",
    data,
    profile,
  });
  return root;
}

describe("Your Situation continuity", () => {
  it("a value entered in one tile pre-fills another within the session", () => {
    const profile = new SituationStore();

    // Enter wages in the take-home tile (writes back to the profile).
    const takeHome = mount(mountTakeHome, new URLSearchParams({ st: "ca" }), profile);
    const wages = takeHome.querySelector<HTMLInputElement>('input[name="w"]')!;
    wages.value = "90000";
    wages.dispatchEvent(new Event("input"));
    expect(profile.get("annualIncome")).toBe(90000);

    // Open the Federal Income Tax tile with no URL state — it reads the profile.
    const fed = mount(mountFederalIncomeTax, new URLSearchParams(), profile);
    expect(fed.querySelector<HTMLInputElement>('input[name="inc"]')?.value).toBe("90000");
  });

  it("a deep link still overrides the profile (URL wins)", () => {
    const profile = new SituationStore();
    profile.set("annualIncome", 90000);
    const fed = mount(mountFederalIncomeTax, new URLSearchParams({ inc: "250000" }), profile);
    expect(fed.querySelector<HTMLInputElement>('input[name="inc"]')?.value).toBe("250000");
  });
});
