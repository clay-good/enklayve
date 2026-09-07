import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { SUB_TOOLS } from "../../src/tiles/registry";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import type { TileContext } from "../../src/tiles/types";

/**
 * The payday marker on the cash-flow chart, which had never been drawn.
 *
 * `TimelineOptions` declared `payday`, `balanceTimeline` read it, this file's
 * stylesheet carried `.balance-col--payday`, and the chart's own doc comment
 * promised that "payday carries a small marker". The one caller never passed
 * it, so the branch was dead from the day it shipped — the same shape as
 * `PlanInput.netWorth` and `CheckContext.noSurprises` before it, and the reason
 * `declaredInputsSupplied.test.ts` now sweeps for it rather than waiting for
 * somebody to notice a fourth.
 *
 * A list of days rather than one, because this tile's own worked example is two
 * paychecks: a chart marking the 3rd and not the 17th would read as a bug.
 */
let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

afterEach(() => {
  document.body.replaceChildren();
});

function openCashFlow(): HTMLElement {
  const tile = SUB_TOOLS.map((s) => s.tile).find((t) => t.id === "cash-flow")!;
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

/** The day number under each column, and whether that column is flagged. */
function columns(root: HTMLElement): { day: string; payday: boolean }[] {
  return [...root.querySelectorAll(".balance-col")].map((col) => ({
    day: col.querySelector(".balance-day")?.textContent ?? "",
    payday: col.classList.contains("balance-col--payday"),
  }));
}

describe("the cash-flow chart marks the days money arrives", () => {
  it("flags every payday in the worked example, and only those", () => {
    const cols = columns(openCashFlow());
    expect(cols.length, "the example drew no chart at all").toBeGreaterThan(2);
    // The example is two paychecks, on the 3rd and the 17th.
    expect(cols.filter((c) => c.payday).map((c) => c.day)).toEqual(["3", "17"]);
    expect(
      cols.some((c) => !c.payday),
      "every column was called a payday",
    ).toBe(true);
  });

  it("puts the marker where a reader can see it", () => {
    const root = openCashFlow();
    const flags = [...root.querySelectorAll(".balance-flag")];
    expect(flags.length).toBe(2);
    expect(flags.every((f) => (f.textContent ?? "").toLowerCase().includes("payday"))).toBe(true);
  });
});
