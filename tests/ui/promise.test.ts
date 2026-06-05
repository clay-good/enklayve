import { describe, it, expect, beforeAll } from "vitest";
import { renderTileView } from "../../src/ui/shell";
import { Router, type Route } from "../../src/ui/router";
import { TILES, SUB_TOOLS } from "../../src/tiles/registry";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";

/**
 * SPEC-2 §0.2 / SPEC §214: "Every tool page carries ... a one-line promise that
 * it's computed on-device, US-only, and is information rather than advice."
 *
 * The promise is rendered by the shell's shared `tileExplainer` for every tile
 * route — not by the tiles themselves — so the per-tile axe sweep (which mounts
 * tiles directly) never exercises it, and a refactor of the route renderer could
 * silently drop it. This locks the invariant: `renderTileView` (the function the
 * router calls for every `#/<tile>` route) must always emit `.explainer-promise`
 * carrying all three required clauses.
 *
 * `TILES` is the complete set of routable tiles — the 10 hubs — since every
 * calculator is hosted inside a hub at `?tool=` (sub-tools are never top-level
 * routes). Iterating it means a newly added hub is covered automatically.
 */

let data: BundledData | null = null;
beforeAll(async () => {
  data = await loadBundledData();
});

function renderRoute(tile: (typeof TILES)[number], params = new URLSearchParams()): HTMLElement {
  const container = document.createElement("main");
  const route: Route = { tileId: tile.id, params };
  renderTileView(
    container,
    tile,
    route,
    new Router(),
    data,
    "en-US",
    () => {},
    new SituationStore(),
  );
  return container;
}

function expectPromise(container: HTMLElement, label: string): void {
  const promise = container.querySelector(".explainer-promise");
  expect(promise, `${label} is missing the .explainer-promise`).not.toBeNull();
  const text = promise?.textContent ?? "";
  expect(text, `${label}: no on-device clause`).toMatch(/on your device/i);
  expect(text, `${label}: no US-only clause`).toMatch(/U\.S\.|United States|US-only/i);
  expect(text, `${label}: no not-advice clause`).toMatch(/not\b.*\badvice/i);
}

describe("every tool page carries the on-device / US-only / not-advice promise (SPEC-2 §0.2)", () => {
  for (const tile of TILES) {
    it(`the ${tile.id} hub renders the promise`, () => {
      expectPromise(renderRoute(tile), tile.id);
    });
  }

  // A deep link lands on a specific sub-tool (`?tool=`); the page-level promise
  // must be present there too. Sample a sub-tool from a few different hubs.
  const sampled = ["take-home", "capital-gains", "eitc", "rmd"];
  for (const toolId of sampled) {
    const entry = SUB_TOOLS.find((s) => s.tile.id === toolId);
    it(`a deep link to ${toolId} (${entry?.hubId}) still shows the promise`, () => {
      expect(entry, `${toolId} not found in SUB_TOOLS`).toBeTruthy();
      const hub = TILES.find((t) => t.id === entry!.hubId)!;
      expectPromise(
        renderRoute(hub, new URLSearchParams({ tool: toolId })),
        `${entry!.hubId}?tool=${toolId}`,
      );
    });
  }
});
