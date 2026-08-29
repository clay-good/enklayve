import { describe, it, expect, beforeAll } from "vitest";
import { SUB_TOOLS, TILES } from "../../src/tiles/registry";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import type { TileContext, TileDefinition } from "../../src/tiles/types";

/**
 * Catalog-wide invariants (SPEC-3 §2.6 and §2.9).
 *
 * The per-tile suites each assert these for the tile they were written for,
 * which means a tile added later is covered only if someone remembers to write
 * them again. These run over **every registered calculator**, so a new tile is
 * covered the moment it lands in the registry and a regression in an old one
 * cannot hide behind a suite nobody updated.
 *
 * The §2.6 invariant is the interesting one: a stale or hostile `?param` may not
 * change the *kind* of answer without the user seeing it. An enum param must
 * validate and fall back to a default the UI then **reflects** — the selected
 * option visibly changes — rather than leaving a control blank or, worse,
 * silently computing against something the reader cannot see.
 */
let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

/**
 * Every enum-ish param name used anywhere in the catalog, each set to a value
 * that is syntactically plausible and semantically nonsense — the shape of a
 * link that was valid a year ago, or was hand-edited.
 */
const HOSTILE = new URLSearchParams({
  st: "ZZ",
  state: "ZZ",
  fs: "married_to_the_sea",
  status: "not_a_status",
  region: "atlantis",
  mode: "nonsense",
  per: "fortnightly",
  freq: "fortnightly",
  kind: "unknown-kind",
  plan: "no-such-plan",
  tool: "no-such-tool",
  set: "nowhere",
  net: "sideways",
  ev: "no-such-event",
  prog: "no-such-program",
  d: "not-a-mode",
  view: "nope",
});

function mount(tile: TileDefinition, params: URLSearchParams): HTMLElement {
  const root = document.createElement("div");
  tile.mount!({
    root,
    params,
    setParams: () => {},
    permalink: () => "https://enklayve.com/#/x",
    navigate: () => {},
    locale: "en-US",
    data,
    profile: new SituationStore(),
  } as TileContext);
  return root;
}

/** Text that must never reach the screen (SPEC-3 §2.1). */
const NON_FINITE = /\b(NaN|Infinity|-Infinity)\b|∞/;

const CALCULATORS = SUB_TOOLS.map(({ tile }) => tile).filter((t) => t.mount);

describe("every calculator in the catalog", () => {
  it("has at least the tools the registry advertises", () => {
    expect(CALCULATORS.length).toBeGreaterThan(50);
    expect(CALCULATORS.length).toBe(SUB_TOOLS.length);
  });

  for (const tile of CALCULATORS) {
    describe(tile.id, () => {
      it("mounts against a hostile deep link without throwing", () => {
        expect(() => mount(tile, new URLSearchParams(HOSTILE))).not.toThrow();
      });

      it("falls back to a value the reader can see on every enum control", () => {
        const root = mount(tile, new URLSearchParams(HOSTILE));
        const nonsense = new Set([...HOSTILE.values()]);
        for (const select of root.querySelectorAll("select")) {
          const options = [...select.options].map((o) => o.value);
          if (options.length === 0) continue;
          // The control must be showing one of its own options, and never the
          // nonsense value from the link. A blank *is* allowed where the select
          // offers a blank option — several state pickers do, and "no state
          // selected" is a real, visible answer rather than a silent fallback.
          expect(options, `${tile.id}: <select> left showing "${select.value}"`).toContain(
            select.value,
          );
          expect(nonsense.has(select.value), `${tile.id}: <select> kept a bad param`).toBe(false);
        }
      });

      it("paints no NaN or Infinity for a hostile deep link", () => {
        const text = mount(tile, new URLSearchParams(HOSTILE)).textContent ?? "";
        expect(text, `${tile.id} painted a non-finite value`).not.toMatch(NON_FINITE);
      });

      it("survives absurd values in every numeric field it owns", () => {
        // The param names are read off the tile's own rendered inputs rather
        // than guessed from a hand-kept list, so a tile added later — or a field
        // renamed — is covered without anyone remembering to update this. The
        // hand-kept version of this list is what let a crafted `?size=1e308`
        // link throw a RangeError out of the FAFSA tile and render a blank page.
        const clean = mount(tile, new URLSearchParams());
        const names = [...clean.querySelectorAll<HTMLInputElement>('input[type="number"]')]
          .map((i) => i.name || i.id.replace(/^f-/, ""))
          .filter((n) => n.length > 0);

        for (const magnitude of ["1e308", "-1e308", "9".repeat(309)]) {
          const absurd = new URLSearchParams(HOSTILE);
          for (const name of names) absurd.set(name, magnitude);
          let root: HTMLElement | null = null;
          expect(
            () => (root = mount(tile, absurd)),
            `${tile.id} threw on ${magnitude} — a crafted link must never blank the page`,
          ).not.toThrow();
          const text = (root as HTMLElement | null)?.textContent ?? "";
          expect(text, `${tile.id} painted a non-finite value`).not.toMatch(NON_FINITE);
        }
      });
    });
  }
});

describe("every hub in the catalog", () => {
  for (const hub of TILES.filter((t) => t.mount)) {
    it(`${hub.id} mounts against a hostile deep link and paints nothing non-finite`, () => {
      const root = mount(hub, new URLSearchParams(HOSTILE));
      expect(root.textContent ?? "").not.toMatch(NON_FINITE);
      // A `?tool=` naming nothing must land on the hub's default calculator
      // rather than an empty page.
      expect((root.textContent ?? "").trim().length).toBeGreaterThan(0);
    });
  }
});
