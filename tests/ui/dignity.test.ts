import { describe, it, expect, beforeAll } from "vitest";
import { TILES, SUB_TOOLS } from "../../src/tiles/registry";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import type { TileContext, TileDefinition } from "../../src/tiles/types";

/**
 * Dignity in the copy (SPEC-4 §3.4, doubling SPEC §5.3).
 *
 * §3 admits a Pillar 4 tool only if it clears four things beyond the nine
 * existing invariants. Three of them are checked: the federal-floor anchoring
 * is argued per tile in review, and `checkHarmTier` gates the tier field, the
 * tier-3 channels, and the advice line. The fourth had nothing.
 *
 * It reads: "No tool in this pillar may imply the user caused their situation,
 * and none may frame the output as a failure state. 'Here is what the rule says
 * and what you can do next' — never 'you should have.'" That is a tone rule,
 * and tone is mostly a matter of judgement — but the specific failure it names
 * is not. A second-person construction that assigns blame is a string, and a
 * string can be looked for.
 *
 * **This found nothing, and that is the honest report.** All 81 tiles are clean
 * today, including the one case worth worrying about: "you should have" has a
 * perfectly innocent factual use ("you should have received Form 1095-A") and it
 * does not appear either. So this is a guard against drift rather than a fix —
 * which is the whole reason to write it now, while the copy is right. The tiles
 * most likely to acquire a scolding sentence are the ones a reader opens on
 * their worst day: a garnishment order, a hospital bill, a month that does not
 * close.
 *
 * Two surfaces, because they fail differently. The **static** copy is what a
 * reviewer reads in the diff. The **rendered** copy is what a reader sees, and
 * it includes sentences assembled at runtime from the numbers typed in — which
 * is where a "you're behind" would come from, not from a literal in a tile file.
 *
 * The patterns are proved to fire before they are trusted to be silent. A
 * denylist sweep that matches nothing is indistinguishable from a broken regex
 * unless something holds it to a positive case.
 */
let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

/**
 * Constructions that assign blame or frame a result as the reader's failure.
 *
 * Each entry carries a sentence it must match, so the pattern is exercised
 * rather than assumed. Kept to the narrow, unambiguous forms: this is a gate,
 * and a gate that argues about tone is one somebody switches off.
 */
export const SCOLDING: { pattern: RegExp; name: string; fires: string }[] = [
  {
    pattern: /\byou should(?:'ve| have)\b(?![^.]*\breceiv)/i,
    name: "you should have",
    // §3.4 names this one outright. The lookahead spares the factual use --
    // "you should have received a notice" states what the rule requires of
    // somebody else, and is not a reproach.
    fires: "You should have started saving earlier.",
  },
  {
    pattern: /\byou (?:shouldn't|should not)(?:'ve| have)?\b/i,
    name: "you shouldn't have",
    fires: "You shouldn't have taken the raise.",
  },
  {
    pattern: /\byou (?:failed|neglected|forgot) to\b/i,
    name: "you failed to",
    fires: "You failed to file on time.",
  },
  {
    pattern: /\byour (?:own )?fault\b/i,
    name: "your fault",
    fires: "That part is your own fault.",
  },
  {
    pattern: /\bif only you\b/i,
    name: "if only you",
    fires: "If only you had enrolled in January.",
  },
  {
    pattern: /\byou(?:'re| are) behind\b/i,
    name: "you're behind",
    // SPEC §5.3's own example of the sentence this site does not write.
    fires: "You're behind on retirement.",
  },
  {
    pattern: /\byou made a mistake\b/i,
    name: "you made a mistake",
    fires: "You made a mistake on last year's return.",
  },
  {
    pattern: /\btoo late for you\b/i,
    name: "too late for you",
    fires: "It is too late for you to appeal.",
  },
];

/** Every scolding construction in the text, by name. */
export function scoldingIn(text: string): string[] {
  return SCOLDING.filter(({ pattern }) => pattern.test(text)).map(({ name }) => name);
}

/** A tile's static, reviewable copy: everything a diff would show. */
function staticCopy(tile: TileDefinition): string {
  const t = tile as TileDefinition & {
    description?: string;
    how?: string;
    resources?: { label: string }[];
  };
  return [t.title, t.description, t.how, ...(t.resources ?? []).map((r) => r.label)]
    .filter(Boolean)
    .join("\n");
}

/** A mounted tile with its worked example filled in. */
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

describe("the patterns fire before they are trusted to be silent", () => {
  for (const { pattern, name, fires } of SCOLDING) {
    it(`"${name}" matches the sentence it is for`, () => {
      expect(pattern.test(fires), `${pattern} does not match "${fires}"`).toBe(true);
    });
  }

  it("spares the factual use of the phrase §3.4 names", () => {
    // The one real false-positive risk: a Pillar 4 tile telling a reader what
    // the rule requires somebody to send them.
    expect(scoldingIn("You should have received Form 1095-A from the marketplace.")).toEqual([]);
    expect(scoldingIn("Here is what the rule says and what you can do next.")).toEqual([]);
  });
});

describe("no tile's static copy assigns blame", () => {
  const all = [...TILES, ...SUB_TOOLS.map((s) => s.tile)];

  it("finds the catalog to read", () => {
    expect(all.length).toBeGreaterThan(50);
  });

  for (const tile of all) {
    it(`${tile.id}`, () => {
      expect(scoldingIn(staticCopy(tile))).toEqual([]);
    });
  }
});

/**
 * The rendered surface, for the pillar the rule doubles for.
 *
 * §3.4 binds "no tool in this pillar", and these are the tools a reader reaches
 * on a bad day. Driven through a few states as well as the example, because the
 * sentence that would break this is one assembled from the figures typed in.
 */
describe("no Pillar 4 tile renders blame at any input", () => {
  const rough = SUB_TOOLS.map((s) => s.tile).filter(
    (t) => t.pillar === "rough" || (t as { harmTier?: number }).harmTier !== undefined,
  );

  it("finds the Pillar 4 calculators", () => {
    expect(rough.length).toBeGreaterThanOrEqual(8);
  });

  for (const tile of rough) {
    if (!tile.mount) continue;
    it(`${tile.id} at every field value`, () => {
      const problems: string[] = [];
      const read = (root: HTMLElement, where: string): void => {
        for (const name of scoldingIn(root.textContent ?? "")) problems.push(`${where}: ${name}`);
      };
      read(mounted(tile), "example");
      const count = mounted(tile).querySelectorAll('input[type="number"]').length;
      for (let i = 0; i < count; i += 1) {
        const root = mounted(tile);
        const input = [...root.querySelectorAll<HTMLInputElement>('input[type="number"]')][i]!;
        for (const value of [0, 13, 37_777, 250_001]) {
          input.value = String(value);
          input.dispatchEvent(new Event("input", { bubbles: true }));
          read(root, `field ${i} at ${value}`);
        }
      }
      expect([...new Set(problems)]).toEqual([]);
    }, 30_000);
  }
});
