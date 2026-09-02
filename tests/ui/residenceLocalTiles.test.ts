import { describe, it, expect, beforeAll } from "vitest";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import { marginalExplorerTile } from "../../src/tiles/marginalExplorer";
import { paycheckOptimizerTile } from "../../src/tiles/paycheckOptimizer";
import { cliffExplorerTile, marginalRealityTile } from "../../src/tiles/benefitCliffs";
import { quarterlyTaxesTile } from "../../src/tiles/quarterlyTaxes";
import { buildReport } from "../../src/readout/report";
import { rememberableCounty } from "../../src/ui/residenceLocal";
import { resourcesAt } from "../../src/engine/cliffs";
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
  profile = new SituationStore(),
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
    profile,
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

describe("the benefit-cliff engine and its two tiles", () => {
  const base = {
    filingStatus: "head_of_household" as const,
    householdSize: 3,
    qualifyingChildren: 2,
    stateCode: "in",
    benchmarkMonthlyPremium: 0,
  };

  it("takes the county tax off what an Indiana household actually has", () => {
    // The whole point of this engine is "what does the household actually
    // have", so a tax every resident pays belongs in it. Marion County's 2.02%
    // on $50,000 of income is real money at an income where these curves bend.
    const data = {
      tax: { federal: bundled.federal()!, fica: bundled.fica()!, state: bundled.state("in")! },
      fpl: bundled.fpl("contiguous"),
      eitcCtc: bundled.eitcCtc(),
      aca: bundled.aca(),
      snap: bundled.snap(),
      medicaid: bundled.medicaid(),
      snapRegionSupported: true,
    };
    const without = resourcesAt(50000, base, data);
    const with_ = resourcesAt(50000, { ...base, localJurisdictionIds: ["in-marion"] }, data);
    expect(with_.totalResources).toBeLessThan(without.totalResources);
    // 2.02% of (50,000 − 1,000) = $989.80, and nothing else moves.
    expect(without.totalResources - with_.totalResources).toBeCloseTo(989.8, 2);
  });

  it("changes nothing for a state with no mandatory local", () => {
    const data = {
      tax: { federal: bundled.federal()!, fica: bundled.fica()!, state: bundled.state("ca")! },
      fpl: bundled.fpl("contiguous"),
      eitcCtc: bundled.eitcCtc(),
      aca: bundled.aca(),
      snap: bundled.snap(),
      medicaid: bundled.medicaid(),
      snapRegionSupported: true,
    };
    const ca = { ...base, stateCode: "ca" };
    expect(resourcesAt(50000, { ...ca, localJurisdictionIds: [] }, data).totalResources).toBe(
      resourcesAt(50000, ca, data).totalResources,
    );
  });

  it("offers the county on the Cliff Explorer, defaulted rather than blank", () => {
    const { root } = mountTile(cliffExplorerTile, bundled, {
      fs: "head_of_household",
      st: "md",
      size: "3",
      kids: "2",
      prem: "0",
    });
    const sel = root.querySelector<HTMLSelectElement>("select[name='loc-select']");
    expect(sel).not.toBeNull();
    expect(sel!.value).toBe("md-montgomery");
  });

  it("offers it on the Marginal Reality tile too, and puts it in the permalink", () => {
    const { root, lastParams } = mountTile(marginalRealityTile, bundled, {
      fs: "head_of_household",
      st: "in",
      size: "3",
      kids: "2",
      prem: "0",
      inc: "35000",
      step: "1000",
    });
    const sel = root.querySelector<HTMLSelectElement>("select[name='loc-select']")!;
    expect(sel.value).toBe("in-marion");
    sel.value = "in-porter";
    sel.dispatchEvent(new Event("change"));
    expect(lastParams()?.getAll("loc")).toEqual(["in-porter"]);
  });

  it("shows no county control for a state without one", () => {
    const { root } = mountTile(cliffExplorerTile, bundled, {
      fs: "head_of_household",
      st: "ca",
      size: "3",
      kids: "2",
      prem: "0",
    });
    expect(root.querySelector("select[name='loc-select']")).toBeNull();
  });
});

