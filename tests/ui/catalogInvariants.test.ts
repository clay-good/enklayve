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

/**
 * Publishers a label may name, and the hosts each of them actually serves.
 *
 * Deliberately partial: it holds the agencies this catalog cites by name, and a
 * label naming nothing on the list is not checked at all. The point is not to
 * enumerate the federal government — it is that a label saying "IRS" must not
 * open a page the IRS did not write. Investor.gov is on the SEC's row because
 * it is the SEC's investor-education site, which is why "SEC, saving for
 * college (529 plans)" is a correct credit rather than the fourth bug.
 */
const AGENCY_HOSTS: [RegExp, string[]][] = [
  [/\bIRS\b/, ["irs.gov"]],
  [/\bCFPB\b|Consumer Financial Protection Bureau/, ["consumerfinance.gov"]],
  [/\bSSA\b|Social Security Administration/, ["ssa.gov"]],
  [/\bSEC\b|Investor\.gov/, ["sec.gov", "investor.gov"]],
  [/\bHUD\b/, ["hud.gov"]],
  [/\bDOL\b|Dept\. of Labor|Department of Labor/, ["dol.gov"]],
  [/\bUSDA\b/, ["usda.gov"]],
  [/\bCMS\b/, ["cms.gov"]],
  [/\bHHS\b/, ["hhs.gov"]],
  [/\bSBA\b/, ["sba.gov"]],
  [/\bBLS\b/, ["bls.gov"]],
  [/\bNAIC\b/, ["naic.org"]],
  [/\bFAFSA\b|Federal Student Aid/, ["studentaid.gov", "ed.gov"]],
  [/HealthCare\.gov/, ["healthcare.gov"]],
  [/Medicare\.gov/, ["medicare.gov"]],
  [/Medicaid\.gov/, ["medicaid.gov"]],
  [/TreasuryDirect/, ["treasurydirect.gov"]],
  [/USA\.gov/, ["usa.gov"]],
  [/Benefits\.gov/, ["benefits.gov"]],
];

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

/**
 * A figure that reached a currency or percent slot without a formatter: seven
 * or more ungrouped digits behind a `$` or in front of a `%`. Seven, because
 * `Intl` groups at four and a real formatted figure never runs that far
 * without a separator.
 */
const UNFORMATTED_READING = /\$\d{7,}|\d{7,}(?:\.\d+)?\s*%/;

/**
 * A horizon that reached the screen past every ceiling the engines enforce.
 *
 * The sibling check above covers currency and percent slots, which is where a
 * formatter is obviously missing. It does not cover the third kind of reading
 * this catalog prints — a span of time — and that turned out to be the one with
 * real bugs behind it, because a horizon is not merely unformatted when it runs
 * long: it is **clamped**, silently, and then quoted back at full length beside
 * an answer computed from the clamp.
 *
 * Five tiles did exactly that. `?yrs=500` on the life-insurance tile multiplied
 * an income by 100 years and headed the product "Income replacement (500 yr)";
 * `rent-vs-buy` compared 100 years of renting and buying under "over
 * 1000000000000000 years"; `college-cost`, `sinking-fund` and `peace-of-mind`
 * each did the same with their own field. `compound-growth` was the odd one:
 * it clamps `years × periodsPerYear` at `MAX_PERIODS` rather than years at
 * `MAX_YEARS`, so its real ceiling moved with the contribution frequency —
 * 5,000 years monthly, 60,000 annually — and neither is a horizon anyone should
 * be shown.
 *
 * Five ungrouped digits, because `MAX_HORIZON_MONTHS` is 1,200 and `MAX_YEARS`
 * is 100: no honest reading here reaches five digits, and a formatted one would
 * carry a separator before it did.
 */
const UNCLAMPED_HORIZON = /(?<![.,\d])\d{5,}(?:\.\d+)?\s?(?:years?|yrs?|months?|mos?)/i;

