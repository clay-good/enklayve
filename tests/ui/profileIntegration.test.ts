import { describe, it, expect, beforeAll } from "vitest";
import { mountTakeHome } from "../../src/tiles/takeHome";
import { mountFederalIncomeTax } from "../../src/tiles/federalIncomeTax";
import { mountEducationCredits } from "../../src/tiles/educationCredits";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import { extractDocument } from "../../src/readout/extract";
import { applyToSituation } from "../../src/readout/toSituation";
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

describe("a W-2 read by the Readout reaches the tile that spends it", () => {
  it("carries box 12 TP and TT into Take-Home's tips and overtime fields", () => {
    // The whole point of the 2026 W-2 codes: an employer now reports the two
    // figures IRC §§224 and 225 deduct, so a server or an hourly worker who
    // drops their W-2 in should not then have to type them again from the same
    // piece of paper. applyToSituation writes them; the tile reads them.
    const profile = new SituationStore();
    const w2 =
      "Form W-2 Wage and Tax Statement 2026 Employer Diner Inc " +
      "1 Wages, tips, other compensation 48000.00 " +
      "2 Federal income tax withheld 3100.00 " +
      "12b TP 14000.00 12c TT 3200.00 " +
      "16 State wages 48000.00 17 State income tax 1400.00";
    const fields = extractDocument({ text: w2, pages: [w2], source: "typed" }).fields;
    expect(applyToSituation(profile, fields)).toBeGreaterThan(0);
    expect(profile.get("qualifiedTipsAnnual")).toBe(14000);
    expect(profile.get("qualifiedOvertimeAnnual")).toBe(3200);

    const takeHome = mount(mountTakeHome, new URLSearchParams({ st: "ca" }), profile);
    expect(takeHome.querySelector<HTMLInputElement>('input[name="tips"]')?.value).toBe("14000");
    expect(takeHome.querySelector<HTMLInputElement>('input[name="ot"]')?.value).toBe("3200");
  });

  it("lets the link win over the profile, like every other shared field", () => {
    const profile = new SituationStore();
    profile.set("qualifiedTipsAnnual", 14000, "extracted");
    const takeHome = mount(mountTakeHome, new URLSearchParams({ st: "ca", tips: "500" }), profile);
    expect(takeHome.querySelector<HTMLInputElement>('input[name="tips"]')?.value).toBe("500");
  });
});

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

describe("a two-value control writing a five-value field", () => {
  it("does not demote a head of household to single for typing a MAGI", () => {
    // Education Credits has one filing-status control, a "married filing
    // jointly" checkbox, and it wrote `married ? "married_jointly" : "single"`
    // straight into the shared profile on every keystroke. The field it
    // overwrote is read by Take-Home, the federal tax tile and the rest, where
    // head of household is a different schedule and a different standard
    // deduction — so a single parent who opened this tile to compare two
    // education credits left with a worse take-home figure everywhere else, for
    // a status they never changed. Unchecked means "not a joint return", which
    // head of household already satisfies.
    const profile = new SituationStore();
    profile.set("filingStatus", "head_of_household");
    const root = mount(mountEducationCredits, new URLSearchParams(), profile);
    const magi = root.querySelector<HTMLInputElement>('input[name="magi"]')!;
    magi.value = "70000";
    magi.dispatchEvent(new Event("input"));
    expect(profile.get("filingStatus")).toBe("head_of_household");
    expect(profile.get("annualIncome")).toBe(70000);
  });

  it("still records a joint return when the box is checked", () => {
    const profile = new SituationStore();
    profile.set("filingStatus", "head_of_household");
    const root = mount(mountEducationCredits, new URLSearchParams(), profile);
    const mfj = root.querySelector<HTMLInputElement>('input[name="mfj"]')!;
    mfj.checked = true;
    mfj.dispatchEvent(new Event("change"));
    expect(profile.get("filingStatus")).toBe("married_jointly");
  });

  it("narrows a stored joint return the box contradicts, since single is all it can mean", () => {
    const profile = new SituationStore();
    profile.set("filingStatus", "married_jointly");
    const root = mount(mountEducationCredits, new URLSearchParams(), profile);
    const mfj = root.querySelector<HTMLInputElement>('input[name="mfj"]')!;
    expect(mfj.checked, "the box defaults from the profile").toBe(true);
    mfj.checked = false;
    mfj.dispatchEvent(new Event("change"));
    expect(profile.get("filingStatus")).toBe("single");
  });
});
