import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

/**
 * Every number the code holds in its own hand, and why it is allowed to.
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
 *
 * It covers `src/readout`, `src/profile`, `src/tiles` and `src/ui` as well as
 * the engine, because the first thing this sweep found after the engine was
 * `FALLBACK_LIMIT = 24500` in `src/readout/report.ts` — the 2026 elective
 * deferral limit, handed to the goal plan with a frozen citation whenever the
 * retirement-limits shard was unavailable. Right for 2026, wrong every year
 * after, and stated under a citation that still looked live at exactly the
 * moment the shard beside it had been marked invalid so the reader would be
 * warned. The hardening passes swept the tiles and then the engine. Nobody
 * swept the readout.
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

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
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
 *
 * An **assumption** is this site's own modelling choice — a savings rate, a
 * lending convention, a display threshold with judgement in it. Nobody
 * legislates it and it is not arithmetic either, so it cannot go stale, but a
 * reader is entitled to know it was chosen. Naming the third category stops
 * assumptions being filed as bounds, which is where they hide.
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
  // --- outside the engine: readout, profile, tiles, ui ---
  FORMAT_VERSION: "bound — the situation file's format number",
  LEDGER_VERSION: "bound — the ledger file's format number",
  PBKDF2_ITERATIONS: "bound — key-derivation work factor for the encrypted ledger",
  MAX_DOCUMENT_BYTES: "bound — the largest document the readout will open",
  MAX_OCR_PDF_PAGES: "bound — how many pages OCR will attempt",
  OCR_MAX_PAGE_PIXELS: "bound — the largest page OCR will rasterise",
  OCR_RENDER_SCALE: "bound — the raster scale OCR renders at",
  MAX_ITERATIONS: "bound — a simulation ceiling",
  MIN_ITERATIONS: "bound — a simulation floor",
  MAX_RESULTS: "bound — how many hits the command palette shows",
  MAX_ROWS: "bound — a cap so a crafted deep link cannot allocate a runaway editor",
  MAX_CURVE_COLUMNS: "bound — the widest curve drawn before thinning, to keep the DOM small",
  MAX_AGE: "bound — a ceiling on a user-entered age",
  IRA_PARTIAL_ROUNDING:
    "figure — IRC §219(g)(2)(B) rounds a partial IRA deduction up to the next $10. Statutory and unindexed since the phase-out was written.",
  IRA_PARTIAL_MINIMUM:
    "figure — IRC §219(g)(2)(B) floors a positive partial IRA deduction at $200. Statutory and unindexed; it was an inline literal until 2026-09-01.",
  SWEEP_FLOOR_TO:
    "bound — how far up the income axis the cliff sweep plots for a small household. A choice about a chart, not a figure anyone legislates.",
  SWEEP_DEFAULT_TO: "bound — the same ceiling with no poverty-line data to scale against",
  EARLIEST_YEAR: "bound — a sanity floor on a citation's typed effective year",
  DEFAULT_RETURN_PCT:
    "assumption — the long-run return a §530A projection starts from. Nobody legislates it, the reader can edit it, and the tile calls the result a projection rather than a promise.",
  DURATION_MS: "bound — an animation length",
  HOURS_PER_DAY: "bound — a unit conversion for an hourly rate",
  STEP: "bound — the $1,000 lever the optimizer measures a saving against",
  APPR_DELTA: "bound — how far an opt-in range flexes the appreciation assumption",
  INFLATION_DELTA: "bound — the same, for inflation",
  RATE_DELTA: "bound — the same, for the rate",
  RETURN_DELTA: "bound — the same, for the return",
  EXAMPLE_SAI: "bound — a worked-example value in the tile's own example",
  POLICY_INCREMENT:
    "bound — the $1M layer umbrella policies are sold in; a market convention the tile labels as a guideline, not a cited rule",
  NOISE_FLOOR: "bound — cents of slack before an arithmetic mismatch is worth raising",
  MATERIAL_FLOOR_DOLLARS: "bound — the dollar floor below which a readout difference is noise",
  MATERIAL_FLOOR_SHARE: "bound — the same floor as a share",
  ASSUMED_SAVINGS_RATE:
    "assumption — what an over-withheld dollar could have earned in a high-yield savings account. Chosen, not legislated, and the tile says so.",
  AVG_HELD_FRACTION:
    "assumption — that a refunded dollar was held about half the year before it came back",
  HOUSING_RATIO:
    "assumption — the 28 half of the 28/36 lending convention; a guideline, not a rule",
  TOTAL_DEBT_RATIO: "assumption — the 36 half of the same convention",
  EMPLOYER_SHARE_RATE:
    "figure — the employer-side share both plans allow, 25% of net-after-contribution earnings restated as 20% of net. Arithmetic on a statutory rate rather than an indexed amount, so there is no annual value to chase.",
  LOSS_OFFSET_LIMIT:
    "figure — IRC §1211(b)(1), the net-capital-loss offset against ordinary income. $3,000 since the Revenue Act of 1978 and never indexed, so there is no annual value to chase.",
  LOSS_OFFSET_LIMIT_SEPARATE:
    "figure — half of it, for a married individual filing separately (§1211(b)(1) again)",
  SAFE_HARBOR_HIGH_AGI:
    "figure — IRC §6654(d)(1)(C)(i). Above $150,000 of prior-year AGI the estimated-tax safe harbor rises from 100% to 110% of last year's tax. Statutory and never indexed; it has not moved since 1993, and a change would be an act of Congress rather than an annual adjustment.",
  SEASONING_YEARS:
    "figure — IRC §408A(d)(3)(F), the five-year seasoning period before a converted amount comes out penalty-free. A period rather than an amount, so nothing indexes it.",
  MEDICAL_AGI_FLOOR_RATE:
    "figure — IRC §213(a), medical expenses deductible above 7.5% of AGI. A rate rather " +
    "than an amount, permanent since the Consolidated Appropriations Act 2021 made the 7.5% " +
    "floor apply to all taxable years, so it has no annual value to chase and a change would " +
    "be an act of Congress. Left in code deliberately, and named here so the next reader can " +
    "argue with the decision rather than rediscover it.",
};

/**
 * The sweep this file could not do, closed on 2026-09-01.
 *
 * Everything above finds NAMED constants. The checklist has said for weeks that
 * "an inline literal is a harder sweep", and it was right about why it matters:
 * §1211(b)'s $3,000 capital-loss offset spent months as `fields.mfs ? 1500 :
 * 3000` in the middle of a handler, invisible to every gate here, and was found
 * by a person reading rather than by a check.
 *
 * Running the sweep by hand over `src/engine` on 2026-09-01 turned up four
 * literals in real code — and one of them was statutory: IRC §219(g)(2)(B)'s
 * $200 minimum partial IRA deduction, sitting as `Math.max(200, roundedUp)`.
 * All four are named now, so the rule can be enforced instead of repeated.
 *
 * The threshold is 100. Below it live array indices, percentages, month counts
 * and the arithmetic of dates, and a check that fires on `12` is one people
 * learn to silence.
 */
