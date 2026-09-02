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

  it("shares pre-tax adjustments with My Situation, in both directions", () => {
    // "Pre-tax adjustments" here and `preTaxContributions` in the profile are
    // one number under two names, and the profile field was declared,
    // documented, and read by nothing until 2026-09-02 — so someone who typed
    // their 401(k) into this tile was asked for it again by the next one.
    const profile = new SituationStore();
    profile.set("preTaxContributions", 9000);
    const seeded = mount(new URLSearchParams({ fs: "single", st: "ca", w: "90000" }), profile);
    expect(seeded.root.querySelector<HTMLInputElement>('input[name="adj"]')!.value).toBe("9000");

    // The deep link still wins over the profile, like every other shared field.
    const linked = mount(
      new URLSearchParams({ fs: "single", st: "ca", w: "90000", adj: "3000" }),
      profile,
    );
    expect(linked.root.querySelector<HTMLInputElement>('input[name="adj"]')!.value).toBe("3000");

    // And typing here writes it back for the next tile to find.
    const fresh = new SituationStore();
    const { root } = mount(new URLSearchParams({ fs: "single", st: "ca", w: "90000" }), fresh);
    const adj = root.querySelector<HTMLInputElement>('input[name="adj"]')!;
    adj.value = "12000";
    adj.dispatchEvent(new Event("input"));
    expect(fresh.get("preTaxContributions")).toBe(12000);
  });

  it("renders Detroit as an OPT-IN checkbox, because most of Michigan does not pay it", () => {
    // The contrast with Indiana below is the whole distinction: an Indiana
    // resident pays a county tax wherever they live, so the county is a required
    // choice; a Michigan resident pays a city tax only in 24 of them, so the
    // city is a box you tick. Rendering Detroit as a default-selected dropdown
    // would charge 2.4% to everyone in Michigan.
    const { root, lastParams } = mount(new URLSearchParams({ fs: "single", st: "mi", w: "60000" }));
    expect(root.querySelector(".local-addons select[name='loc-select']")).toBeNull();
    const cb = root.querySelector<HTMLInputElement>('.local-addons input[type="checkbox"]');
    expect(cb).not.toBeNull();
    expect(cb!.checked).toBe(false);
    cb!.checked = true;
    cb!.dispatchEvent(new Event("change"));
    expect(lastParams()?.get("loc")).toBe("mi-detroit");
    const hasDetroit = Array.from(root.querySelectorAll(".bd-label")).some(
      (n) => n.textContent === "City of Detroit local tax",
    );
    expect(hasDetroit).toBe(true);
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

describe("a marginal rate over 100%", () => {
  /**
   * The most alarming number this site can print, and it is correct. The rate
   * is measured over a $100 wage probe, so an Ohio filer just under $26,050 of
   * taxable income reads 351%: Ohio Rev. Code §5747.02(A)(3)(c) owes nothing at
   * or below that line and $332.00 plus 2.75% above it, over 0% bands, so the
   * $332 lands whole on the first dollar over. Printing "351%" beside "next
   * dollar" with no explanation is worse than printing nothing — it reads as a
   * broken calculator, and a reader who believes it takes away a rate that is
   * true of a hundred dollars and of no dollar after them.
   */
  it("explains itself rather than reading as a broken calculator", () => {
    const { root } = mount(new URLSearchParams({ fs: "single", st: "oh", w: "26000" }));
    const rows = Array.from(root.querySelectorAll(".bd-row")).map((r) => r.textContent ?? "");
    const marginal = rows.find((t) => t.includes("Marginal rate"));
    expect(marginal).toBeDefined();
    const note = root.querySelector(".statute-step")?.textContent ?? "";
    expect(note).toContain("over 100%");
    expect(note).toContain("Ohio");
    expect(note).toContain("$26,050");
    expect(note).toContain("$332.00");
  });

  it("says nothing to an Ohio filer whose next $100 is ordinary", () => {
    // A warning attached to every Ohio paycheck is furniture. Both sides of the
    // line are ordinary: below the probe's reach, and above the step.
    for (const w of ["18000", "60000"]) {
      const { root } = mount(new URLSearchParams({ fs: "single", st: "oh", w }));
      expect(root.querySelector(".statute-step"), `wages ${w}`).toBeNull();
    }
  });

  it("says nothing in a state whose schedule has no such line", () => {
    const { root } = mount(new URLSearchParams({ fs: "single", st: "ca", w: "26000" }));
    expect(root.querySelector(".statute-step")).toBeNull();
  });
});
