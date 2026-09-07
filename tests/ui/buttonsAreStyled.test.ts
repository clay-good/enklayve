import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SUB_TOOLS, TILES } from "../../src/tiles/registry";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import type { TileContext, TileDefinition } from "../../src/tiles/types";

/**
 * Every button this site draws is a button this site styled.
 *
 * `deadStyles.test.ts` asks the question one way round — a rule in the
 * stylesheet that nothing can reach. This is the other way, and it is the one a
 * reader sees: a class the code puts on a control that the stylesheet has never
 * heard of. Nothing breaks, nothing is blank, and the control renders as the
 * browser's own default in the middle of a designed page.
 *
 * Three had shipped that way on 2026-09-07. Pell's "Estimate my SAI" and the
 * Auto Loan's "Deduct this interest" carried `btn-secondary`, which is not a
 * class this stylesheet has (its buttons are `btn` plus `btn--accent` or
 * `btn--ghost`), and the Bill Triage's "Add a bill" carried `row-add`, while
 * the same add-a-row affordance in Cash Flow, Debt Freedom and the Lot Picker
 * carries `btn btn--ghost`. Measured in Chromium: **21 pixels tall, grey, with
 * an `outset` border and square corners, beside a 42-pixel amber button** —
 * and 21 pixels is less than half the 44-pixel touch target the responsive
 * suite holds every hub to.
 *
 * The rule is "carries at least one class the stylesheet styles" rather than
 * "every class is styled", because a class can honestly be a hook:
 * `plan-add-debt` is on three add-a-row buttons that are also `btn btn--ghost`,
 * and it exists for the tests and the DOM rather than for the eye.
 */
let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

afterEach(() => {
  document.body.replaceChildren();
});

/** Every class name the stylesheet mentions in any selector. */
const STYLED = (() => {
  const css = readFileSync(resolve(__dirname, "..", "..", "src", "styles.css"), "utf8");
  return new Set([...css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]!));
})();

const MOUNTABLE = [...TILES, ...SUB_TOOLS.map(({ tile }) => tile)].filter((t) => t.mount);

function buttonsOf(tile: TileDefinition): { label: string; classes: string[] }[] {
  const root = document.createElement("div");
  tile.mount!({
    root,
    params: new URLSearchParams(),
    setParams: () => {},
    permalink: () => "https://enklayve.com/#/x",
    navigate: () => {},
    locale: "en-US",
    data,
    profile: new SituationStore(),
  } as TileContext);
  // Buttons that only exist beside an answer — the Auto Loan's handoff to the
  // car-loan-interest deduction is one — appear only once there is an answer.
  [...root.querySelectorAll("button")]
    .find((b) => /try an example/i.test(b.textContent ?? ""))
    ?.click();
  return [...root.querySelectorAll("button")].map((b) => ({
    label: (b.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40),
    classes: [...b.classList],
  }));
}

describe("every button the catalog draws is styled", () => {
  it("read the stylesheet's class names", () => {
    // A parse that returned nothing would call every button unstyled, or an
    // empty set would call every button fine, depending on the sense.
    expect(STYLED.size).toBeGreaterThan(100);
    expect(STYLED.has("btn")).toBe(true);
    expect(STYLED.has("btn--ghost")).toBe(true);
    expect(STYLED.has("btn-secondary"), "the dead class is back in the stylesheet").toBe(false);
  });

  it("mounts a catalog to sweep", () => {
    expect(MOUNTABLE.length).toBeGreaterThan(60);
  });

  it("gives every button at least one class the stylesheet knows", () => {
    const naked: string[] = [];
    for (const tile of MOUNTABLE) {
      for (const b of buttonsOf(tile)) {
        if (b.classes.some((c) => STYLED.has(c))) continue;
        naked.push(`${tile.id}: "${b.label}" [${b.classes.join(" ") || "no class at all"}]`);
      }
    }
    expect(
      [...new Set(naked)].sort(),
      "this button renders as the browser's own default in the middle of a designed page — " +
        "give it `btn` plus `btn--accent` or `btn--ghost`, the way every other button here has",
    ).toEqual([]);
  });
});
