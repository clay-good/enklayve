import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The README's phase table covers every phase the specs define.
 *
 * The table stopped at Phase 17 while Phases 18 through 24 shipped — Pillar 4,
 * the cliff explorer, the sequencers, Readout v2, the rights-adjacent
 * screeners, and the Standing Ledger — so the one page most readers see said
 * the work ended two waves before it did. Nothing compared the two documents,
 * which is the same failure mode as a figure in prose that no test reads back
 * out of the shard it mirrors.
 *
 * This does not check what a row SAYS. A summary is prose and prose is the
 * author's; what it checks is that no phase is missing a row, which is the part
 * that goes wrong silently when the next wave lands.
 */
const ROOT = resolve(__dirname, "..", "..");
const SPECS = resolve(ROOT, "docs", "specs");

/** Every phase number a spec file defines with a heading. */
function specPhases(): number[] {
  const numbers = new Set<number>();
  for (const file of readdirSync(SPECS).filter((f) => f.endsWith(".md"))) {
    const text = readFileSync(resolve(SPECS, file), "utf8");
    for (const m of text.matchAll(/^#{2,3} Phase (\d+)\b/gm)) numbers.add(Number(m[1]));
  }
  return [...numbers].sort((a, b) => a - b);
}

/**
 * Every phase number the README's table covers, expanding the ranges it writes
 * with an en dash ("0–4", "12–13") as well as single numbers.
 */
function readmePhases(): Set<number> {
  const readme = readFileSync(resolve(ROOT, "README.md"), "utf8");
  const covered = new Set<number>();
  // The status cell is an emoji, and a character class of them is a surrogate
  // trap — matched as an alternation instead.
  for (const m of readme.matchAll(/^\| *(\d+)(?:\s*[–-]\s*(\d+))? *\| *(?:✅|🚧) */gm)) {
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : from;
    for (let n = from; n <= to; n += 1) covered.add(n);
  }
  return covered;
}

describe("the README's phase table", () => {
  it("has a row for every phase the specs define", () => {
    const covered = readmePhases();
    const missing = specPhases().filter((n) => !covered.has(n));
    expect(
      missing,
      `the specs define these phases and the README table does not list them: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("reads a table at all, so the check cannot pass by finding nothing", () => {
    // A regex that stops matching would otherwise turn this into a test that
    // asserts an empty set against an empty set and reports success forever.
    expect(readmePhases().size).toBeGreaterThanOrEqual(specPhases().length);
    expect(specPhases()).toContain(24);
  });
});