/**
 * Tiles allowed to send an unformatted figure to a currency or percent slot.
 *
 * **It is empty, and that is the assertion.** The list ran to thirteen names on
 * 2026-09-05, every one of them a tile that dropped a number into a string
 * without a formatter, and it came down in three passes rather than one:
 *
 *   - `fplPercentText` printed `6265664160401% FPL` on four surfaces at once —
 *     the ACA tile, the poverty-line tile, the Medicaid tile and the screener.
 *   - `pct`, the percentage helper the whole catalog renders answers through,
 *     printed the Child Tax tile's effective rate on unearned income as
 *     `3699999999500002304.0%`. Both built their strings with `toFixed`, which
 *     rounds and does not group.
 *   - `spending-plan` printed `99.97999999999999%`, which was floating-point
 *     subtraction reaching the screen rather than a formatting miss, and is
 *     rounded where it is computed.
 *
 * The four that survived were excused on the grounds that they only echo a rate
 * the reader typed, which is unformatted but is also just their own number. It
 * was a fair description and a bad excuse: `1000000000000000% appreciation` is
 * the reader's own number the way a wall of digits is a sentence. Fourteen
 * labels across seven tiles interpolated a raw rate field, and they render
 * through {@link pctPoints} now — which groups and trims rather than padding,
 * so every rate a person would type prints exactly as it did before.
 *
 * The dead-entry branch below is kept for the next name that lands here: an
 * allowlist whose entries are never re-checked is the failure mode of every
 * allowlist in this repo, and an empty one is the only kind that cannot rot.
 */
