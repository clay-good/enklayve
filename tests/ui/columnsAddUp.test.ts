import { describe, it, expect, beforeAll } from "vitest";
import { SUB_TOOLS } from "../../src/tiles/registry";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import type { TileContext, TileDefinition } from "../../src/tiles/types";
import { renderHome } from "../../src/ui/shell";
import { renderReport } from "../../src/ui/reportView";

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
 * **At every field, not the income.** A cent of disagreement is a property of
 * the particular numbers — the Take-Home bug is invisible at most incomes and
 * plain at $123,456 — so each tile is driven through a grid of states rather
 * than read once. The first version moved only the largest field the example
 * filled, which is the income on a tax tile and nothing at all on the three
 * tiles whose examples fill no field above $1,000. Both columns it missed were
 * moved by a different field: the Marginal Explorer's step, and Marginal
 * Reality's raise. Every numeric field now takes every perturbation in turn,
 * and every dropdown takes every option — a state's bracket schedule decides
 * where the halves fall as surely as the income does.
 *
 * **Every money figure on the page, not one CSS class.** The first version read
 * `.bd-row` — the breakdown table — and so was blind to money shown anywhere
 * else, which is the same hand-kept-list failure one level up: the sweep was
 * told where to look. It now reads every leaf element whose whole text is a
 * currency figure, in document order, which is the order a reader's eye goes
 * down the page. That widening is what found the donut legend in Quarterly
 * Taxes summing to a cent under the net profit printed beside it.
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

/**
 * Every money figure in the subtree, in document order, labelled by the row it
 * sits in. A leaf whose entire text is a currency string is a displayed amount;
 * anything else (a sentence that mentions a dollar figure, a percent, a date)
 * is not a row in a column and is skipped.
 */
export function moneyRows(root: Element): { label: string; value: number | null }[] {
  return [...root.querySelectorAll("*")]
    .filter((e) => e.children.length === 0 && displayedCents(e.textContent ?? "") !== null)
    .map((e) => ({
      label: (e.closest(".bd-row, .legend-item, li, tr, div")?.textContent ?? "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 70),
      value: displayedCents(e.textContent ?? ""),
    }));
}

/** A freshly mounted tile with its worked example filled in. */
function mounted(tile: TileDefinition): HTMLElement {
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
  return root;
}

/** The values every numeric field is driven to, one field at a time. */
const PERTURBATIONS = [123_457, 37_777, 91_913, 250_001, 13];

/**
 * Every state of a tile this sweep visits: the worked example, then each
 * numeric field driven to each perturbation with the others left alone, then
 * each option of each dropdown.
 *
 * The first version moved only "the largest field the example filled", which
 * for a tax tile is the income. That reaches the columns income moves and no
 * others, and it silently did nothing at all on the three tiles whose examples
 * fill no field above $1,000. Both defects it missed were in a field that was
 * not the income: the Marginal Explorer's step, and Marginal Reality's raise.
 */
function* states(tile: TileDefinition): Generator<{ label: string; root: HTMLElement }> {
  yield { label: "example", root: mounted(tile) };

  const count = mounted(tile).querySelectorAll('input[type="number"]').length;
  for (let i = 0; i < count; i += 1) {
    const root = mounted(tile);
    const input = [...root.querySelectorAll<HTMLInputElement>('input[type="number"]')][i]!;
    const original = input.value;
    for (const value of PERTURBATIONS) {
      input.value = String(value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      yield { label: `field ${i} at ${value}`, root };
    }
    input.value = original;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  const selects = mounted(tile).querySelectorAll("select").length;
  for (let i = 0; i < selects; i += 1) {
    const root = mounted(tile);
    const select = [...root.querySelectorAll<HTMLSelectElement>("select")][i]!;
    const original = select.value;
    for (const opt of [...select.options]) {
      select.value = opt.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      yield { label: `${select.name || `select ${i}`} = ${opt.value || "(blank)"}`, root };
    }
    select.value = original;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
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
      for (const { label, root } of states(tile)) {
        for (const miss of nearMisses(moneyRows(root))) problems.push(`${label}: ${miss}`);
      }
      expect([...new Set(problems)]).toEqual([]);
    }, 30_000);
  }
});

/**
 * The views that are not tiles.
 *
 * Sweeping `SUB_TOOLS` reaches every calculator and nothing else, and "every
 * calculator" is not the same set as "every page that prints a column". The
 * Readout Report is the clearest case: it is generated on the device, saved as
 * a file, and read months later with no calculator beside it — and it was in no
 * sweep, which is how it kept a tax column that missed its own total by a cent.
 * The home budget is here for the same reason, not because it was broken.
 */
describe("the views that have no tile", () => {
  const PROFILES: [string, [string, unknown][]][] = [
    [
      "California at $250,001",
      [
        ["annualIncome", 250_001],
        ["filingStatus", "single"],
        ["stateCode", "ca"],
        ["essentialMonthlyExpenses", 3200],
        ["liquidSavings", 12_000],
      ],
    ],
    [
      "New York at $61,111",
      [
        ["annualIncome", 61_111],
        ["filingStatus", "married_jointly"],
        ["stateCode", "ny"],
        ["essentialMonthlyExpenses", 2400],
        ["liquidSavings", 5000],
      ],
    ],
    [
      "an Allegany County, Maryland household at $95,000",
      [
        ["annualIncome", 95_000],
        ["filingStatus", "single"],
        ["stateCode", "md"],
        ["county", "md-allegany"],
        ["essentialMonthlyExpenses", 3200],
        ["liquidSavings", 12_000],
      ],
    ],
  ];

  for (const [name, entries] of PROFILES) {
    it(`the Readout Report adds up for ${name}`, () => {
      const profile = new SituationStore();
      for (const [k, v] of entries) profile.set(k as never, v as never);
      const container = document.createElement("div");
      renderReport({ container, navigate: () => {}, profile, data });
      expect(nearMisses(moneyRows(container))).toEqual([]);
    });
  }

  for (const income of [37_777, 61_111, 95_000, 123_457, 250_001]) {
    it(`the home budget adds up at ${income}`, () => {
      const container = document.createElement("div");
      renderHome(container, () => {}, data);
      const first = container.querySelector<HTMLInputElement>('input[type="number"]');
      if (first) {
        first.value = String(income);
        first.dispatchEvent(new Event("input", { bubbles: true }));
      }
      expect(nearMisses(moneyRows(container))).toEqual([]);
    });
  }
});
