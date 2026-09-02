import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * An exported value nothing reads.
 *
 * The profile learned this lesson first: `county` and `preTaxContributions` were
 * each declared, documented, carried through the portable file and the Standing
 * Ledger, and consulted by no line of application code, and a test now fails on
 * any profile field nothing reads. The same hazard is one directory wider. An
 * exported function or constant that no caller uses is not free here — `src` is
 * one eager bundle the service worker precaches whole, so it is bytes on every
 * first visit, and the budget's headroom is a few kilobytes. It is also a claim:
 * a reader finding `asMoney` beneath a comment reading "convenience for callers
 * formatting money from the raw numbers above" reasonably concludes some caller
 * does. None did, and none ever had.
 *
 * Two were live when this was written. `asMoney` in the cliff engine, and
 * `DATASET_KINDS` in the schemas — `Object.keys(DATASET_SCHEMAS)` computed at
 * module load and read by nothing, while the schema six lines below it recomputes
 * the identical expression rather than using it.
 *
 * **Values only.** A type or an interface is erased at build time and costs
 * nothing, and exporting one for a caller who may arrive later is ordinary. This
 * is about code that ships.
 */
const ROOT = resolve(__dirname, "..", "..");

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".ts")) out.push(p);
    }
  };
  walk(join(ROOT, dir));
  return out;
}

/** `export function|const|class NAME` — the forms that survive to the bundle. */
const EXPORTED_VALUE = /^export (?:async )?(?:function|const|class) (\w+)/gm;

export function exportedValues(source: string): string[] {
  return [...source.matchAll(EXPORTED_VALUE)].map((m) => m[1]!);
}

describe("nothing in the shipped bundle is exported and read by nobody", () => {
  it("recognises the forms that reach the bundle, and not the ones erased", () => {
    const found = exportedValues(
      [
        "export function a(): void {}",
        "export async function b(): Promise<void> {}",
        "export const c = 1;",
        "export class D {}",
        "export interface E { x: number }",
        "export type F = string;",
        "function g(): void {}",
      ].join("\n"),
    );
    expect(found).toEqual(["a", "b", "c", "D"]);
  });

  it("finds no exported value that nothing anywhere reads", () => {
    const src = tsFiles("src").map((f) => [f, readFileSync(f, "utf8")] as const);
    // Everything that can legitimately be the only reader: another module, a
    // test, a build script, or the Playwright suite.
    const consumers = [...tsFiles("tests"), ...tsFiles("scripts"), ...tsFiles("e2e")]
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");

    const orphans: string[] = [];
    for (const [file, text] of src) {
      for (const name of exportedValues(text)) {
        const used = new RegExp(`\\b${name}\\b`);
        // More than the declaration itself, in its own file, counts: a tile's
        // `mount` function is exported for symmetry and read by the tile record
        // three lines below it.
        const selfUses = (text.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length - 1;
        if (selfUses > 0) continue;
        if (src.some(([other, t]) => other !== file && used.test(t))) continue;
        if (used.test(consumers)) continue;
        orphans.push(`${file.slice(ROOT.length + 1)}: ${name}`);
      }
    }
    expect(orphans, "exported and read by nobody").toEqual([]);
  });
});
