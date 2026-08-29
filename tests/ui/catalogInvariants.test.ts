import { describe, it, expect, beforeAll, afterEach } from "vitest";
import axe from "axe-core";
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

/**
 * happy-dom has no layout engine, so the colour-contrast rule (which needs
 * computed pixel colours) cannot run here and is verified by hand against the
 * theme tokens; every structural rule — labels, roles, names, landmarks — does.
 * Same configuration the shell's accessibility suite uses.
 */
const AXE_OPTIONS: axe.RunOptions = { rules: { "color-contrast": { enabled: false } } };

afterEach(() => {
  document.body.replaceChildren();
});

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
          // Note for anyone tempted to assert a *specific* selected value here:
          // happy-dom mis-reports `<select>.value` and `selectedIndex` when the
          // options are built with `selected` set before insertion, which is how
          // every tile builds them. It will tell you a tile ignores the profile
          // when Chromium shows it does not. The real assertions on which value
          // is showing live in the Playwright suite, on purpose.
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

/**
 * The README promises axe-core runs "across the home, About, All Tools, the
 * Readout, the Report, and **every tile form**, with zero violations". It ran
 * over eighteen of sixty-eight — a hand-kept list that new tiles were never
 * added to. This makes the sentence true, and keeps it true for tiles that do
 * not exist yet.
 *
 * Each tile is checked in the state a reader actually lands in: mounted with no
 * params, which is the worked example every tile falls back to.
 */
describe("every calculator is accessible", () => {
  for (const tile of CALCULATORS) {
    it(`${tile.id} has no axe violations`, async () => {
      const root = mount(tile, new URLSearchParams());
      document.body.append(root);
      const results = await axe.run(root, AXE_OPTIONS);
      expect(results.violations.map((v) => `${v.id}: ${v.help}`).join("\n")).toBe("");
    }, 30000);
  }
});

/**
 * The tile bar (SPEC-3 §4 acceptance criterion 4, restated as a gate).
 *
 * Every calculator is supposed to ship with a worked example, a plain-English
 * "how this works" block, at least one "Learn more" resource, and deep-linkable
 * URL state. That was a review checklist; a review checklist is a hand-kept
 * list wearing a different hat, so here it is as a test over the whole roster.
 */
describe("every calculator meets the tile bar", () => {
  for (const tile of CALCULATORS) {
    describe(tile.id, () => {
      it("explains itself in plain English", () => {
        expect(
          tile.how?.trim().length ?? 0,
          `${tile.id} has no "how this works" block`,
        ).toBeGreaterThan(200);
        expect(tile.description.trim().length).toBeGreaterThan(10);
        expect(tile.keywords.length, `${tile.id} is unfindable in search`).toBeGreaterThan(1);
      });

      it("points somewhere authoritative to learn more", () => {
        expect(tile.resources?.length ?? 0, `${tile.id} names no source to read`).toBeGreaterThan(
          0,
        );
        for (const r of tile.resources ?? []) {
          expect(r.url).toMatch(/^https:\/\//);
          expect(r.label.trim().length).toBeGreaterThan(3);
        }
      });

      it("offers a worked example the reader can start from", () => {
        const root = mount(tile, new URLSearchParams());
        const buttons = [...root.querySelectorAll("button")].map((b) => b.textContent ?? "");
        expect(
          buttons.some((t) => /try an example/i.test(t)),
          `${tile.id} has no "Try an example" button`,
        ).toBe(true);
      });

      it("writes its state to the URL, so a result is shareable", () => {
        // Deep-linkability is the property that makes every answer reproducible
        // (SPEC §2 principle 1). A tile that never calls `setParams` produces a
        // result nobody can link to or come back to.
        let wrote = 0;
        const root = document.createElement("div");
        tile.mount!({
          root,
          params: new URLSearchParams(),
          setParams: () => (wrote += 1),
          permalink: () => "https://enklayve.com/#/x",
          navigate: () => {},
          locale: "en-US",
          data,
          profile: new SituationStore(),
        } as TileContext);

        const example = [...root.querySelectorAll("button")].find((b) =>
          /try an example/i.test(b.textContent ?? ""),
        );
        example?.click();
        expect(wrote, `${tile.id} never wrote its state to the URL`).toBeGreaterThan(0);
      });
    });
  }
});

/**
 * The worked example actually works (SPEC-2 §7 acceptance: each tool "passes its
 * worked example").
 *
 * "Try an example" is what a visitor who has typed nothing presses, and it is
 * the only moment a tile gets to explain itself. The tile bar above checks the
 * button exists; this checks that pressing it produces a real answer — not an
 * empty panel, and not a column of zeroes.
 *
 * Deliberately *not* asserted: that a tile opens on a populated result before
 * the button is pressed. Most open at zero and that is a product choice, not a
 * defect — though bill triage was reworked to open on its example precisely
 * because "$0 covers $0 of $2,455" read as broken, so the question is a live one
 * for the tiles where zero is alarming rather than merely neutral.
 */
describe("every calculator's worked example produces an answer", () => {
  for (const tile of CALCULATORS) {
    it(`${tile.id} answers when "Try an example" is pressed`, () => {
      const root = mount(tile, new URLSearchParams());
      const example = [...root.querySelectorAll("button")].find((b) =>
        /try an example/i.test(b.textContent ?? ""),
      );
      expect(example, `${tile.id} has no "Try an example" button`).toBeDefined();
      example!.click();
      // The result may live in `.tile-result` or in the tile's own layout, so
      // read the whole subtree and subtract the form the reader typed into.
      for (const form of root.querySelectorAll("form")) form.remove();
      const text = root.textContent ?? "";
      expect(text.trim().length, `${tile.id} emptied its result`).toBeGreaterThan(20);
      expect(/[1-9]/.test(text), `${tile.id}'s worked example shows nothing but zeroes`).toBe(true);
    });
  }
});

describe("every hub in the catalog", () => {
  for (const hub of TILES.filter((t) => t.mount)) {
    it(`${hub.id} has no axe violations`, async () => {
      // The shell's accessibility suite lists ten hubs by hand and had never
      // gained the two Pillar 4 ones. Deriving the roster from the registry is
      // what stops that happening again.
      const root = mount(hub, new URLSearchParams());
      document.body.append(root);
      const results = await axe.run(root, AXE_OPTIONS);
      expect(results.violations.map((v) => `${v.id}: ${v.help}`).join("\n")).toBe("");
    }, 30000);

    it(`${hub.id} mounts against a hostile deep link and paints nothing non-finite`, () => {
      const root = mount(hub, new URLSearchParams(HOSTILE));
      expect(root.textContent ?? "").not.toMatch(NON_FINITE);
      // A `?tool=` naming nothing must land on the hub's default calculator
      // rather than an empty page.
      expect((root.textContent ?? "").trim().length).toBeGreaterThan(0);
    });
  }
});
