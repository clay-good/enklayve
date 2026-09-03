import { describe, it, expect, beforeAll } from "vitest";
import { SUB_TOOLS } from "../../src/tiles/registry";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import { FilingStatus } from "../../src/data/schemas";
import type { TileContext } from "../../src/tiles/types";

/**
 * Nobody is dropped from the filing-status control.
 *
 * A filing status has five values and this catalog kept answering with fewer.
 * Three separate instances on 2026-09-03, three different mechanisms, one
 * audience every time — married filing separately:
 *
 *   The Education Credit Comparison asked with a joint/not-joint checkbox and
 *   handed a separate filer $2,500 that IRC §25A(g)(6) gives to nobody filing
 *   separately.
 *   The Social Security Taxation tile offered three options and documented the
 *   fourth as "left out" in a comment. §86(c)(1)(C)(ii) makes its base amount
 *   zero, so the reader who picked the nearest option was told $25,000 of
 *   provisional income was safe when the answer was $17,000 of tax.
 *   The earned income credit had already been through it with §32(d)(1), which
 *   is where `filesSeparately` came from.
 *
 * None of those was caught by a figure sweep, because no figure was wrong: the
 * schedule that ran was correct for the status it ran, and the status was not
 * the reader's. So this sweep asks a different question — whether the control
 * can express the reader — and asks it of every tile at once, which is the only
 * version that covers the tile written next week.
 */
let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

const ALL_STATUSES = FilingStatus.options;

/**
 * Tiles whose select deliberately offers fewer, each with the statute that
 * makes the omission correct rather than convenient. A tile that is merely
 * awkward to extend does not belong here.
 */
const EXPLAINED: Record<string, { missing: string[]; why: string }> = {
  "social-security-tax": {
    missing: ["qualifying_surviving_spouse"],
    why:
      "IRC §86(c)(1)(C)(i) gives a qualifying surviving spouse the same $25,000 / $34,000 base " +
      "amounts as a single filer, so the Single option is that reader's answer exactly. Adding a " +
      "fifth option that computes an identical figure would imply a distinction the statute does " +
      "not draw. Married filing separately is offered because its base amount is zero, which is a " +
      "different answer.",
  },
};

function mount(mountFn: (ctx: TileContext) => void): HTMLElement {
  const root = document.createElement("div");
  const params = new URLSearchParams();
  mountFn({
    root,
    params,
    setParams: () => {},
    permalink: () => "https://enklayve.com/#/x",
    navigate: () => {},
    locale: "en-US",
    data,
    profile: new SituationStore(),
  } as unknown as TileContext);
  return root;
}

describe("the filing-status control, across the whole catalog", () => {
  const withSelect: { id: string; values: string[] }[] = [];

  it("finds the tiles that ask, so an empty sweep cannot pass", () => {
    for (const { tile } of SUB_TOOLS) {
      if (!tile.mount) continue;
      const select = mount(tile.mount).querySelector<HTMLSelectElement>('select[name="fs"]');
      if (!select) continue;
      withSelect.push({
        id: tile.id,
        values: [...select.querySelectorAll("option")].map((o) => o.getAttribute("value") ?? ""),
      });
    }
    expect(withSelect.length).toBeGreaterThan(10);
  });

  it("offers every filing status, or records why one is missing", () => {
    for (const { id, values } of withSelect) {
      const missing = ALL_STATUSES.filter((s) => !values.includes(s));
      const explained = EXPLAINED[id];
      if (missing.length === 0) {
        expect(
          explained,
          `${id} offers every status; its EXPLAINED entry is stale`,
        ).toBeUndefined();
        continue;
      }
      expect(
        explained,
        `${id} omits ${missing.join(", ")} with no reason recorded — a reader in that status ` +
          `picks the nearest option and is answered as somebody else`,
      ).toBeDefined();
      expect(missing.sort()).toEqual([...explained!.missing].sort());
      // A reason has to be a reason. The statute is the load-bearing part.
      expect(explained!.why).toMatch(/§/);
      expect(explained!.why.length).toBeGreaterThan(80);
    }
  });

  it("never omits married filing separately, which is the one that keeps going missing", () => {
    // Called out on its own rather than left to the loop above, because it is
    // the status three tiles dropped and the one whose answer most often
    // differs: no earned income credit, no education credit, a zero Social
    // Security base amount, and half of every joint threshold.
    for (const { id, values } of withSelect) {
      expect(values, `${id} cannot express a married filing separately reader`).toContain(
        "married_separately",
      );
    }
  });
});
