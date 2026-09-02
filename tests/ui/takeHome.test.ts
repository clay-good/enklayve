import { describe, it, expect, beforeAll } from "vitest";
import { mountTakeHome } from "../../src/tiles/takeHome";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import type { TileContext } from "../../src/tiles/types";

let data: BundledData;

beforeAll(async () => {
  data = await loadBundledData();
});

function mount(
  params: URLSearchParams,
  profile = new SituationStore(),
): {
  root: HTMLElement;
  lastParams: () => URLSearchParams | null;
} {
  const root = document.createElement("div");
  let captured: URLSearchParams | null = null;
  const ctx: TileContext = {
    root,
    params,
    setParams: (p) => {
      captured = p;
    },
    permalink: (p) => `https://enklayve.com/#/take-home?${(p ?? params).toString()}`,
    navigate: () => {},
    locale: "en-US",
    data,
    profile,
  };
  mountTakeHome(ctx);
  return { root, lastParams: () => captured };
}

function rowValue(root: HTMLElement, label: string): string | undefined {
  const rows = Array.from(root.querySelectorAll(".bd-row"));
  const row = rows.find((r) => r.querySelector(".bd-label")?.textContent === label);
  return row?.querySelector(".bd-value")?.textContent ?? undefined;
}

describe("take-home tile", () => {
  it("bundles the federal, FICA, and state datasets through the integrity gate", () => {
    expect(data.federal()).not.toBeNull();
    expect(data.fica()).not.toBeNull();
    expect(data.state("ca")).not.toBeNull();
    expect(data.statusOf("federal-income-tax-2024")).toBe("ok");
  });

  it("restores its inputs from a deep link and computes a result", () => {
    const { root } = mount(new URLSearchParams({ fs: "single", st: "ca", w: "85000" }));
    // Inputs reflect the URL state.
    expect(root.querySelector<HTMLInputElement>('input[name="w"]')?.value).toBe("85000");
    expect(root.querySelector<HTMLSelectElement>('select[name="st"]')?.value).toBe("ca");
    // A result card is rendered with the take-home headline.
    expect(root.querySelector(".result-card")).not.toBeNull();
    expect(root.querySelector(".result-label")?.textContent).toBe("Annual take-home pay");
    // The breakdown shows the total tax and the federal line.
    expect(rowValue(root, "Total tax")).toBeTruthy();
    const fedLabel = Array.from(root.querySelectorAll(".bd-label")).some((n) =>
      n.textContent?.startsWith("Federal income tax"),
    );
    expect(fedLabel).toBe(true);
  });

  it("surfaces what a state's figures leave out, under the number", () => {
    // A `sourceNote` records what a shard does NOT model. Until it was rendered
    // here it reached only the exported report's citation appendix, so a
    // Michigan filer could read a take-home figure with nothing to say that
    // Michigan's 24 city income taxes are outside this engine — a Detroit
    // resident really owes more than the number shown.
    const { root } = mount(new URLSearchParams({ fs: "single", st: "mi", w: "60000" }));
    const notes = root.querySelector(".source-notes");
    expect(notes).not.toBeNull();
    expect(notes?.querySelector("summary")?.textContent).toBe("What these figures leave out");
    const text = notes?.textContent ?? "";
    expect(text).toMatch(/CITY INCOME TAXES/i);
    // Collapsed by default: long prose most readers do not want, present for the
    // readers who need it.
    expect((notes as HTMLDetailsElement).open).toBe(false);
  });

  it("never repeats the same source note twice in one card", () => {
    // A breakdown cites the same jurisdiction on several lines. The same
    // paragraph three times is noise, so notes dedupe by source document.
    const { root } = mount(new URLSearchParams({ fs: "single", st: "mi", w: "60000" }));
    const heads = Array.from(root.querySelectorAll(".source-note-head")).map((n) => n.textContent);
    expect(new Set(heads).size).toBe(heads.length);
  });

  it("shows a citation source link on rule-based lines (no orphan numbers)", () => {
    const { root } = mount(new URLSearchParams({ fs: "single", st: "ca", w: "85000" }));
    const links = root.querySelectorAll("a.cite-link");
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]?.getAttribute("href")).toMatch(/^https?:\/\//);
  });

  it("writes edited inputs back to the URL fragment for deep linking", () => {
    const { root, lastParams } = mount(new URLSearchParams({ fs: "single", st: "ca", w: "85000" }));
    const wages = root.querySelector<HTMLInputElement>('input[name="w"]')!;
    wages.value = "120000";
    wages.dispatchEvent(new Event("input"));
    const p = lastParams();
    expect(p?.get("w")).toBe("120000");
    expect(p?.get("st")).toBe("ca");
  });

  it("prefills a realistic worked example", () => {
    const { root } = mount(new URLSearchParams());
    const example = Array.from(root.querySelectorAll("button")).find(
      (b) => b.textContent === "Try an example",
    )!;
    example.click();
    expect(root.querySelector<HTMLInputElement>('input[name="w"]')?.value).toBe("85000");
    expect(root.querySelector(".result-card")).not.toBeNull();
  });

  it("offers a local add-on for New York and includes it when checked", () => {
    const { root, lastParams } = mount(
      new URLSearchParams({ fs: "single", st: "ny", w: "100000" }),
    );
    const cb = root.querySelector<HTMLInputElement>('.local-addons input[type="checkbox"]');
    expect(cb).not.toBeNull();
    cb!.checked = true;
    cb!.dispatchEvent(new Event("change"));
    expect(lastParams()?.get("loc")).toBeTruthy();
  });

  it("renders Maryland's county tax as a required single-select, defaulting to Montgomery", () => {
    const { root, lastParams } = mount(new URLSearchParams({ fs: "single", st: "md", w: "60000" }));
    // A dropdown (not opt-in checkboxes) — the county tax is mandatory by residence.
    const sel = root.querySelector<HTMLSelectElement>(".local-addons select[name='loc-select']");
    expect(sel).not.toBeNull();
    expect(root.querySelector('.local-addons input[type="checkbox"]')).toBeNull();
    expect(sel!.value).toBe("md-montgomery");
    // The default county's local tax appears in the breakdown with no opt-in step.
    const hasMontgomery = Array.from(root.querySelectorAll(".bd-label")).some(
      (n) => n.textContent === "Montgomery County local tax",
    );
    expect(hasMontgomery).toBe(true);
    // Switching counties updates the breakdown and the deep link.
    sel!.value = "md-worcester";
    sel!.dispatchEvent(new Event("change"));
    expect(lastParams()?.get("loc")).toBe("md-worcester");
    const hasWorcester = Array.from(root.querySelectorAll(".bd-label")).some(
      (n) => n.textContent === "Worcester County local tax",
    );
    expect(hasWorcester).toBe(true);
  });

  it("renders Indiana's county tax the same way, defaulting to Marion, with all 92 counties", () => {
    // Indiana is the second mandatory residence-based local, and it arrived
    // without an engine or a UI change — which is only true if the tile treats it
    // exactly like Maryland. That is the claim this test holds.
    const { root, lastParams } = mount(new URLSearchParams({ fs: "single", st: "in", w: "60000" }));
    const sel = root.querySelector<HTMLSelectElement>(".local-addons select[name='loc-select']");
    expect(sel).not.toBeNull();
    expect(root.querySelector('.local-addons input[type="checkbox"]')).toBeNull();
    expect(sel!.value).toBe("in-marion");
    expect(sel!.options).toHaveLength(92);
    const hasMarion = Array.from(root.querySelectorAll(".bd-label")).some(
      (n) => n.textContent === "Marion County local tax",
    );
    expect(hasMarion).toBe(true);
    sel!.value = "in-porter";
    sel!.dispatchEvent(new Event("change"));
    expect(lastParams()?.get("loc")).toBe("in-porter");
    const hasPorter = Array.from(root.querySelectorAll(".bd-label")).some(
      (n) => n.textContent === "Porter County local tax",
    );
    expect(hasPorter).toBe(true);
  });
});
