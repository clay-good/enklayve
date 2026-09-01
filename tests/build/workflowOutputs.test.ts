import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A count the check computes reaches the workflow that runs it.
 *
 * These scheduled checks report by writing counts to `$GITHUB_OUTPUT`, and the
 * workflow decides from those counts whether to open an issue. Nothing connects
 * the two ends: the script can add an output and the workflow can go on
 * ignoring it, and the result is not a broken build but a check that does its
 * work every month and tells nobody. That is the same shape as an adapter that
 * has stopped anchoring behind a citation that still looks live — measured,
 * unread, invisible — and it happened here on 2026-09-01, when the wait probes
 * shipped emitting `waitsOver` into a workflow that gated on two other counts.
 *
 * The rule is deliberately weaker than "every output is gated on", because some
 * genuinely should not be: an unreachable source is usually an agency having an
 * afternoon, and failing on it monthly is how an alert becomes scenery. What is
 * required is that the workflow NAME the output — in its condition, in its
 * body, or in a comment saying why it is not gated. Silence is the only answer
 * ruled out.
 *
 * `scripts/refresh/run.ts` is not here: it emits through an `emitOutput(key,
 * value)` helper with computed keys, so there is nothing to read statically.
 */
const ROOT = resolve(__dirname, "..", "..");

/** Keys written into a `$GITHUB_OUTPUT` template literal, `key=${…}` or `key<<EOF`. */
export function emittedOutputs(source: string): string[] {
  const keys = new Set<string>();
  for (const m of source.matchAll(/(?:^|\\n|`)([a-zA-Z][A-Za-z0-9_]*)(?:=\$\{|<<EOF)/g)) {
    keys.add(m[1]!);
  }
  return [...keys].sort();
}

const PAIRS: [script: string, workflow: string][] = [
  ["scripts/check-adapters.ts", ".github/workflows/check-adapters.yml"],
  ["scripts/check-links.ts", ".github/workflows/check-links.yml"],
  ["scripts/refresh/watch-sources.ts", ".github/workflows/watch-pillar4-sources.yml"],
];

describe("reading the counts the scheduled checks emit", () => {
  it("finds the keys in a template literal", () => {
    expect(emittedOutputs("`broken=${n}\\nreport<<EOF\\n${r}\\nEOF\\n`")).toEqual([
      "broken",
      "report",
    ]);
  });

  it("does not mistake an ordinary assignment for an output", () => {
    expect(emittedOutputs("const total = `${a}`;")).toEqual([]);
  });

  for (const [script, workflow] of PAIRS) {
    it(`${workflow} names every count ${script} emits`, () => {
      const keys = emittedOutputs(readFileSync(resolve(ROOT, script), "utf8"));
      expect(keys.length, `${script} emits no outputs — has the shape changed?`).toBeGreaterThan(1);
      // Case-insensitive: a count that is deliberately not gated on is named in
      // prose ("Unreachable is usually the agency having an afternoon"), and a
      // rule that missed that would push the explanation out of the comment and
      // into nowhere.
      const yaml = readFileSync(resolve(ROOT, workflow), "utf8").toLowerCase();
      for (const key of keys) {
        expect(yaml, `${script} emits "${key}" and ${workflow} never mentions it`).toContain(
          key.toLowerCase(),
        );
      }
    });
  }
});
