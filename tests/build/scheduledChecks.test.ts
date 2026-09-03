import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The scheduled checks a contributor is told to run are the ones that run.
 *
 * Five checks are held out of the per-commit gate — three because they need the
 * network and a government site having a bad afternoon must not fail a build,
 * two because they are slow. Each has a workflow behind it, and each is a
 * command a contributor should run when their change touches what it watches.
 * `contributing.md` is where they are told that, and on 2026-09-03 the prose
 * said "Five more checks" over a block holding four: the source watch was the
 * one described in the sentence and missing from the code, and it is the one
 * whose subject — a statute that moves by amendment rather than by a schedule —
 * a contributor is least likely to think to check.
 *
 * Nothing had to go wrong for that; the list was a promise somebody had to
 * remember to keep, which is the same failure the link check learned when its
 * root sweep was three hand-written filenames. So the roster is derived: a
 * workflow that is scheduled and is not a data refresh is a scheduled check,
 * whatever it is called, and the command it runs has to appear in the doc.
 */
const ROOT = resolve(__dirname, "..", "..");
const WORKFLOWS = resolve(ROOT, ".github", "workflows");

/** The `node scripts/....ts` a workflow runs, if it runs exactly one. */
function scriptRunBy(yaml: string): string | undefined {
  const runs = [...yaml.matchAll(/run:\s*node (scripts\/[\w./-]+\.ts)/g)].map((m) => m[1]);
  return runs.length === 1 ? runs[0] : undefined;
}

/**
 * Scheduled, and not a data refresh. The 49 `refresh-*` workflows and the
 * `_data-refresh` they call are on their own crons too, but they propose data
 * changes through a pull request rather than asking a contributor to run
 * anything, so they are not what this list is about.
 */
const scheduledChecks = readdirSync(WORKFLOWS)
  .filter(
    (name) => name.endsWith(".yml") && !name.startsWith("refresh-") && name !== "_data-refresh.yml",
  )
  .map((name) => ({ name, yaml: readFileSync(resolve(WORKFLOWS, name), "utf8") }))
  .filter(({ yaml }) => /^\s+schedule:/m.test(yaml))
  .map(({ name, yaml }) => ({ name, script: scriptRunBy(yaml) }));

/** `npm run <name>` in the doc counts as naming whatever that script runs. */
const npmScripts = (
  JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  }
).scripts;

describe("the scheduled checks a contributor is told to run", () => {
  const doc = readFileSync(resolve(ROOT, "docs", "contributing.md"), "utf8");

  it("finds a scheduled check workflow to hold the doc to", () => {
    // The derivation is the point; an empty roster would pass every assertion
    // below while checking nothing.
    expect(scheduledChecks.length).toBeGreaterThan(1);
  });

  it("runs exactly one script per scheduled check, so the doc can name it", () => {
    const ambiguous = scheduledChecks.filter((c) => !c.script).map((c) => c.name);
    expect(
      ambiguous,
      "these scheduled workflows do not run exactly one script, so this test cannot say what a" +
        " contributor should type — name the command in contributing.md by hand and widen this",
    ).toEqual([]);
  });

  it("names every one of them in contributing.md", () => {
    const missing = scheduledChecks.filter(({ script }) => {
      if (!script || doc.includes(script)) return false;
      // Or by the npm alias, which is how four of the five are written.
      return !Object.entries(npmScripts).some(
        ([alias, body]) => body.includes(script) && doc.includes(`npm run ${alias}`),
      );
    });
    expect(
      missing.map((c) => `${c.name} → ${c.script}`),
      "these checks run on a schedule and contributing.md never says how to run them — a" +
        " contributor whose change touches what they watch has no way to find out before CI does",
    ).toEqual([]);
  });

  it("does not tell a contributor to run a check that has no schedule behind it", () => {
    // The converse failure: a command in the doc that nothing runs monthly is a
    // check nobody is doing, dressed as one somebody is.
    const scripts = new Set(scheduledChecks.map((c) => c.script));
    const claimed = [...doc.matchAll(/npm run (check:[\w:]+)/g)].map((m) => m[1] as string);
    const orphans = [...new Set(claimed)].filter((alias) => {
      const body = npmScripts[alias];
      return !body || ![...scripts].some((s) => s && body.includes(s));
    });
    expect(
      orphans,
      "contributing.md tells a contributor to run these, and no scheduled workflow does",
    ).toEqual([]);
  });
});