const UNFORMATTED_ALLOWED: Record<string, string> = {};

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

      it("keeps a currency, percent or horizon reading in range under mixed magnitudes", () => {
        // Two blind spots, both found on 2026-09-05 by a bug that walked
        // through this sweep untouched.
        //
        // The first is that setting every field to the same magnitude cancels
        // in a ratio: savings ÷ spending is 1 whether both are 1e308 or both
        // are 1. The interesting input is a *mix*, so each field in turn is
        // made tiny while the rest are huge, and the reverse.
        //
        // The second is that the assertion above only looks for NaN and
        // Infinity. A finite absurdity passes it — the Peace of Mind dashboard
        // printed "would stretch it to 100000000000000000.0 months" for months
        // on end, finite and therefore invisible here. So this asks a different
        // question: a figure in a slot that is meant to be formatted must
        // still be formatted. Seven ungrouped digits behind a `$` or in front
        // of a `%` is a number that went to the screen without passing through
        // a formatter.
        //
        // The names in ALLOWED are a description of the catalog, not a debt —
        // see the constant. What this holds is that the list does not grow.
        const clean = mount(tile, new URLSearchParams());
        const names = [...clean.querySelectorAll<HTMLInputElement>('input[type="number"]')]
          .map((i) => i.name || i.id.replace(/^f-/, ""))
          .filter((n) => n.length > 0);
        if (names.length < 2) return;

        const offenders: string[] = [];
        const horizons: string[] = [];
        for (let i = 0; i < names.length; i++) {
          for (const [small, big] of [
            ["0.01", "1e15"],
            ["1e15", "0.01"],
          ] as const) {
            const params = new URLSearchParams();
            names.forEach((n, j) => params.set(n, j === i ? small : big));
            let root: HTMLElement;
            try {
              root = mount(tile, params);
            } catch {
              // Throwing is the neighbouring test's assertion, not this one's.
              continue;
            }
            const text = (root.textContent ?? "").replace(/\s+/g, " ");
            const near = (at: number): string => text.slice(Math.max(0, at - 40), at + 30);
            const hit = UNFORMATTED_READING.exec(text);
            if (hit) offenders.push(near(hit.index));
            const horizon = UNCLAMPED_HORIZON.exec(text);
            if (horizon) horizons.push(near(horizon.index));
          }
        }
        // The horizon half is asserted outside the allowlist on purpose. The
        // allowlist excuses a *tile*, not a pattern, and two of the four names
        // on it — `rent-vs-buy` and `college-cost` — were quoting an unclamped
        // horizon the whole time behind an excuse written about a percent echo.
        expect(
          horizons.slice(0, 1),
          `${tile.id} quoted a horizon past the ceiling its engine computed with`,
        ).toEqual([]);
        if (UNFORMATTED_ALLOWED[tile.id]) {
          // A tile on the list that has stopped offending should come off it,
          // for the same reason a dead allowlist entry anywhere else here does:
          // it is a standing pass for something nobody is looking at.
          expect(
            offenders.length,
            `${tile.id} is on UNFORMATTED_ALLOWED and no longer needs to be — remove it`,
          ).toBeGreaterThan(0);
          return;
        }
        expect(
          offenders.slice(0, 1),
          `${tile.id} sent an unformatted figure to a currency, percent or horizon slot`,
        ).toEqual([]);
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
 * The other door into a tile (SPEC-3 §2.3, the half that had no sweep).
 *
 * Everything above drives a tile through its form and its fragment, which is
 * where `parseNonNegative` clamps. A **restored profile** reaches the same
 * tiles without passing that boundary at all: the portable profile file and the
 * Standing Ledger both call `SituationStore.load`, and a tile reads its
 * defaults straight out of the store. So the sweep that proves no crafted link
 * can blank a page proved nothing about a crafted file.
 *
 * A file is the stronger of the two doors, too. A link carries one tile's
 * fields; a file carries a whole situation at once, which is how `1e308` in
 * every value found the Downshift tile — two figures large enough that their
 * product overflowed, `Money.from` threw a `RangeError`, and the tile rendered
 * nothing. And a file carries *lists*: fifty thousand debts took Debt Freedom
 * past eight seconds and twelve thousand DOM nodes, and the worker running this
 * suite died rather than finishing the mount.
 */
describe("every calculator survives a restored profile", () => {
  const KEYS = [
    "householdSize",
    "annualIncome",
    "preTaxContributions",
    "retirementContributionsAnnual",
    "employerMatchAnnual",
    "employerMatchCaptured",
    "essentialMonthlyExpenses",
    "totalMonthlyExpenses",
    "liquidSavings",
    "qualifiedTipsAnnual",
    "qualifiedOvertimeAnnual",
  ] as const;

  /** A profile as a hostile file would leave it, restored through the real path. */
  function restored(value: number, rows: number): SituationStore {
    const store = new SituationStore();
    const values: Record<string, unknown> = {
      filingStatus: "single",
      stateCode: "CA",
      ages: Array.from({ length: rows }, () => 40),
      debts: Array.from({ length: rows }, (_, i) => ({
        name: `d${i}`,
        balance: value,
        ratePct: 20,
      })),
    };
    for (const key of KEYS) values[key] = value;
    store.load({ values, sources: {} } as never);
    return store;
  }

  for (const [label, value, rows] of [
    ["magnitudes that overflow a product", 1e308, 4],
    ["negative magnitudes", -1e308, 4],
    ["lists longer than any household's", 1e15, 50_000],
  ] as const) {
    it(`mounts against ${label} without throwing or hanging`, () => {
      const profile = restored(value, rows);
      for (const tile of CALCULATORS) {
        const root = document.createElement("div");
        expect(
          () =>
            tile.mount!({
              root,
              params: new URLSearchParams(),
              setParams: () => {},
              permalink: () => "https://enklayve.com/#/x",
              navigate: () => {},
              locale: "en-US",
              data,
              profile,
            } as TileContext),
          `${tile.id} threw on a restored profile — a shared file must never blank the page`,
        ).not.toThrow();
        expect(root.textContent ?? "", `${tile.id} painted a non-finite value`).not.toMatch(
          NON_FINITE,
        );
      }
    }, 60_000);
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

      it("credits the agency that actually published the page", () => {
        // The whole reason a reader trusts one of these links before opening it
        // is the agency named beside it. On 2026-09-03 three did not match:
        // "CFPB, life insurance basics" pointed at NAIC, "DOL: COBRA
        // continuation coverage" pointed at Cornell's LII, and four
        // "Benefits.gov" links pointed at USA.gov, which is where benefits.gov
        // now redirects. Nothing was broken and nothing 404'd — the label was
        // simply about a different publisher than the page, which no link check
        // can see, because both halves are individually fine.
        for (const r of [...(tile.resources ?? []), ...(tile.channels ?? [])]) {
          const host = new URL(r.url).hostname;
          for (const [name, hosts] of AGENCY_HOSTS) {
            if (!name.test(r.label)) continue;
            expect(
              hosts.some((h) => host === h || host.endsWith(`.${h}`)),
              `${tile.id}: "${r.label}" is credited to a publisher that does not serve ${host}`,
            ).toBe(true);
          }
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

      it("writes a link that comes back to the same answer", () => {
        // The test above proves `setParams` was CALLED. It cannot tell a link
        // that carries the reading from one that carries half of it, and half a
        // link is the worse failure of the two: it opens, it looks like the
        // tool, and it shows the reader something other than what the sender
        // saw. Peace of Mind shipped exactly that — it kept its essentials,
        // total spending and liquid savings in the session profile alone, so
        // the URL it wrote next to "$12,000 covers 3.8 months" reopened on
        // "Add your essential monthly expenses below", and the sender's own
        // reload did the same. Every other Safe Harbor tile already read the
        // param first and fell back to the profile; nothing held that.
        //
        // So: press the example, take the link the tile wrote, and open it in a
        // fresh mount with an EMPTY profile — which is what a recipient has.
        const first = document.createElement("div");
        let written = new URLSearchParams();
        const ctx = (root: HTMLElement, params: URLSearchParams): TileContext =>
          ({
            root,
            params,
            setParams: (p: URLSearchParams) => {
              written = new URLSearchParams(p);
            },
            permalink: () => "https://enklayve.com/#/x",
            navigate: () => {},
            locale: "en-US",
            data,
            profile: new SituationStore(),
          }) as TileContext;

        tile.mount!(ctx(first, new URLSearchParams()));
        [...first.querySelectorAll("button")]
          .find((b) => /try an example/i.test(b.textContent ?? ""))
          ?.click();

        const second = document.createElement("div");
        tile.mount!(ctx(second, new URLSearchParams(written)));

        // Compare the ANSWER, not the form: the inputs are what the link is
        // supposed to restore, and reading them back would let a tile pass by
        // restoring the boxes while computing from something else.
        const shown = (host: HTMLElement): string => {
          const clone = host.cloneNode(true) as HTMLElement;
          for (const form of clone.querySelectorAll("form")) form.remove();
          return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
        };
        expect(
          shown(second),
          `${tile.id}: its own link (?${written.toString()}) reopens on a different answer`,
        ).toBe(shown(first));
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

describe("every calculator announces its answer", () => {
  for (const tile of CALCULATORS) {
    it(`${tile.id} puts its result inside a live region`, () => {
      // axe cannot catch this, because it is an absence rather than a
      // violation. A calculator recomputes as the reader types, replacing its
      // result in place — and a screen-reader user who types an income and
      // hears nothing has no way to know the page answered them.
      //
      // Two independent mechanisms satisfy it today. Fifty-eight tiles get it
      // twice over, from `resultCard`'s headline `<output>` and from their own
      // `.tile-result` container; the eight Pillar 4 screeners, which have no
      // single headline number, get it from the container alone. This asserts
      // the property rather than either mechanism, so a tile is free to arrive
      // with only one of them and not free to arrive with neither.
      const root = mount(tile, new URLSearchParams());
      const example = [...root.querySelectorAll("button")].find((b) =>
        /try an example/i.test(b.textContent ?? ""),
      );
      example?.click();

      const live = [...root.querySelectorAll("[aria-live]")];
      expect(live.length, `${tile.id} renders its result with no live region`).toBeGreaterThan(0);

      // And the region has to contain something once there is an answer — a
      // live region on an element that never holds the result announces
      // nothing, which is the failure that looks exactly like success.
      const announced = live.some((el) => (el.textContent ?? "").trim().length > 0);
      expect(announced, `${tile.id}'s live region is empty after computing`).toBe(true);
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
