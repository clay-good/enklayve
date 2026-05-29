import { describe, it, expect, beforeAll, afterEach } from "vitest";
import axe from "axe-core";
import { renderHome, mountApp } from "../../src/ui/shell";
import { mountTakeHome } from "../../src/tiles/takeHome";
import { loadBundledData, type BundledData } from "../../src/data/browser";
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

  it("the take-home tile form has no violations", async () => {
    const main = document.createElement("main");
    const ctx: TileContext = {
      root: main,
      params: new URLSearchParams({ fs: "single", st: "ny", w: "85000" }),
      setParams: () => {},
      permalink: () => "https://enklayve.com/#/take-home",
      locale: "en-US",
      data,
    };
    mountTakeHome(ctx);
    document.body.append(main);
    await expectNoViolations(main);
  }, 30000);

  it("the fully mounted shell has no violations", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const handle = await mountApp(root);
    await expectNoViolations(document.body);
    handle.destroy();
  }, 30000);
});
