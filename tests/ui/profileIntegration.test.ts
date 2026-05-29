import { describe, it, expect, beforeAll } from "vitest";
import { mountTakeHome } from "../../src/tiles/takeHome";
import { mountFederalIncomeTax } from "../../src/tiles/federalIncomeTax";
import { SituationPanel } from "../../src/ui/situationPanel";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import { serialize } from "../../src/profile/portable";
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

describe("My Situation panel", () => {
  it("can always be closed — by the Close button, the Done button, or Escape", () => {
    const profile = new SituationStore();
    const panel = new SituationPanel(profile, data);
    document.body.append(panel.element);

    // Close button.
    panel.show();
    expect(panel.isOpen()).toBe(true);
    const closeBtn = Array.from(panel.element.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Close"),
    )!;
    expect(closeBtn).toBeTruthy();
    closeBtn.click();
    expect(panel.isOpen()).toBe(false);
    expect(panel.element.hidden).toBe(true);

    // Done button.
    panel.show();
    Array.from(panel.element.querySelectorAll("button"))
      .find((b) => b.textContent === "Done")!
      .click();
    expect(panel.isOpen()).toBe(false);

    // Escape key, from anywhere on the window (not only a focused field).
    panel.show();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(panel.isOpen()).toBe(false);

    panel.element.remove();
  });

  it("lets you choose a filing status and enter income", () => {
    const profile = new SituationStore();
    const panel = new SituationPanel(profile, data);
    document.body.append(panel.element);
    panel.show();

    const fs = panel.element.querySelector<HTMLSelectElement>('select[name="fs"]')!;
    fs.value = "single";
    fs.dispatchEvent(new Event("change"));
    expect(profile.get("filingStatus")).toBe("single");

    const inc = panel.element.querySelector<HTMLInputElement>('input[name="inc"]')!;
    inc.value = "60000";
    inc.dispatchEvent(new Event("input"));
    expect(profile.get("annualIncome")).toBe(60000);

    panel.close();
    panel.element.remove();
  });

  it("edits write to the profile and the summary reflects them", () => {
    const profile = new SituationStore();
    const panel = new SituationPanel(profile, data);
    document.body.append(panel.element);
    panel.show();

    const inc = panel.element.querySelector<HTMLInputElement>('input[name="inc"]')!;
    inc.value = "77000";
    inc.dispatchEvent(new Event("input"));
    expect(profile.get("annualIncome")).toBe(77000);

    const summary = panel.element.querySelector(".situation-list");
    expect(summary?.textContent).toContain("77,000");

    panel.close();
    panel.element.remove();
  });

  it("clears the profile from the panel", () => {
    const profile = new SituationStore();
    profile.set("annualIncome", 50000);
    const panel = new SituationPanel(profile, data);
    document.body.append(panel.element);
    panel.show();

    const clear = Array.from(panel.element.querySelectorAll("button")).find(
      (b) => b.textContent === "Clear",
    )!;
    clear.click();
    expect(profile.has("annualIncome")).toBe(false);
    panel.element.remove();
  });

  it("imports a serialized profile chosen from a file", async () => {
    const src = new SituationStore();
    src.set("annualIncome", 123456);
    src.set("filingStatus", "head_of_household");
    const fileText = serialize(src);

    const dest = new SituationStore();
    const panel = new SituationPanel(dest, data);
    document.body.append(panel.element);
    panel.show();

    const fileInput = panel.element.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File([fileText], "your-situation.json", { type: "application/json" });
    Object.defineProperty(fileInput, "files", { value: [file], configurable: true });
    fileInput.dispatchEvent(new Event("change"));

    // The import is async (file.text()); wait a tick.
    await new Promise((r) => setTimeout(r, 0));
    expect(dest.get("annualIncome")).toBe(123456);
    expect(dest.get("filingStatus")).toBe("head_of_household");
    panel.element.remove();
  });
});
