import { describe, it, expect, beforeAll } from "vitest";
import { writeFileSync } from "node:fs";
import { observeEngine, observationDigest, PROBED_FILES } from "../../scripts/observe-engine";
import { sourceFiles, boundariesIn } from "../../scripts/check-boundaries";
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

  it("writes the digest when asked, for the classifier to compare", () => {
    const out = process.env.OBSERVE_OUT;
    if (!out) return;
    writeFileSync(out, observationDigest(data));
  });
});
