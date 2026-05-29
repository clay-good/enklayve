import { describe, it, expect, beforeAll, afterEach } from "vitest";
import axe from "axe-core";
import { renderHome, mountApp } from "../../src/ui/shell";
import { SituationPanel } from "../../src/ui/situationPanel";
import { mountTakeHome } from "../../src/tiles/takeHome";
import { mountFederalIncomeTax } from "../../src/tiles/federalIncomeTax";
import { mountMarginalExplorer } from "../../src/tiles/marginalExplorer";
import { mountCompoundGrowth } from "../../src/tiles/compoundGrowth";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import type { TileContext } from "../../src/tiles/types";

/**
 * Phase 4 acceptance: the shell passes axe-core with no violations
 * (BUILD-SPEC.md §11). happy-dom has no layout engine, so the color-contrast
 * rule (which needs computed pixel colors) is verified by hand against the
 * theme tokens in styles.css rather than by axe and is disabled here. Every
 * structural rule — labels, roles, names, landmarks — runs.
 */
const AXE_OPTIONS: axe.RunOptions = {
  rules: { "color-contrast": { enabled: false } },
};

async function expectNoViolations(node: Element): Promise<void> {
  const results = await axe.run(node, AXE_OPTIONS);
  const summary = results.violations.map((v) => `${v.id}: ${v.help}`).join("\n");
  expect(summary).toBe("");
}

let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

afterEach(() => {
  document.body.replaceChildren();
});

describe("accessibility (axe-core)", () => {
  it("home view has no violations", async () => {
    const main = document.createElement("main");
    renderHome(
      main,
      () => {},
      () => {},
    );
    document.body.append(main);
    await expectNoViolations(main);
  }, 30000);

  const tileCases: { name: string; mount: (ctx: TileContext) => void; params: URLSearchParams }[] =
    [
      {
        name: "take-home",
        mount: mountTakeHome,
        params: new URLSearchParams({ fs: "single", st: "ny", w: "85000" }),
      },
      {
        name: "federal-income-tax",
        mount: mountFederalIncomeTax,
        params: new URLSearchParams({ fs: "single", inc: "95000", dm: "itemized" }),
      },
      {
        name: "marginal-explorer",
        mount: mountMarginalExplorer,
        params: new URLSearchParams({ fs: "single", st: "ca", inc: "120000", step: "1000" }),
      },
      {
        name: "compound-growth",
        mount: mountCompoundGrowth,
        params: new URLSearchParams({ p: "10000", c: "500", r: "6", y: "30" }),
      },
    ];

  for (const tc of tileCases) {
    it(`the ${tc.name} tile form has no violations`, async () => {
      const main = document.createElement("main");
      const ctx: TileContext = {
        root: main,
        params: tc.params,
        setParams: () => {},
        permalink: () => "https://enklayve.com/#/x",
        locale: "en-US",
        data,
        profile: new SituationStore(),
      };
      tc.mount(ctx);
      document.body.append(main);
      await expectNoViolations(main);
    }, 30000);
  }

  it("the fully mounted shell has no violations", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const handle = await mountApp(root);
    await expectNoViolations(document.body);
    handle.destroy();
  }, 30000);

  it("the open Your Situation panel has no violations", async () => {
    const profile = new SituationStore();
    profile.set("annualIncome", 85000);
    const panel = new SituationPanel(profile, data);
    document.body.append(panel.element);
    panel.show();
    await expectNoViolations(document.body);
    panel.close();
  }, 30000);
});