describe("Quarterly Taxes", () => {
  it("puts the county tax in the estimate somebody actually sends in", () => {
    // Of every figure on this site, this is the one a person transcribes onto a
    // payment four times a year. An estimate short by a county's 3% is an
    // underpayment with a penalty attached, not a display rounding.
    const { root } = mountTile(quarterlyTaxesTile, bundled, {
      fs: "single",
      st: "md",
      np: "90000",
    });
    const sel = root.querySelector<HTMLSelectElement>("select[name='loc-select']");
    expect(sel).not.toBeNull();
    expect(sel!.value).toBe("md-montgomery");
    const labels = Array.from(root.querySelectorAll(".bd-label")).map((n) => n.textContent);
    expect(labels).toContain("Montgomery County local tax");
    // Its own line, never folded into the state's: two authorities, two figures.
    expect(labels).toContain("State income tax (MD)");
  });

  it("shows no county control for a state without a mandatory local", () => {
    const { root } = mountTile(quarterlyTaxesTile, bundled, {
      fs: "single",
      st: "ca",
      np: "90000",
    });
    expect(root.querySelector("select[name='loc-select']")).toBeNull();
  });
});

describe("remembering the county across tiles", () => {
  it("remembers only a MANDATORY local, never an opt-in one", () => {
    // Take-Home's selection can hold New York City or Detroit. Storing one of
    // those as "the county you live in" would carry a choice the reader made
    // about themselves into four tiles that never asked, and charge them.
    expect(rememberableCounty(bundled.state("md"), ["md-worcester"])).toBe("md-worcester");
    expect(rememberableCounty(bundled.state("in"), ["in-porter"])).toBe("in-porter");
    expect(rememberableCounty(bundled.state("ny"), ["nyc"])).toBe("");
    expect(rememberableCounty(bundled.state("mi"), ["mi-detroit"])).toBe("");
    expect(rememberableCounty(bundled.state("ca"), [])).toBe("");
  });

  it("a county chosen in one tile pre-fills the next, and a deep link still wins", () => {
    const profile = new SituationStore();
    profile.set("county", "in-porter");
    const seeded = mountTile(marginalExplorerTile, bundled, { fs: "single", st: "in" }, profile);
    expect(seeded.root.querySelector<HTMLSelectElement>("select[name='loc-select']")!.value).toBe(
      "in-porter",
    );

    const linked = mountTile(
      marginalExplorerTile,
      bundled,
      { fs: "single", st: "in", loc: "in-cass" },
      profile,
    );
    expect(linked.root.querySelector<HTMLSelectElement>("select[name='loc-select']")!.value).toBe(
      "in-cass",
    );
  });

  it("a remembered county from another state falls back to the new state's default", () => {
    const profile = new SituationStore();
    profile.set("county", "md-worcester");
    const { root } = mountTile(marginalExplorerTile, bundled, { fs: "single", st: "in" }, profile);
    expect(root.querySelector<HTMLSelectElement>("select[name='loc-select']")!.value).toBe(
      "in-marion",
    );
  });
});

describe("the Readout Report", () => {
  /** A profile with enough in it for the report to run the tax engine. */
  const withIncome = (stateCode: string, county?: string): SituationStore => {
    const p = new SituationStore();
    p.set("filingStatus", "single");
    p.set("stateCode", stateCode);
    p.set("annualIncome", 60000);
    if (county) p.set("county", county);
    return p;
  };

  const rateOf = (model: {
    sections: { title: string; lines: { label: string; value: string }[] }[];
  }): string =>
    model.sections
      .find((s) => s.title === "Snapshot")!
      .lines.find((l) => l.label === "Effective tax rate")!.value;

  it("charges the remembered county, so the kept document agrees with the tiles", () => {
    // The report is the thing a household saves and comes back to. If its
    // effective rate disagrees with the tile that produced it, one of them is
    // lying and the reader cannot tell which.
    const cheap = buildReport(withIncome("in", "in-porter"), bundled);
    const dear = buildReport(withIncome("in", "in-randolph"), bundled);
    expect(rateOf(cheap)).not.toBe(rateOf(dear));
  });

  it("falls back to the state's default rather than skipping a mandatory tax", () => {
    // A profile that never passed through a tile carrying the county control
    // still belongs to someone who owes one.
    const none = buildReport(withIncome("md"), bundled);
    const chosen = buildReport(withIncome("md", "md-montgomery"), bundled);
    expect(rateOf(none)).toBe(rateOf(chosen));
  });

  it("ignores a county belonging to a state the household does not live in", () => {
    const stray = buildReport(withIncome("ca", "md-montgomery"), bundled);
    const clean = buildReport(withIncome("ca"), bundled);
    expect(rateOf(stray)).toBe(rateOf(clean));
  });
});
