import { describe, it, expect, beforeAll } from "vitest";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import { marginalExplorerTile } from "../../src/tiles/marginalExplorer";
import { paycheckOptimizerTile } from "../../src/tiles/paycheckOptimizer";
import { resolveResidenceLocal, residenceLocalField } from "../../src/ui/residenceLocal";
import type { TileContext, TileDefinition } from "../../src/tiles/types";

/**
 * The mandatory county tax reaches the tiles that answer "what does my next
 * $1,000 cost" and "what does another $1,000 into the 401(k) save".
 *
 * It did not until 2026-09-02. Both tiles ran the same engine as Take-Home but
 * passed no local ids, so a Maryland resident's combined marginal rate was
 * short by up to 3.3 points and an Indiana resident's by up to 3.0 — not a
 * rounding difference, and not one the reader could see. It was a defensible
 * omission when no mandatory local was modeled at all; two states and ~13M
 * people later it was just wrong.
 */
let bundled: BundledData;
beforeAll(async () => {
  bundled = await loadBundledData();
});

function mountTile(
  tile: TileDefinition,
  data: BundledData,
  query: Record<string, string>,
): { root: HTMLElement; lastParams: () => URLSearchParams | null } {
  const root = document.createElement("div");
  const params = new URLSearchParams(query);
  let captured: URLSearchParams | null = null;
  const ctx: TileContext = {
    root,
    params,
    setParams: (p) => {
      captured = p;
    },
    permalink: (p) => `https://enklayve.com/#/${tile.id}?${(p ?? params).toString()}`,
    navigate: () => {},
    locale: "en-US",
    data,
    profile: new SituationStore(),
  };
  // Both tiles are "ready", so `mount` is defined — assert it rather than
  // silently rendering nothing if a tile is ever demoted to coming-soon.
  expect(tile.mount, `${tile.id} has no mount function`).toBeDefined();
  tile.mount!(ctx);
  return { root, lastParams: () => captured };
}

describe("the shared residence-local resolution", () => {
  it("resolves a state with a mandatory local to exactly one county, defaulting", () => {
    const md = bundled.state("md")!;
    expect(resolveResidenceLocal(md, [])).toEqual(["md-montgomery"]);
    expect(resolveResidenceLocal(md, ["md-worcester"])).toEqual(["md-worcester"]);
    // A county belonging to another state cannot survive a state change.
    expect(resolveResidenceLocal(md, ["in-marion"])).toEqual(["md-montgomery"]);
  });

  it("leaves a state with only OPT-IN locals alone — those are a question, not a fact", () => {
    const ny = bundled.state("ny")!;
    expect(resolveResidenceLocal(ny, [])).toEqual([]);
    expect(resolveResidenceLocal(ny, ["nyc"])).toEqual(["nyc"]);
    expect(resolveResidenceLocal(bundled.state("mi"), [])).toEqual([]);
  });

  it("renders no control at all for the 49 jurisdictions with no mandatory local", () => {
    expect(residenceLocalField(bundled.state("ca"), undefined, () => {})).toBeNull();
    expect(residenceLocalField(bundled.state("mi"), undefined, () => {})).toBeNull();
    expect(residenceLocalField(null, undefined, () => {})).toBeNull();
  });
});

describe("the Marginal Rate Explorer", () => {
  it("charges an Indiana resident their county tax on the next $1,000", () => {
    const { root } = mountTile(marginalExplorerTile, bundled, {
      fs: "single",
      st: "in",
      inc: "60000",
      step: "1000",
    });
    const sel = root.querySelector<HTMLSelectElement>("select[name='loc-select']");
    expect(sel, "Indiana must offer the county it is going to charge").not.toBeNull();
    expect(sel!.value).toBe("in-marion");
    const text = root.textContent ?? "";
    expect(text).toContain("Local tax");
    // 2.02% of the next $1,000 in Marion County, on top of the 2.95% state rate.
    expect(text).toContain("$20.20");
  });

  it("shows no county control, and no local line, for a state without one", () => {
    const { root } = mountTile(marginalExplorerTile, bundled, {
      fs: "single",
      st: "ca",
      inc: "120000",
      step: "1000",
    });
    expect(root.querySelector("select[name='loc-select']")).toBeNull();
    expect(root.textContent ?? "").not.toContain("Local tax");
  });

  it("puts the chosen county in the permalink so the answer is reproducible", () => {
    const { root, lastParams } = mountTile(marginalExplorerTile, bundled, {
      fs: "single",
      st: "md",
      inc: "60000",
      step: "1000",
    });
    const sel = root.querySelector<HTMLSelectElement>("select[name='loc-select']")!;
    sel.value = "md-worcester";
    sel.dispatchEvent(new Event("change"));
    expect(lastParams()?.getAll("loc")).toEqual(["md-worcester"]);
  });
});

describe("the Paycheck Optimizer", () => {
  it("counts the county tax a 401(k) dollar also escapes", () => {
    const { root } = mountTile(paycheckOptimizerTile, bundled, {
      fs: "single",
      st: "in",
      w: "60000",
      k: "0",
    });
    const sel = root.querySelector<HTMLSelectElement>("select[name='loc-select']");
    expect(sel).not.toBeNull();
    expect(sel!.value).toBe("in-marion");
  });

  it("shows no county control for a state without a mandatory local", () => {
    const { root } = mountTile(paycheckOptimizerTile, bundled, {
      fs: "single",
      st: "ca",
      w: "95000",
    });
    expect(root.querySelector("select[name='loc-select']")).toBeNull();
  });
});
