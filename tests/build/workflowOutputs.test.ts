import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { load } from "js-yaml";

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
  ["scripts/check-advisories.ts", ".github/workflows/check-advisories.yml"],
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

/**
 * An alarm that fires when the check never ran.
 *
 * These four workflows decide whether to open an issue by comparing a count to
 * the string `'0'`. The counts arrive through `$GITHUB_OUTPUT`, which every one
 * of these scripts writes LAST — after the fetches, the parsing, the diffing.
 * So a crash on the way there leaves every output unset, an unset output
 * evaluates to the empty string, and `'' != '0'` is **true**.
 *
 * Which means each of these jobs would open an issue with an empty body and a
 * title ending in nothing, off the back of a check that had not run — and
 * `continue-on-error: true`, which is there so a government site's bad
 * afternoon does not fail a build, is exactly what made it silent: the step
 * fails, the job stays green, and the only trace is the empty issue.
 *
 * It is not hypothetical. `scripts/check-advisories.ts` exits before its output
 * block whenever `npm audit` itself cannot run.
 *
 * Two rules, and the second is the one that matters:
 *
 * 1. **An issue condition requires the report to exist.** `report` is written in
 *    the same append as the counts and is never empty on a run that got there —
 *    every one of these reports opens with a summary line — so `report != ''`
 *    is exactly "the check reported".
 * 2. **A missing report fails the job.** Rule 1 alone would turn a spurious
 *    issue into silence, which is worse: an unattended monthly check that has
 *    stopped working and says nothing. A red scheduled run reaches the owner.
 *
 * The workflows are found by looking for `outputs.report`, not from a list, so a
 * fifth scheduled alarm is covered the day it is written.
 */
describe("a scheduled alarm cannot fire on a check that never reported", () => {
  interface Step {
    name?: string;
    id?: string;
    if?: string;
    run?: string;
    "continue-on-error"?: boolean;
  }

  /** Every step of the workflow's single job, parsed rather than pattern-matched. */
  function steps(workflow: string): Step[] {
    const doc = load(readFileSync(resolve(ROOT, workflow), "utf8")) as {
      jobs: Record<string, { steps: Step[] }>;
    };
    return Object.values(doc.jobs).flatMap((j) => j.steps ?? []);
  }

  const alarms = PAIRS.map(([, workflow]) => workflow).filter((w) =>
    steps(w).some((s) => (s.if ?? "").includes("outputs.report")),
  );

  it("finds the alarm workflows", () => {
    expect(alarms.length).toBe(PAIRS.length);
  });

  for (const workflow of alarms) {
    const conditions = steps(workflow)
      .map((s) => (s.if ?? "").replace(/\s+/g, " ").trim())
      .filter((c) => c.length > 0);

    it(`${workflow} gates every count comparison on the report existing`, () => {
      const gating = conditions.filter((c) => /outputs\.\w+ != '0'/.test(c));
      expect(gating.length, "no condition compares a count — has the shape changed?").toBe(1);
      for (const c of gating) {
        expect(c, `this condition fires when the outputs are unset: ${c}`).toContain(
          "outputs.report != ''",
        );
      }
    });

    it(`${workflow} fails the job when no report was written`, () => {
      const guard = steps(workflow).find((s) => (s.if ?? "").includes("outputs.report == ''"));
      expect(guard, `${workflow} has no step that fires on a missing report`).toBeDefined();
      // And that step must actually fail, not just print. A guard that logs and
      // exits 0 is the silence the second rule exists to prevent.
      expect(guard?.run ?? "", `${workflow}'s guard does not fail the job`).toMatch(/exit 1/);
    });
  }
});
