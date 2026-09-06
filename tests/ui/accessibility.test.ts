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
import { CommandPalette } from "../../src/ui/commandPalette";
import { staleBanner } from "../../src/ui/staleBanner";
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
import { mountSavingsBond } from "../../src/tiles/savingsBond";
import { mountRmd } from "../../src/tiles/rmd";
import { mountPeaceOfMind } from "../../src/tiles/peaceOfMind";
import { mountFreedomDate } from "../../src/tiles/freedomDate";
import { mountDownshift } from "../../src/tiles/downshift";
import { mountSabbatical } from "../../src/tiles/sabbatical";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { getTile } from "../../src/tiles/registry";
import { SituationStore } from "../../src/profile/situation";
import type { TileContext } from "../../src/tiles/types";

/**
 * Phase 4 acceptance: the shell passes axe-core with no violations
 * (BUILD-SPEC.md §11). happy-dom has no layout engine, so the color-contrast
 * rule (which needs computed pixel colors) is verified by hand against the
 * theme tokens in styles.css rather than by axe and is disabled here. Every
 * structural rule — labels, roles, names, landmarks — runs.
 *
 * **Coverage note.** The tile and hub lists below are hand-kept on purpose:
 * each entry mounts a *populated* state (an itemized deduction, an overtime
 * split, a refinance with real figures) that a default mount would not reach.
 * They are no longer what makes the catalog covered — that is
 * `catalogInvariants.test.ts`, which derives the full roster from the registry
 * and axe-checks every calculator and every hub. These lists having drifted to
 * eighteen of sixty-eight tiles and ten of twelve hubs is why that exists.
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
        name: "savings-bond",
        mount: mountSavingsBond,
        params: new URLSearchParams({ amt: "10000", period: "2022-05" }),
      },
      {
        name: "rmd",
        mount: mountRmd,
        params: new URLSearchParams({ age: "75", bal: "500000" }),
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

  // Each topic hub, mounted at its default sub-tool, exercises the segmented
  // control (the consolidation's one new primitive) alongside a real calculator.
  for (const hubId of [
    "paycheck-taxes",
    "self-employed",
    "investing",
    "retirement",
    "debt",
    "budget-cashflow",
    "home-purchases",
    "protection",
    "benefits",
    "where-you-stand",
  ]) {
    it(`the ${hubId} hub has no violations`, async () => {
      const main = document.createElement("main");
      const ctx: TileContext = {
        root: main,
        params: new URLSearchParams(),
        setParams: () => {},
        permalink: () => "https://enklayve.com/#/x",
        navigate: () => {},
        locale: "en-US",
        data,
        profile: new SituationStore(),
      };
      getTile(hubId)?.mount?.(ctx);
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

  /**
   * The two things the shell shows that a default mount never renders.
   *
   * The check above mounts the app and looks at it. Neither of these is on the
   * screen at that moment, and both are the kind that go wrong: the command
   * palette is a **hand-built ARIA combobox** — the primary browse path, and
   * the widget where the roles are easiest to get subtly wrong — and the
   * staleness banner appears only when a dataset lapses, which is to say on the
   * day the site is least trustworthy and most needs to say so out loud.
   *
   * Both are constructed directly rather than provoked through the shell,
   * because that is what makes them reachable at all: a lapsed dataset cannot
   * be arranged without moving the clock.
   */
  it("the command palette, open, with results and with none", async () => {
    const palette = new CommandPalette(() => {});
    document.body.append(palette.element);
    palette.show();
    const field = palette.element.querySelector<HTMLInputElement>(".palette-input")!;

    expect(palette.element.querySelectorAll(".palette-opt").length).toBeGreaterThan(0);
    await expectNoViolations(palette.element);

    field.value = "take home";
    field.dispatchEvent(new Event("input"));
    await expectNoViolations(palette.element);

    // The empty state is its own rendering, and a listbox with no options is
    // exactly where a combobox's `aria-activedescendant` points at nothing.
    field.value = "zzzzzzzz";
    field.dispatchEvent(new Event("input"));
    expect(palette.element.querySelectorAll(".palette-opt").length).toBe(0);
    await expectNoViolations(palette.element);

    palette.element.remove();
  }, 30000);

  it("the staleness banner, which only a lapsed dataset renders", async () => {
    // Both shapes, because they are different renderings and the louder one is
    // the one nobody sees in a healthy build: a lapsed dataset is old, an
    // invalid one did not match the hash the manifest pins.
    const stale = staleBanner({
      ...data,
      staleDatasets: () => [
        { id: "enrollment-windows-2026", effectiveYear: 2026 },
        { id: "garnishment-limits-2026", effectiveYear: 2026 },
      ],
    } as BundledData);
    expect(stale, "the banner no longer renders for a lapsed dataset").not.toBeNull();
    document.body.append(stale!);
    await expectNoViolations(stale!);

    const invalid = staleBanner({
      ...data,
      invalidDatasets: () => [{ id: "federal-income-tax-2024", problems: ["hash mismatch"] }],
    } as BundledData);
    expect(invalid, "the banner no longer renders for a failed integrity gate").not.toBeNull();
    document.body.append(invalid!);
    await expectNoViolations(invalid!);
  }, 30000);
});
