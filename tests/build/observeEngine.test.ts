import { describe, it, expect, beforeAll } from "vitest";
import { writeFileSync } from "node:fs";
import { observeEngine, observationDigest, PROBED_FILES } from "../../scripts/observe-engine";
import { sourceFiles, boundariesIn, maskNonCode } from "../../scripts/check-boundaries";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The observation harness, and the runner `check:boundaries --classify` shells
 * out to.
 *
 * Two jobs. As a test it holds the properties the classifier depends on: the
 * observation is deterministic (a probe that varies run to run would report
 * every mutation as observable), it is non-trivial, and it reaches every engine
 * file that contains a comparison the checker will try to flip — because a
 * boundary in an unprobed file would be classified "no observed difference" for
 * the sole reason that nothing looked at it, which is the one failure mode that
 * would make the report actively misleading.
 *
 * As a runner, `OBSERVE_OUT=<path>` makes it write the digest there. That is how
 * the classifier compares an original against a mutation without paying for a
 * full suite run per comparison: 1.5 seconds instead of eight.
 */
let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

describe("the engine observation", () => {
  it("is deterministic", () => {
    // The classifier's whole method rests on this. A clock, a `Math.random`, or
    // an unsorted `Object.keys` anywhere in the probe would make every mutation
    // look observable and the report would be noise.
    expect(observationDigest(data)).toBe(observationDigest(data));
  });

  it("observes a substantial number of values", () => {
    const o = observeEngine(data);
    expect(Object.keys(o).length).toBeGreaterThan(150);
    // Nothing may be undefined: `JSON.stringify` drops undefined, so a probe
    // that silently returned nothing would compare equal to any mutation of it.
    for (const [key, value] of Object.entries(o)) {
      expect(value, `${key} observed nothing`).not.toBeUndefined();
    }
  });

  it("actually exercises its fixtures, rather than probing a typo", () => {
    // The probe builds a synthetic jurisdiction carrying every optional
    // capability that holds a comparison. A misspelled key there — `personalCredit`
    // for `personalCreditRate`, which happened — makes the function return its
    // empty default for every input, so the probe watches a constant and
    // reports every mutation of that code as invisible. A fixture that produces
    // one value across a range it is supposed to step through is the symptom.
    const o = observeEngine(data);
    const varies = (prefix: string): number =>
      new Set(
        Object.entries(o)
          .filter(([k]) => k.startsWith(prefix))
          .map(([, v]) => JSON.stringify(v)),
      ).size;
    for (const prefix of [
      "personalCreditRateFor(",
      "federalTaxDeductionFor(",
      "incomeRecaptureFor(",
      "bracketTax(",
      "savers(",
      "snap(",
      "acaCovered(",
      "ira(",
      "amt(",
      "garnish(",
      "deadline(",
      "dueDates(",
      "pellAt(",
      "edu(",
      "plan(",
      "coast(",
      "findCliffs(",
    ]) {
      expect(varies(prefix), `${prefix} observed the same value everywhere`).toBeGreaterThan(1);
    }
  });

  it("reaches every engine file the boundary checker will mutate", () => {
    const root = resolve(__dirname, "..", "..");
    const withBoundaries = sourceFiles(resolve(root, "src", "engine"))
      .map((p) => p.slice(root.length + 1).replace(/\\/g, "/"))
      .filter((rel) => boundariesIn(rel, readFileSync(resolve(root, rel), "utf8")).length > 0);
    const unprobed = withBoundaries.filter((f) => !PROBED_FILES.includes(f));
    // A new engine file with a threshold in it fails here, which is the point:
    // it must gain a probe before the classifier is allowed to have an opinion
    // about its boundaries.
    expect(
      unprobed,
      `add a probe in scripts/observe-engine.ts for: ${unprobed.join(", ")}`,
    ).toEqual([]);
  });

  it("reaches every engine FUNCTION the boundary checker will mutate, not merely every file", () => {
    // The file-level check above passed on 2026-09-07 while the probe could not
    // see `selfEmployedPlanCeilings`: `contributionLimits.ts` was probed for its
    // two catch-up ages, and the solo-401(k) changeover in the same file was
    // reached by nothing. The slow classifier caught it a month later, and only
    // because that comparison happens to be HELD by a test -- its calibration
    // can only see a blind spot where a test already proves a difference
    // exists. A boundary nobody holds, in a function nobody calls, is reported
    // as "no observed difference" for the sole reason that nothing looked, and
    // there is nothing to catch it.
    //
    // So the grain here is the function. The probe names its entry points; the
    // engine's own source says who they call; anything holding a comparison has
    // to be reachable from one of them.
    const root = resolve(__dirname, "..", "..");
    const probe = readFileSync(resolve(root, "scripts", "observe-engine.ts"), "utf8");

    /** Every function in src/engine, the lines it spans, and who it calls. */
    interface EngineFn {
      name: string;
      file: string;
      from: number;
      to: number;
      calls: Set<string>;
    }
    const fns: EngineFn[] = [];
    for (const abs of sourceFiles(resolve(root, "src", "engine"))) {
      const rel = abs.slice(root.length + 1).replace(/\\/g, "/");
      const code = maskNonCode(readFileSync(abs, "utf8"));
      let open: EngineFn | null = null;
      code.forEach((line, i) => {
        const declared = /^(?:export )?(?:async )?function (\w+)/.exec(line);
        if (declared) {
          if (open) open.to = i;
          open = { name: declared[1]!, file: rel, from: i + 1, to: code.length, calls: new Set() };
          fns.push(open);
        }
        if (open) for (const m of line.matchAll(/\b(\w+)\s*\(/g)) open.calls.add(m[1]!);
        // A `}` in the first column closes it, and nothing after that belongs
        // to it. Without the clear, one function swallowed the rest of its file
        // -- `pickTargetDebt` claimed the eight comparisons in `PLAN_STEPS`,
        // which sit in arrow functions inside a top-level array and belong to
        // no named function at all. Those are the file-level check's business;
        // this one only speaks for code it can actually attribute.
        if (open && /^\}/.test(line) && i + 1 > open.from) {
          open.to = i + 1;
          open = null;
        }
      });
    }
    expect(fns.length, "no engine functions found, so this checks nothing").toBeGreaterThan(50);

    // Entry points: a function the probe itself calls by name.
    const reachable = new Set(
      fns.filter((f) => new RegExp(`\\b${f.name}\\s*\\(`).test(probe)).map((f) => f.name),
    );
    expect(reachable.size, "the probe calls no engine function by name").toBeGreaterThan(20);
    for (let grew = true; grew; ) {
      grew = false;
      for (const f of fns) {
        if (!reachable.has(f.name)) continue;
        for (const called of f.calls) {
          if (!reachable.has(called) && fns.some((g) => g.name === called)) {
            reachable.add(called);
            grew = true;
          }
        }
      }
    }

    const blind = new Set<string>();
    for (const abs of sourceFiles(resolve(root, "src", "engine"))) {
      const rel = abs.slice(root.length + 1).replace(/\\/g, "/");
      for (const b of boundariesIn(rel, readFileSync(abs, "utf8"))) {
        const owner = fns
          .filter((f) => f.file === rel && f.from <= b.line && b.line <= f.to)
          .at(-1);
        if (owner && !reachable.has(owner.name)) blind.add(`${owner.name} (${rel}:${b.line})`);
      }
    }
    expect(
      [...blind].sort(),
      "these hold a comparison the checker will flip and nothing in " +
        "scripts/observe-engine.ts can reach them, so their verdict would be " +
        '"no observed difference" only because nothing looked',
    ).toEqual([]);
  });

  it("writes the digest when asked, for the classifier to compare", () => {
    const out = process.env.OBSERVE_OUT;
    if (!out) return;
    writeFileSync(out, observationDigest(data));
  });
});