describe("numbers the engine writes inline", () => {
  const ENGINE = resolve(ROOT, "src", "engine");
  /** Literals that are structural rather than quantitative. */
  const STRUCTURAL = new Set([100, 1000, 1200, 10000, 365, 1e15]);

  function codeLines(file: string): { line: string; number: number }[] {
    const out: { line: string; number: number }[] = [];
    let inBlock = false;
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((raw, i) => {
        const line = raw.trim();
        if (line.startsWith("/*")) inBlock = true;
        if (inBlock) {
          if (line.includes("*/")) inBlock = false;
          return;
        }
        if (line.startsWith("*") || line.startsWith("//")) return;
        out.push({ line: raw.split("//")[0]!, number: i + 1 });
      });
    return out;
  }

  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = resolve(dir, e.name);
      return e.isDirectory() ? walk(full) : e.name.endsWith(".ts") ? [full] : [];
    });
  }

  it("writes no bare number of its own, so every figure has a name to look up", () => {
    const offenders: string[] = [];
    for (const file of walk(ENGINE)) {
      const rel = file.slice(ROOT.length + 1);
      for (const { line, number } of codeLines(file)) {
        // A named constant's own declaration is where the number belongs.
        if (/\bconst [A-Z_][A-Z0-9_]* *=/.test(line)) continue;
        for (const m of line.matchAll(/(?<![\w.$])(\d[\d_]{2,}(?:\.\d+)?)(?![\w.])/g)) {
          const value = Number(m[1]!.replace(/_/g, ""));
          if (value < 100 || STRUCTURAL.has(value)) continue;
          offenders.push(`${rel}:${number} — ${m[1]} in \`${line.trim().slice(0, 70)}\``);
        }
      }
    }
    expect(
      offenders,
      "give it a name and a verdict in VERDICTS above. A bare number in an expression is" +
        " invisible to every gate in this repo, which is how §1211(b)'s $3,000 hid in a handler",
    ).toEqual([]);
  });
});

describe("what the code is allowed to know by heart", () => {
  const found = ["engine", "readout", "profile", "tiles", "ui"]
    .flatMap((d) => sourceFiles(join(ROOT, "src", d)))
    .flatMap((f) => numericConstants(readFileSync(f, "utf8")));

  it("finds the constants at all", () => {
    expect(found.length).toBeGreaterThan(10);
    expect(found).toContain("MEDICAL_AGI_FLOOR_RATE");
  });

  it("has a verdict for every one of them", () => {
    const unexplained = [...new Set(found)].filter((name) => !VERDICTS[name]).sort();
    expect(
      unexplained,
      "a new numeric constant in src/{engine,readout,profile,tiles,ui} needs a line in VERDICTS saying whether it is a " +
        "bound the code owns, a figure somebody legislates, or an assumption this site chose — see SALT_CAP and FALLBACK_LIMIT",
    ).toEqual([]);
  });

  it("does not keep verdicts for constants that are gone", () => {
    const stale = Object.keys(VERDICTS)
      .filter((name) => !found.includes(name))
      .sort();
    expect(stale, "these constants no longer exist; drop their verdicts").toEqual([]);
  });

  it("no longer holds a SALT cap, or a retirement-limit fallback", () => {
    // The two cases that produced this test. SALT_CAP is a field on the federal
    // shard now; FALLBACK_LIMIT is gone entirely, because the goal plan says
    // the limit could not be verified rather than naming last year's.
    expect(found).not.toContain("SALT_CAP");
    expect(found).not.toContain("FALLBACK_LIMIT");
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
