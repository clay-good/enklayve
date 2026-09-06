import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { renderHome } from "../../src/ui/shell";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";

/**
 * The home budget is a writer of My Situation, and it is the only one that is
 * not a tile.
 *
 * `profileWrites.test.ts` pins every tile that writes a shared field to the
 * label of the control it came from, and it derives that roster from the tile
 * registry — which is why it never had anything to say about the front door.
 * The home budget asks for income, filing status, state and the mandatory
 * county, the same four every tax tile asks for, and shared none of them: a
 * reader who filled it in retyped their income in the first tool they opened,
 * and a reader arriving from Take-Home was met by a stranger's $5,000 a month.
 *
 * The two halves below are the halves that can go wrong. Reading is the easy
 * one. Writing is not: the widget opens on built-in defaults, so the rule is
 * that a control writes its own field and only its own field, and nothing is
 * written until a person moves something.
 */
let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

afterEach(() => {
  document.body.replaceChildren();
});

function mountHome(profile: SituationStore): HTMLElement {
  const root = document.createElement("main");
  renderHome(root, () => {}, data, profile);
  document.body.append(root);
  return root;
}

const input = (root: HTMLElement, label: string): HTMLInputElement =>
  root.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const select = (root: HTMLElement, label: string): HTMLSelectElement =>
  root.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;

function type(field: HTMLInputElement, value: number): void {
  field.value = String(value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

function choose(field: HTMLSelectElement, value: string): void {
  field.value = value;
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("the home budget and My Situation", () => {
  it("opens on what the reader already told another surface", () => {
    const profile = new SituationStore();
    profile.set("annualIncome", 85_000);
    profile.set("filingStatus", "married_jointly");
    profile.set("stateCode", "md");
    profile.set("county", "md-montgomery");
    const root = mountHome(profile);

    // The box is per-period and the profile field is annual, so the monthly
    // restatement is what a person should see.
    expect(input(root, "Income").value).toBe(String(Math.round(85_000 / 12)));
    expect(select(root, "Filing status").value).toBe("married_jointly");
    expect(select(root, "State").value).toBe("md");
    expect(
      [...root.querySelectorAll<HTMLSelectElement>("select")].some(
        (s) => s.value === "md-montgomery",
      ),
      "the county the reader gave elsewhere is not selected",
    ).toBe(true);
  });

  it("writes nothing at all until somebody moves something", () => {
    const profile = new SituationStore();
    mountHome(profile);
    expect(profile.entries()).toEqual([]);
  });

  it("each control writes its own field and no other", () => {
    const profile = new SituationStore();
    const root = mountHome(profile);

    // A living-expense row is not a statement about income, status or state.
    type(input(root, "Housing"), 2_000);
    expect(profile.get("totalMonthlyExpenses")).toBe(2_000 + 400 + 600 + 300 + 500);
    expect(profile.has("annualIncome")).toBe(false);
    expect(profile.has("filingStatus")).toBe(false);
    expect(profile.has("stateCode")).toBe(false);

    choose(select(root, "Filing status"), "head_of_household");
    expect(profile.get("filingStatus")).toBe("head_of_household");
    expect(profile.has("annualIncome")).toBe(false);

    type(input(root, "Income"), 7_000);
    expect(profile.get("annualIncome")).toBe(7_000 * 12);
  });

  /**
   * Essential spending is a different question from total spending, and the
   * budget asks the second one: its last row is "All other expenses", which is
   * the opposite of essential. My Plan's rainy-day step and two tiles read the
   * essential figure, so filling it from this total would size an emergency
   * fund around a household's discretionary spending.
   */
  it("never claims to know which of those expenses are essential", () => {
    const profile = new SituationStore();
    const root = mountHome(profile);
    type(input(root, "Food"), 700);
    type(input(root, "All other expenses"), 900);
    expect(profile.has("totalMonthlyExpenses")).toBe(true);
    expect(profile.has("essentialMonthlyExpenses")).toBe(false);
  });

  /**
   * The rounding trap. $85,000 a year prefills as $7,083 a month, and $7,083 a
   * month multiplies back out to $84,996 — so a budget that recomputed the
   * annual figure from its own box would quietly edit an income the reader
   * typed somewhere else, on an edit to an unrelated row.
   */
  it("does not shave $4 off an income it only restated", () => {
    const profile = new SituationStore();
    profile.set("annualIncome", 85_000);
    const root = mountHome(profile);

    choose(select(root, "State"), "ny");
    type(input(root, "Housing"), 1_800);
    expect(profile.get("annualIncome")).toBe(85_000);

    // Until the reader restates it here, at which point the box is the claim.
    type(input(root, "Income"), 8_000);
    expect(profile.get("annualIncome")).toBe(96_000);
  });

  it("restates the expense total when the pay frequency changes", () => {
    const profile = new SituationStore();
    const root = mountHome(profile);

    // Frequency alone, on untouched defaults, is not a claim about spending.
    choose(select(root, "How often you're paid"), "weekly");
    expect(profile.has("totalMonthlyExpenses")).toBe(false);

    type(input(root, "Housing"), 500);
    const weekly = 500 + 400 + 600 + 300 + 500;
    expect(profile.get("totalMonthlyExpenses")).toBe(Math.round((weekly * 52) / 12));

    choose(select(root, "How often you're paid"), "monthly");
    expect(profile.get("totalMonthlyExpenses")).toBe(weekly);
  });

  it("leaving a state leaves its county behind", () => {
    const profile = new SituationStore();
    const root = mountHome(profile);

    choose(select(root, "State"), "md");
    expect(profile.get("stateCode")).toBe("md");
    expect(profile.get("county")).toBeTruthy();

    choose(select(root, "State"), "tx");
    expect(profile.get("stateCode")).toBe("tx");
    expect(profile.get("county")).toBe("");
  });
});
