import { describe, it, expect, beforeAll } from "vitest";
import { pct } from "../../src/ui/form";
import { SUB_TOOLS } from "../../src/tiles/registry";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import type { TileContext } from "../../src/tiles/types";

/**
 * A sign in front of nothing.
 *
 * "-$0.00" and "-0.00%" are not numbers a reader can do anything with. They
 * read as a bug, or as a debt of zero dollars, and both are produced by the
 * ordinary formatters: `Intl` signs -0, and `toFixed` signs anything that
 * rounds to it. An exact zero multiplied by -1 is enough.
 *
 * No realistic income produces one — the catalog was swept at $0.01, $0.50,
 * $1, $5, $25 and $100 in every numeric field and stayed clean. Sub-cent
 * amounts do, and those are typeable: a number input accepts `0.004`, and so
 * does a deep link, which is the same door SPEC-3 §2.3 opened for the clamps.
 * So the guard is on the two formatters rather than on the tiles that happened
 * to show it (Savings Bond and Tax-Loss Harvesting), and the sweep below holds
 * the catalog to it.
 */
let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

describe("pct", () => {
  it("never prints a minus sign in front of a zero", () => {
    expect(pct(-0.0000004)).toBe("0.00%");
    expect(pct(-0.00004, 2)).toBe("0.00%");
    expect(pct(-0.0004, 1)).toBe("0.0%");
    expect(pct(-0.004, 0)).toBe("0%");
    expect(pct(-0)).toBe("0.00%");
  });

  it("still signs a rate that is negative at the digit it prints", () => {
    expect(pct(-0.0001, 2)).toBe("-0.01%");
    expect(pct(-0.05, 1)).toBe("-5.0%");
  });

  it("leaves an ordinary rate alone", () => {
    expect(pct(0.2235)).toBe("22.35%");
    expect(pct(-0.2235)).toBe("-22.35%");
  });
});

/** Every leaf whose text is a signed zero, in whatever unit. */
function signedZeros(root: Element): string[] {
  return [...root.querySelectorAll("*")]
    .filter((e) => e.children.length === 0)
    .map((e) => (e.textContent ?? "").trim())
    .filter((t) => /^-(\$0(\.0+)?|0(\.0+)?%)$/.test(t) || /^\$-0(\.0+)?$/.test(t));
}

describe("no tile prints a signed zero", () => {
  // Sub-cent and sub-hundredth-of-a-point: the magnitudes where a rounded
  // display crosses to zero while the underlying value is still negative.
  const VALUES = [0.004, 0.0004, 0.00004];
  for (const { tile } of SUB_TOOLS) {
    if (!tile.mount) continue;
    it(`${tile.id}`, () => {
      const found: string[] = [];
      for (const v of VALUES) {
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
        for (const input of [...root.querySelectorAll<HTMLInputElement>('input[type="number"]')]) {
          input.value = String(v);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
        for (const z of signedZeros(root)) found.push(`at ${v}: ${z}`);
      }
      expect([...new Set(found)]).toEqual([]);
    }, 20_000);
  }
});
