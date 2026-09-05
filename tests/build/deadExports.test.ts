import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { maskNonCode } from "../../scripts/check-boundaries";

/**
 * An exported value nothing reads.
 *
 * The profile learned this lesson first: `county` and `preTaxContributions` were
 * each declared, documented, carried through the portable file and the Standing
 * Ledger, and consulted by no line of application code, and a test now fails on
 * any profile field nothing reads. The same hazard is one directory wider.
 *
 * **The reason is the claim, not the bytes**, and this file used to say the
 * opposite: that `src` is one eager bundle the service worker precaches whole,
 * so a dead export is bytes on every first visit against a budget with a few
 * kilobytes of headroom. Measured on 2026-09-05 by deleting one and rebuilding
 * from an empty `dist`, the entry chunk came back **byte-identical, same content
 * hash** — the bundler had already dropped it, as it drops any unused export of
 * a module it can prove side-effect-free. The byte argument survives only for
 * an export the bundler cannot prove unused, which is not most of them, and a
 * gate resting on a cost that is usually zero is a gate somebody will
 * eventually and correctly ignore.
 *
 * What does not go away is the claim. A reader finding `asMoney` beneath a
 * comment reading "convenience for callers formatting money from the raw
 * numbers above" reasonably concludes some caller does. None did, and none ever
 * had. An export is a promise about who needs it, and a false one costs
 * whoever reads it next.
 *
 * Two were live when this was written. `asMoney` in the cliff engine, and
 * `DATASET_KINDS` in the schemas — `Object.keys(DATASET_SCHEMAS)` computed at
 * module load and read by nothing, while the schema six lines below it recomputes
 * the identical expression rather than using it.
 *
 * **Values only.** A type or an interface is erased at build time and costs
 * nothing, and exporting one for a caller who may arrive later is ordinary. This
 * is about code that ships.
 *
 * **And a test is not a caller.** The first version of this counted any word-
 * boundary match in `tests/`, `scripts/` or `e2e/` as a use, which is right for
 * "does anything read this at all" and wrong for the question it was built to
 * ask. `windowsForProgram` was read by exactly two lines of one test, which
 * filtered `enrollmentWindows(...)` by program — three characters of work the
 * test can do itself — and shipped to every visitor as bytes no visitor's page
 * could reach. Its comment said "e.g. every COBRA clock in the sequence", which
 * a reader takes as a caller somewhere in the life-events page. There was none.
 *
 * So the gate asks the bundle's question — does any other module under `src/`
 * read this? — and an export that only the harness reads has to say why in
 * {@link HARNESS_ONLY}. Both entries there are the same deliberate shape: an
 * integrity check over a registry, exported so a test can assert it is empty,
 * with no run-time caller by design.
 */
const ROOT = resolve(__dirname, "..", "..");

/**
 * Exports whose only reader is the harness, and the reason each is allowed to
 * be. Both are the same shape: a function that walks a registry and returns its
 * problems, exported so a test can assert the list is empty. Neither has a
 * run-time caller by design, and inlining either into its test would move the
 * rule away from the registry it is about.
 */
const HARNESS_ONLY: Record<string, string> = {
  "src/engine/sequences.ts: danglingWindowIds":
    "every windowId a sequence references that the windows shard does not carry — empty in a healthy build, asserted by a test so a renamed window cannot silently strip the clock off a step",
  "src/readout/checks.ts: validateRegistry":
    "the properties every document check must have (a stated false positive, a citation, OCR suppression), asserted over the whole registry so a new check cannot ship without them",
};

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

  it("finds no exported value that no other shipped module reads", () => {
    const src = tsFiles("src").map((f) => [f, readFileSync(f, "utf8")] as const);
    // Comments and strings are blanked before the search, because a name in a
    // sentence about a function is not a caller either — the same reading error
    // in a different place. `{@link validateRegistry}` in a doc comment is how
    // one of these hid for as long as it did.
    const code = new Map(src.map(([f, t]) => [f, maskNonCode(t).join("\n")] as const));

    const orphans: string[] = [];
    for (const [file, text] of src) {
      const rel = file.slice(ROOT.length + 1);
      for (const name of exportedValues(text)) {
        if (HARNESS_ONLY[`${rel}: ${name}`]) continue;
        const used = new RegExp(`\\b${name}\\b`);
        // More than the declaration itself, in its own file, counts: a tile's
        // `mount` function is exported for symmetry and read by the tile record
        // three lines below it.
        const selfUses = (code.get(file)!.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length - 1;
        if (selfUses > 0) continue;
        if (src.some(([other]) => other !== file && used.test(code.get(other)!))) continue;
        orphans.push(`${rel}: ${name}`);
      }
    }
    expect(
      orphans,
      "no other module under src/ reads it, so it is bytes on every first visit." +
        " Delete it, or record in HARNESS_ONLY why the harness is its only reader",
    ).toEqual([]);
  });

  it("every harness-only entry is still an export that exists", () => {
    // A stale entry is a standing permission for a name nobody has looked at,
    // and the name can come back meaning something else.
    const declared = new Set(
      tsFiles("src").flatMap((f) =>
        exportedValues(readFileSync(f, "utf8")).map((n) => `${f.slice(ROOT.length + 1)}: ${n}`),
      ),
    );
    expect(Object.keys(HARNESS_ONLY).filter((k) => !declared.has(k))).toEqual([]);
  });
});
