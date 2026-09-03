import { describe, it, expect, beforeAll } from "vitest";
import { SUB_TOOLS } from "../../src/tiles/registry";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import type { TileContext, TileDefinition } from "../../src/tiles/types";

/**
 * A column a reader can add up.
 *
 * Every figure on this site is rounded to cents for display, and rounding each
 * line on its own is correct line by line and wrong as a column:
 * `sum(round(xᵢ))` and `round(sum(xᵢ))` differ by a cent often enough to be
 * seen. Take-Home was off in roughly one case in fourteen — New York at
 * $123,456 showed a column of $34,051.47 under a total reading $34,051.48 — and
 * the same defect was in Self-Employment Tax and Quarterly Taxes. On a site
 * whose whole claim is that its arithmetic can be checked, arithmetic that does
 * not check is the worst possible bug: a reader who adds the column and gets a
 * different answer has no way to know which number to trust, and is right not
 * to trust either.
 *
 * **How this finds one without being told where the totals are.** A run of
 * consecutive money rows that sums to WITHIN A FEW CENTS of a later row, but
 * not exactly, is a total whose parts were rounded independently. Rows that are
 * not addends of each other miss by dollars, not by cents, so they never look
 * like this — which is what lets the sweep read every calculator without a
 * hand-kept list of which lines are supposed to add up. That list is the thing
 * that would go stale the day a tile gains a line.
 *
 * Each tile is checked at its worked example and at four perturbed incomes,
 * because a cent of disagreement is a property of the particular numbers: the
 * Take-Home bug is invisible at most incomes and plain at $123,456.
 */
let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

/** A displayed money value in whole cents, or null if the cell is not money. */
export function displayedCents(text: string): number | null {
  const trimmed = text.trim();
  if (!/^-?\$[\d,]+(\.\d\d)?$/.test(trimmed)) return null;
  return Math.round(Number(trimmed.replace(/[^0-9.-]/g, "")) * 100);
}

/** Runs of money rows that nearly, but not exactly, add to a later row. */
export function nearMisses(
  rows: { label: string; value: number | null }[],
  tolerance = 3,
): string[] {
  const out: string[] = [];
  for (const [i, row] of rows.entries()) {
    if (row.value === null) continue;
    for (let start = 0; start < i; start += 1) {
      const run = rows.slice(start, i);
      if (run.length < 2 || run.some((r) => r.value === null)) continue;
      const off = Math.abs(run.reduce((a, r) => a + (r.value ?? 0), 0) - row.value);
      if (off > 0 && off <= tolerance) {
        out.push(`"${row.label}" is ${off}c from ${run.map((r) => r.label).join(" + ")}`);
      }
    }
  }
  return out;
}

function rowsOf(
  tile: TileDefinition,
  perturb: number | null,
): { label: string; value: number | null }[] {
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
  [...root.querySelectorAll("button")]
    .find((b) => /try an example/i.test(b.textContent ?? ""))
    ?.click();
  if (perturb !== null) {
    // The largest field the example filled: for a tax tile that is the income,
    // which is what moves every line in the column at once.
    const target = [...root.querySelectorAll<HTMLInputElement>('input[type="number"]')].find(
      (i) => Number(i.value) > 1000,
    );
    if (!target) return [];
    target.value = String(perturb);
    target.dispatchEvent(new Event("input", { bubbles: true }));
  }
  return [...root.querySelectorAll(".bd-row")].map((r) => ({
    label: r.querySelector(".bd-label")?.textContent ?? "",
    value: displayedCents(r.querySelector(".bd-value")?.textContent ?? ""),
  }));
}

describe("finding a column that does not add up", () => {
  it("flags a run that misses by a cent, and ignores rows that are not addends", () => {
    expect(
      nearMisses([
        { label: "a", value: 1000 },
        { label: "b", value: 2050 },
        { label: "total", value: 3051 },
      ]),
    ).toEqual(['"total" is 1c from a + b']);
    // Exact is silence.
    expect(
      nearMisses([
        { label: "a", value: 1000 },
        { label: "b", value: 2050 },
        { label: "total", value: 3050 },
      ]),
    ).toEqual([]);
    // Rows that have nothing to do with each other miss by dollars.
    expect(
      nearMisses([
        { label: "a", value: 1000 },
        { label: "b", value: 2050 },
        { label: "unrelated", value: 99_999 },
      ]),
    ).toEqual([]);
  });
});

describe("every calculator's breakdown adds up", () => {
  for (const { tile } of SUB_TOOLS) {
    if (!tile.mount) continue;
    it(`${tile.id} shows no column that misses by a cent`, () => {
      const problems: string[] = [];
      for (const perturb of [null, 123_457, 37_777, 91_913, 250_001]) {
        for (const miss of nearMisses(rowsOf(tile, perturb))) {
          problems.push(`${perturb === null ? "example" : `at ${perturb}`}: ${miss}`);
        }
      }
      expect([...new Set(problems)]).toEqual([]);
    }, 20_000);
  }
});
