import { describe, it, expect, beforeAll } from "vitest";
import { mountTakeHome } from "../../src/tiles/takeHome";
import { mountFederalIncomeTax } from "../../src/tiles/federalIncomeTax";
import { mountEducationCredits } from "../../src/tiles/educationCredits";
import { mountQuarterlyTaxes } from "../../src/tiles/quarterlyTaxes";
import { mountPaycheckOptimizer } from "../../src/tiles/paycheckOptimizer";
import { mountMedicaid } from "../../src/tiles/medicaid";
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
    expect(applyToSituation(profile, fields).applied).toBeGreaterThan(0);
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

/**
 * `stateCode` is the one shared enum with a meaningful empty value: every state
 * dropdown on the site offers "Federal and FICA only (no state)", and `""` is
 * what that choice is. `rememberShared` tested it for truthiness, so the choice
 * was the only answer on the site a reader could not give — once any state had
 * been remembered, deselecting it changed the tile in front of them and nothing
 * else. The next tile, My Situation, My Plan and the Report all went on
 * charging the state they had just turned off.
 *
 * Both call shapes are pinned, because the two that wrote `fields.state ||
 * undefined` were suppressing the same value a second time, one layer up.
 */
describe("a reader who deselects their state", () => {
  it("clears it from the profile, from a tile that passes the select through", () => {
    const profile = new SituationStore();
    const root = mount(mountTakeHome, new URLSearchParams({ st: "md" }), profile);
    const st = root.querySelector<HTMLSelectElement>('select[name="st"]')!;
    st.dispatchEvent(new Event("change"));
    expect(profile.get("stateCode")).toBe("md");

    st.value = "";
    st.dispatchEvent(new Event("change"));
    expect(profile.get("stateCode")).toBe("");
  });

  it("clears it from a tile that used to convert the blank to undefined", () => {
    for (const mountFn of [mountQuarterlyTaxes, mountPaycheckOptimizer]) {
      const profile = new SituationStore();
      const root = mount(mountFn, new URLSearchParams({ st: "md" }), profile);
      const st = root.querySelector<HTMLSelectElement>('select[name="st"]')!;
      st.value = "md";
      st.dispatchEvent(new Event("change"));
      expect(profile.get("stateCode")).toBe("md");

      st.value = "";
      st.dispatchEvent(new Event("change"));
      expect(profile.get("stateCode")).toBe("");
    }
  });

  it("carries the empty state to the next tile rather than a stale one", () => {
    const profile = new SituationStore();
    const root = mount(mountTakeHome, new URLSearchParams({ st: "md" }), profile);
    const st = root.querySelector<HTMLSelectElement>('select[name="st"]')!;
    st.value = "";
    st.dispatchEvent(new Event("change"));

    const next = mount(mountTakeHome, new URLSearchParams(), profile);
    expect(next.querySelector<HTMLSelectElement>('select[name="st"]')?.value).toBe("");
  });
});

/**
 * The Medicaid tile took household size and income from My Situation from the
 * day it was built and did not take the state, which is the field its answer
 * turns on — whether the reader's state expanded Medicaid at all. Somebody who
 * had told the site where they live five tiles ago opened this one and was
 * shown California. It renders codes upper and My Situation stores them lower,
 * so the two ends have to meet case-insensitively, in both directions.
 */
describe("the tile whose answer turns on the state", () => {
  it("opens on the state the reader already gave, whatever its case", () => {
    const profile = new SituationStore();
    profile.set("stateCode", "tx");
    const root = mount(mountMedicaid, new URLSearchParams(), profile);
    expect(root.querySelector<HTMLSelectElement>("select")?.value).toBe("TX");
  });

  it("still lets a link win", () => {
    const profile = new SituationStore();
    profile.set("stateCode", "tx");
    const root = mount(mountMedicaid, new URLSearchParams({ st: "oh" }), profile);
    expect(root.querySelector<HTMLSelectElement>("select")?.value).toBe("OH");
  });

  it("hands the state it was given back in the case the profile stores", () => {
    const profile = new SituationStore();
    profile.set("stateCode", "tx");
    const root = mount(mountMedicaid, new URLSearchParams(), profile);
    const st = root.querySelector<HTMLSelectElement>("select")!;
    st.value = "OH";
    st.dispatchEvent(new Event("change"));
    expect(profile.get("stateCode")).toBe("oh");
  });
});
