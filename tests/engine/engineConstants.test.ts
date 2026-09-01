import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

/**
 * Every number the engine holds in its own hand, and why it is allowed to.
 *
 * A dataset figure is watched by everything here: the provenance audit demands a
 * citation, the loader hashes and schema-checks the shard, the staleness banner
 * fires when its year lapses, an adapter or a source-watch fingerprint notices
 * when the agency moves it. A `const` is watched by none of that. It is not a
 * dataset, so no gate can see it, and it goes stale in total silence.
 *
 * That is not a theoretical worry. `SALT_CAP = 10000` sat in the deduction code
 * with no citation and nothing behind it while the One Big Beautiful Bill Act
 * replaced the flat $10,000 with $40,400 for 2026 — and the federal shard beside
 * it had already been refreshed *for that Act*. Anyone itemizing more than
 * $10,000 of state and local tax was shown too small a deduction and too large a
 * tax bill, and the golden corpus was pinning the wrong answer, because a corpus
 * checks the engine against itself.
 *
 * The SPEC-3 hardening passes named this anti-pattern three times (§A4, §A6,
 * §A7) and found one more case each time. A fourth pair of eyes was not the
 * answer; a list was. So every named numeric constant in `src/engine` has to
 * appear below with a sentence saying what it is. Adding one without a verdict
 * fails, and writing the verdict is the moment to ask "is this a figure somebody
 * legislates?" — which is the whole question.
 *
 * Named constants only. An inline literal is a different sweep and a harder one;
 * this covers the shape the three hardening passes actually kept finding.
 */
const ROOT = resolve(__dirname, "..", "..");

/**
 * A named numeric constant at the top level of a module.
 *
 * The right-hand side may be arithmetic over literals — `24 * 60 * 60 * 1000` is
 * as much a constant as `86_400_000`, and a figure written `40 * 1000` would
 * otherwise slip past. The character class admits no letters, so anything
 * referring to another name is not one of these.
 */
export function numericConstants(source: string): string[] {
  return [...source.matchAll(/^(?:export )?const ([A-Z][A-Z0-9_]*) = ([-\d_.\s*/+()]+);/gm)]
    .filter((m) => /\d/.test(m[2]!))
    .map((m) => m[1]!);
}

function engineFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return engineFiles(p);
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [p] : [];
  });
}

/**
 * Each entry says which of two things the number is.
 *
 * A **bound** is the engine's own: a loop ceiling, a probe size, a unit
 * conversion, a display cutoff. Nobody legislates it, so nothing can make it
 * stale, and it belongs in code.
 *
 * A **figure** is somebody else's: a statute, a revenue procedure, an agency
 * table. It belongs in a shard with a citation, and if one appears here it needs
 * a reason it is safe where it is — which after the SALT case is a high bar.
 */
const VERDICTS: Record<string, string> = {
  MAX_HOUSEHOLD_SIZE: "bound — a sanity ceiling on a user-entered household size",
  MS_PER_DAY: "bound — a unit conversion",
  DAY_MS: "bound — a unit conversion",
  SOON_DAYS: "bound — when a deadline starts being called soon; a display choice",
  MAX_POINTS: "bound — the most points a cliff sweep will plot",
  DEFAULT_STEP: "bound — the sweep's default income step",
  MIN_STEP: "bound — the smallest income step the sweep accepts",
  MAX_STEP: "bound — the largest income step the sweep accepts",
  MAX_INCOME: "bound — the top of the swept income range",
  CLIFF_NOISE_FLOOR:
    "bound — the dollar change below which a cliff is rounding rather than a cliff",
  WEEKS_PER_YEAR: "bound — a unit conversion",
  MARGINAL_PROBE: "bound — the wage bump used to measure a marginal rate",
  MAX_YEARS: "bound — a ceiling on a user-entered horizon",
  MAX_HORIZON_MONTHS: "bound — the same ceiling in months",
  MAX_PERIODS: "bound — a compounding-loop ceiling",
  MEDICAL_AGI_FLOOR_RATE:
    "figure — IRC §213(a), medical expenses deductible above 7.5% of AGI. A rate rather " +
    "than an amount, permanent since the Consolidated Appropriations Act 2021 made the 7.5% " +
    "floor apply to all taxable years, so it has no annual value to chase and a change would " +
    "be an act of Congress. Left in code deliberately, and named here so the next reader can " +
    "argue with the decision rather than rediscover it.",
};

describe("what the engine is allowed to know by heart", () => {
  const found = engineFiles(join(ROOT, "src", "engine")).flatMap((f) =>
    numericConstants(readFileSync(f, "utf8")),
  );

  it("finds the constants at all", () => {
    expect(found.length).toBeGreaterThan(10);
    expect(found).toContain("MEDICAL_AGI_FLOOR_RATE");
  });

  it("has a verdict for every one of them", () => {
    const unexplained = [...new Set(found)].filter((name) => !VERDICTS[name]).sort();
    expect(
      unexplained,
      "a new numeric constant in src/engine needs a line in VERDICTS saying whether it is a " +
        "bound the engine owns or a figure somebody legislates — see SALT_CAP",
    ).toEqual([]);
  });

  it("does not keep verdicts for constants that are gone", () => {
    const stale = Object.keys(VERDICTS)
      .filter((name) => !found.includes(name))
      .sort();
    expect(stale, "these constants no longer exist; drop their verdicts").toEqual([]);
  });

  it("no longer holds a SALT cap", () => {
    // The case that produced this test. It is a field on the federal shard now.
    expect(found).not.toContain("SALT_CAP");
  });

  it("reads a constant and ignores everything that is not one", () => {
    expect(
      numericConstants(
        [
          "export const A_B = 1_000;",
          "const DAY = 24 * 60 * 60 * 1000;", // arithmetic over literals is still a constant
          "const c = 5;", // lower case: a local, not a named constant
          "const D = f(2);", // a call
          "const E = OTHER * 2;", // refers to a name, so not a literal
        ].join("\n"),
      ),
    ).toEqual(["A_B", "DAY"]);
  });
});
