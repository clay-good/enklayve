import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { SUB_TOOLS } from "../../src/tiles/registry";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import type { TileContext, TileDefinition } from "../../src/tiles/types";

/**
 * A shared link says the same thing to everyone who opens it.
 *
 * Every calculator resolves its starting values with one precedence — URL
 * fragment > session profile > built-in default (BUILD-SPEC-2 §3) — and that
 * rule has a sharp edge nothing was holding. A field the fragment leaves out is
 * not restored to its default; it is handed to the READER's My Situation. So a
 * calculator that omits a field from the link whenever it is zero, or whenever
 * a box is unticked, is not saving URL bytes. It is deleting the sender's
 * answer and letting the reader's profile answer in its place, silently, with a
 * different number on screen.
 *
 * Five of those were live on 2026-09-07, and every one of them turned a stated
 * "no" into somebody else's "yes":
 *
 *   - **Take-Home** dropped `adj`, `tips` and `ot` at zero. All three fall back
 *     to My Situation, which the Readout fills from a dropped W-2 (box 12 codes
 *     TP and TT). A reader who had ever dropped one in opened the sender's link
 *     with the sender's wages, their own tips, their own overtime and their own
 *     pre-tax adjustments, and a take-home figure the sender never saw.
 *   - **Life Insurance** dropped `debt` and `assets` at zero, which fall back to
 *     the reader's recorded debts and liquid savings. The tile subtracts assets
 *     from the gap and adds debts to it, so the coverage it recommends moved in
 *     both directions at once.
 *   - **EITC**, the **What Am I Owed screener** and the **Child Tax Estimator**
 *     wrote `mfj` only when the box was ticked. Unticked meant "not a joint
 *     return"; absent meant "ask the reader's filing status", and for a married
 *     reader that is the opposite answer on a credit whose phase-out is
 *     thousands of dollars wider on a joint return.
 *
 * Education Credits and the Retirement Optimizer already wrote theirs at zero,
 * each after the same bug was found by hand in that one tile. This is the
 * corridor rather than the two doors: the property is checked for every
 * calculator in the catalog, in two states, so the next tile to omit a field
 * that My Situation answers fails here instead of shipping.
 *
 * **Why two readers rather than sender-vs-reader.** The invariant is that the
 * link, not the reader, decides — so the check opens the same link twice, once
 * with an empty profile and once with a full one, and compares the two links
 * that come back. Reading it against the sender's own link instead would drag
 * in a defect of the test environment: happy-dom 20.9 puts a freshly built
 * `<select>` on its *second* option whatever any option's `selected` says, so
 * no unit test in this repo can see what a fragment restores into a dropdown.
 * Opening twice cancels that out — both readers land on the same wrong option —
 * and the dropdowns are held in a real browser by the Playwright suite.
 */
let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

afterEach(() => {
  document.body.replaceChildren();
});

const CALCULATORS = SUB_TOOLS.map(({ tile }) => tile).filter((t) => t.mount);

/**
 * A reader whose My Situation has an answer to every shared question, and a
 * different one each time, so a leak names the field it came from.
 */
function furnishedProfile(): SituationStore {
  const p = new SituationStore();
  p.set("filingStatus", "married_jointly");
  p.set("stateCode", "NY");
  p.set("householdSize", 7);
  p.set("qualifyingChildren", 5);
  p.set("annualIncome", 123456);
  p.set("qualifiedTipsAnnual", 1234);
  p.set("qualifiedOvertimeAnnual", 2345);
  p.set("preTaxContributions", 3456);
  p.set("retirementContributionsAnnual", 4567);
  p.set("employerMatchAnnual", 5678);
  p.set("employerMatchCaptured", 678);
  p.set("essentialMonthlyExpenses", 3210);
  p.set("totalMonthlyExpenses", 4321);
  p.set("liquidSavings", 54321);
  p.set("debts", [{ name: "Card", balance: 9876, ratePct: 22 }]);
  return p;
}

function open(tile: TileDefinition, params: URLSearchParams, profile: SituationStore) {
  const root = document.createElement("div");
  let link: URLSearchParams | null = null;
  tile.mount!({
    root,
    params,
    setParams: (p: URLSearchParams) => {
      link = p;
    },
    permalink: () => "https://enklayve.com/#/x",
    navigate: () => {},
    locale: "en-US",
    data,
    profile,
  } as TileContext);
  return { root, link: () => link };
}

/** Tiles write their link on a control event, so one is needed to read it. */
function nudge(control: HTMLElement): void {
  control.dispatchEvent(new Event("input", { bubbles: true }));
  control.dispatchEvent(new Event("change", { bubbles: true }));
}

function readable(link: URLSearchParams): string {
  return [...link.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("&");
}

/**
 * Build a link from one tile, then open it as two different people.
 *
 * `zeroed` is the state the bug lives in: every number typed to 0 and every
 * checkbox flipped out of its example position, which is the reader saying "no"
 * to each question in the only way the interface offers.
 */
function reopenedTwice(tile: TileDefinition, zeroed: boolean): string[] {
  const sender = open(tile, new URLSearchParams(), new SituationStore());
  [...sender.root.querySelectorAll("button")]
    .find((b) => /try an example/i.test(b.textContent ?? ""))
    ?.click();
  const inputs = [...sender.root.querySelectorAll<HTMLInputElement>("input")];
  if (zeroed) {
    for (const c of inputs) {
      if (c.type === "checkbox") c.checked = !c.checked;
      else if (c.type === "number") c.value = "0";
      else continue;
      nudge(c);
    }
  } else if (inputs[0]) {
    nudge(inputs[0]);
  }
  const shared = sender.link();
  if (!shared) return [`${tile.id}: never wrote a link to share`];

  const reopened = [new SituationStore(), furnishedProfile()].map((profile) => {
    const reader = open(tile, new URLSearchParams(shared.toString()), profile);
    const first = reader.root.querySelector<HTMLInputElement>("input");
    if (first) nudge(first);
    return reader.link();
  });
  const [stranger, neighbor] = reopened;
  if (!stranger || !neighbor) return [`${tile.id}: the reopened link wrote nothing back`];
  if (readable(stranger) === readable(neighbor)) return [];
  return [
    `${tile.id} (${zeroed ? "every answer zeroed" : "the example"}):\n` +
      `      empty My Situation: ${readable(stranger)}\n` +
      `      full  My Situation: ${readable(neighbor)}`,
  ];
}

describe("a shared link says the same thing to everyone", () => {
  it("has a catalog to sweep", () => {
    expect(CALCULATORS.length).toBeGreaterThan(60);
  });

  for (const zeroed of [false, true]) {
    it(`reopens on the sender's answers, not the reader's profile (${
      zeroed ? "every answer zeroed" : "the example"
    })`, () => {
      const leaks = CALCULATORS.flatMap((tile) => reopenedTwice(tile, zeroed));
      expect(
        leaks,
        "this tile's link means different things to two readers, so a field it left out is " +
          "being answered by whoever opens it — write the field even when it is zero or " +
          "unticked, the way take-home, life-insurance, eitc, ctc and screener do",
      ).toEqual([]);
    });
  }
});
