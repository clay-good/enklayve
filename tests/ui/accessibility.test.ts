import { describe, it, expect, beforeAll, afterEach } from "vitest";
import axe from "axe-core";
import {
  renderHome,
  renderAbout,
  renderAllTools,
  renderReadout,
  renderReport,
  mountApp,
} from "../../src/ui/shell";
import { SituationPanel } from "../../src/ui/situationPanel";
import { mountTakeHome } from "../../src/tiles/takeHome";
import { mountFederalIncomeTax } from "../../src/tiles/federalIncomeTax";
import { mountMarginalExplorer } from "../../src/tiles/marginalExplorer";
import { mountCompoundGrowth } from "../../src/tiles/compoundGrowth";
import { mountSelfEmploymentTax } from "../../src/tiles/selfEmploymentTax";
import { mountHourlySalary } from "../../src/tiles/hourlySalary";
import { mountLoanAmortization } from "../../src/tiles/loanAmortization";
import { mountRefinance } from "../../src/tiles/refinance";
import { mountAutoLoan } from "../../src/tiles/autoLoan";
import { mountRetirementOptimizer } from "../../src/tiles/retirementOptimizer";
import { mountCapitalGains } from "../../src/tiles/capitalGains";
import { mountInflation } from "../../src/tiles/inflation";
import { mountRmd } from "../../src/tiles/rmd";
import { mountYourPlan } from "../../src/tiles/yourPlan";
import { mountPeaceOfMind } from "../../src/tiles/peaceOfMind";
import { mountFreedomDate } from "../../src/tiles/freedomDate";
import { mountDownshift } from "../../src/tiles/downshift";
import { mountSabbatical } from "../../src/tiles/sabbatical";
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
    renderHome(main, () => {});
    document.body.append(main);
    await expectNoViolations(main);
  }, 30000);

  it("the All Tools index has no violations", async () => {
    const main = document.createElement("main");
    renderAllTools(main, () => {});
    document.body.append(main);
    await expectNoViolations(main);
  }, 30000);

  it("the Why enklayve (about) view has no violations", async () => {
    const main = document.createElement("main");
    renderAbout(main, () => {});
    document.body.append(main);
    await expectNoViolations(main);
  }, 30000);

  it("the Readout view has no violations", async () => {
    const main = document.createElement("main");
    renderReadout({ container: main, navigate: () => {}, profile: new SituationStore() });
    document.body.append(main);
    await expectNoViolations(main);
  }, 30000);

  it("the Readout Report view has no violations", async () => {
    const main = document.createElement("main");
    const profile = new SituationStore();
    profile.set("annualIncome", 95000);
    profile.set("stateCode", "ca");
    renderReport({ container: main, navigate: () => {}, profile, data });
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
      {
        name: "self-employment-tax",
        mount: mountSelfEmploymentTax,
        params: new URLSearchParams({ fs: "single", np: "80000" }),
      },
      {
        name: "hourly-salary",
        mount: mountHourlySalary,
        params: new URLSearchParams({ m: "hourly", hr: "28", h: "40", ot: "5" }),
      },
      {
        name: "loan-amortization",
        mount: mountLoanAmortization,
        params: new URLSearchParams({ p: "320000", r: "6.5", y: "30", x: "200" }),
      },
      {
        name: "refinance",
        mount: mountRefinance,
        params: new URLSearchParams({
          b: "300000",
          cr: "7",
          cy: "27",
          nr: "5.5",
          ny: "30",
          cc: "6000",
        }),
      },
      {
        name: "auto-loan",
        mount: mountAutoLoan,
        params: new URLSearchParams({ a: "32000", apr: "7.5", y: "6", f: "1500" }),
      },
      {
        name: "retirement-optimizer",
        mount: mountRetirementOptimizer,
        params: new URLSearchParams({
          age: "52",
          k: "12000",
          ira: "3000",
          hsa: "family",
          h: "4000",
        }),
      },
      {
        name: "capital-gains",
        mount: mountCapitalGains,
        params: new URLSearchParams({ fs: "single", ord: "90000", st: "5000", lt: "20000" }),
      },
      {
        name: "inflation",
        mount: mountInflation,
        params: new URLSearchParams({ amt: "100", from: "2000", to: "2024" }),
      },
      {
        name: "rmd",
        mount: mountRmd,
        params: new URLSearchParams({ age: "75", bal: "500000" }),
      },
      {
        name: "your-plan",
        mount: mountYourPlan,
        params: new URLSearchParams(),
      },
      {
        name: "peace-of-mind",
        mount: mountPeaceOfMind,
        params: new URLSearchParams(),
      },
      {
        name: "freedom-date",
        mount: mountFreedomDate,
        params: new URLSearchParams({ b: "6000", r: "22", pay: "300" }),
      },
      {
        name: "downshift",
        mount: mountDownshift,
        params: new URLSearchParams({ age: "40", ret: "65", bal: "150000", r: "5", t: "1000000" }),
      },
      {
        name: "sabbatical",
        mount: mountSabbatical,
        params: new URLSearchParams({ s: "30000", burn: "4000", m: "6" }),
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
        navigate: () => {},
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
