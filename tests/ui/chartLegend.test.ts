import { describe, it, expect, beforeAll } from "vitest";
import { donutChart, allocatePercents } from "../../src/ui/charts";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import { SUB_TOOLS } from "../../src/tiles/registry";
import type { TileContext } from "../../src/tiles/types";
import { displayedCents, moneyRows } from "./columnsAddUp.test";

/**
 * A chart legend is a column.
 *
 * It is a list of parts of one stated whole, printed one under the other, and a
 * reader adds it up for the same reason they add up a breakdown table: to check
 * the site's arithmetic against their own. Both of its columns were rounded row
 * by row, so both could miss — the amounts by a cent, the percents by a point —
 * and the `.bd-row` sweep could not see either, because a legend is not a
 * `.bd-row`.
 *
 * Quarterly Taxes showed all three defects at once at $37,777 of net profit:
 * four legend amounts summing to $37,776.99 beside a "Net business profit" row
 * reading $37,777.00, four percents summing to 99, and — for anyone in a
 * Maryland county — a ring whose whole silently excluded their county tax.
 */
let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

describe("allocatePercents", () => {
  it("gives the spare points to the shares that rounded down hardest", () => {
    // 33.33% three ways: floors to 33+33+33 = 99, so one share gets the point.
    expect(allocatePercents([1, 1, 1], 3)).toEqual([34, 33, 33]);
    // The Quarterly Taxes shape: 14 + 5 + 1 + 79 = 99 before allocation.
    const p = allocatePercents([5337.72, 2032.98, 540.02, 29866.29], 37_777.01);
    expect(p.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("is exact when every share is already whole", () => {
    expect(allocatePercents([50, 30, 20], 100)).toEqual([50, 30, 20]);
  });

  it("claims nothing when there is no whole to divide", () => {
    expect(allocatePercents([0, 0], 0)).toEqual([0, 0]);
  });

  it("allocates to a target other than 100 when the caller states one", () => {
    // The Quarterly Taxes ring: its tax slices must add to the share printed in
    // its hole, not to a whole of their own.
    expect(allocatePercents([1, 1, 1], 3, 29).reduce((a, b) => a + b, 0)).toBe(29);
    expect(allocatePercents([5337.72, 2032.98, 540.02], 7910.72, 21)).toEqual([14, 5, 2]);
    expect(allocatePercents([1, 1], 2, 0)).toEqual([0, 0]);
  });
});

/** The legend's own text, one row at a time. */
function legendRows(root: Element): { amount: number | null; pct: number }[] {
  return [...root.querySelectorAll(".legend-item")].map((li) => ({
    amount: displayedCents(li.querySelector(".legend-value")?.textContent ?? ""),
    pct: Number((li.querySelector(".legend-pct")?.textContent ?? "").replace("%", "")),
  }));
}

describe("a donut legend adds up to its own whole", () => {
  // Splits chosen so that rounding each row on its own misses: thirds of a
  // dollar amount that is not divisible by three, and a repeating percent.
  const cases: number[][] = [
    [100 / 3, 100 / 3, 100 / 3],
    [5337.715, 2032.984, 540.019, 29866.292],
    [1, 2, 3, 4, 5, 6, 7],
    [0.005, 0.005, 0.99],
  ];
  for (const values of cases) {
    it(`${values.length} slices of ${values.reduce((a, b) => a + b, 0).toFixed(3)}`, () => {
      const total = values.reduce((a, b) => a + b, 0);
      const chart = donutChart({
        slices: values.map((value, i) => ({ label: `s${i}`, value })),
        locale: "en-US",
        ariaLabel: "test",
      });
      const rows = legendRows(chart);
      expect(rows.reduce((a, r) => a + (r.amount ?? 0), 0)).toBe(Math.round(total * 100));
      expect(rows.reduce((a, r) => a + r.pct, 0)).toBe(100);
    });
  }

  it("shows nothing but zeros when the whole is zero", () => {
    const chart = donutChart({
      slices: [
        { label: "a", value: 0 },
        { label: "b", value: 0 },
      ],
      locale: "en-US",
      ariaLabel: "test",
    });
    expect(legendRows(chart).map((r) => r.pct)).toEqual([0, 0]);
  });
});

/** Mount a tile, run its worked example, and return its root. */
function mounted(id: string, tweak?: (root: HTMLElement) => void): HTMLElement {
  const tile = SUB_TOOLS.find((t) => t.tile.id === id)!.tile;
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
  } as unknown as TileContext);
  [...root.querySelectorAll("button")]
    .find((b) => /try an example/i.test(b.textContent ?? ""))
    ?.click();
  tweak?.(root);
  return root;
}

describe("Quarterly Taxes: the ring covers every tax the breakdown lists", () => {
  it("gives a Maryland county its own slice", () => {
    const root = mounted("quarterly-taxes", (r) => {
      const state = r.querySelector<HTMLSelectElement>("select[name='st']");
      if (state) {
        state.value = "md";
        state.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const county = r.querySelector<HTMLSelectElement>("select[name='loc-select']");
      if (county) {
        county.value = "md-allegany";
        county.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    const labels = [...root.querySelectorAll(".legend-label")].map((e) => e.textContent ?? "");
    expect(labels.some((l) => /Allegany County local tax/.test(l))).toBe(true);
    // And the ring's whole is the income, not the income less the county tax:
    // every share still sums to 100 with the extra slice present.
    expect(legendRows(root).reduce((a, r) => a + r.pct, 0)).toBe(100);
  });

  it("prints a legend a reader can add up at the income that used to break it", () => {
    const root = mounted("quarterly-taxes", (r) => {
      const profit = [...r.querySelectorAll<HTMLInputElement>('input[type="number"]')].find(
        (i) => Number(i.value) > 1000,
      )!;
      profit.value = "37777";
      profit.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const legend = legendRows(root);
    expect(legend.length).toBeGreaterThan(2);
    expect(legend.reduce((a, r) => a + (r.amount ?? 0), 0)).toBe(3_777_700);
    expect(legend.reduce((a, r) => a + r.pct, 0)).toBe(100);
    // The same figure the sweep compares it against, on the page beside it.
    expect(moneyRows(root).some((r) => r.value === 3_777_700)).toBe(true);
  });
});

/**
 * A figure that contradicts itself at a glance.
 *
 * The Quarterly Taxes ring states a share in its hole — "30% to taxes" — over a
 * legend that names each tax and its share. Those were three separate roundings
 * of one split: the hole from the exact rate, each legend percent from its own
 * slice, and the "Set aside this share of every payment" row from the exact
 * rate again at one decimal. In 5 of 42 combinations the hole and the legend
 * column disagreed outright (30% above 14 + 11 + 4); allocating the legend to a
 * whole of its own fixed that and moved the disagreement to the breakdown row
 * instead, 29% under 29.6%, in 27 of 312.
 *
 * There is one rounding now. The hole rounds the rate once; the tax slices are
 * allocated to that number; "what you keep" is the remainder to 100.
 */
describe("the Quarterly Taxes ring agrees with itself", () => {
  function render(stateCode: string, profit: number): HTMLElement {
    return mounted("quarterly-taxes", (r) => {
      const state = r.querySelector<HTMLSelectElement>("select[name='st']")!;
      state.value = stateCode;
      state.dispatchEvent(new Event("change", { bubbles: true }));
      const np = r.querySelector<HTMLInputElement>('input[name="np"]')!;
      np.value = String(profit);
      np.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  const numeric = (text: string): number => Number(text.replace("%", ""));

  it("prints the same share in the hole, in the legend, and in the breakdown", () => {
    const off: string[] = [];
    for (const stateCode of ["", ...data.stateCodes()]) {
      for (const profit of [18_000, 37_777, 61_111, 95_000, 123_457, 250_001]) {
        const root = render(stateCode, profit);
        const hole = numeric(root.querySelector(".donut-total")?.textContent ?? "");
        const items = [...root.querySelectorAll(".legend-item")];
        const taxes = items
          .filter((li) => !/keep/i.test(li.querySelector(".legend-label")?.textContent ?? ""))
          .reduce((a, li) => a + numeric(li.querySelector(".legend-pct")?.textContent ?? ""), 0);
        const all = items.reduce(
          (a, li) => a + numeric(li.querySelector(".legend-pct")?.textContent ?? ""),
          0,
        );
        const row = [...root.querySelectorAll(".bd-row")].find((r) =>
          /Set aside this share/.test(r.textContent ?? ""),
        );
        const exact = numeric(row?.querySelector(".bd-value")?.textContent ?? "");
        const where = `${stateCode || "no state"} at ${profit}`;
        if (taxes !== hole) off.push(`${where}: hole ${hole}% vs legend ${taxes}%`);
        if (all !== 100) off.push(`${where}: legend sums to ${all}%`);
        if (Math.abs(exact - hole) > 0.5) off.push(`${where}: hole ${hole}% vs row ${exact}%`);
      }
    }
    expect(off).toEqual([]);
  }, 60_000);
});
