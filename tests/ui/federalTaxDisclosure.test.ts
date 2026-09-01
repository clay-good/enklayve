import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A tile that computes federal income tax says what it does not deduct.
 *
 * Six tiles run `evaluateTaxes`. Two of them ask the reader for the inputs the
 * One Big Beautiful Bill Act's five deductions need — wage composition, giving,
 * how many are 65, car loan interest — and apply them. The other four ask for
 * none of it, because they are about withholding, deferral, set-aside and
 * rates rather than about composing a return, and adding twenty fields across
 * four tools would be the wrong fix. But a tool that quietly computes a higher
 * federal tax than the reader owes is the same failure the Act's deductions
 * were missing from the engine for: an omission nobody wrote down.
 *
 * So the rule is: compute federal tax, and either ask for the deductions or
 * say you did not. This fails when the seventh tile calls the engine.
 */
const TILES = resolve(__dirname, "..", "..", "src", "tiles");

/** Names the shared explainers; a tile satisfies the rule by using one. */
const DISCLOSURES = [
  "OBBBA_DEDUCTIONS_HOW",
  "OBBBA_DEDUCTIONS_HOW_NO_GIVING",
  "OBBBA_DEDUCTIONS_NOT_MODELED",
];

describe("every tile that computes federal income tax", () => {
  const files = readdirSync(TILES)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => [f, readFileSync(resolve(TILES, f), "utf8")] as const)
    .filter(([, src]) => src.includes("evaluateTaxes("));

  it("finds the tiles that call the engine", () => {
    // If this list shrinks, a tile stopped computing federal tax and the rule
    // below stopped covering it — worth noticing rather than passing silently.
    expect(files.map(([f]) => f).sort()).toEqual([
      "federalIncomeTax.ts",
      "marginalExplorer.ts",
      "paycheckOptimizer.ts",
      "quarterlyTaxes.ts",
      "takeHome.ts",
      "w4Withholding.ts",
    ]);
  });

  it("either applies the 2026 deductions or says it does not", () => {
    const silent = files
      .filter(([, src]) => !DISCLOSURES.some((d) => src.includes(d)))
      .map(([f]) => f);
    expect(
      silent,
      "these tiles compute federal income tax while ignoring five deductions and telling" +
        " nobody: import OBBBA_DEDUCTIONS_NOT_MODELED from ./deductionCopy into the `how`," +
        " or ask for the inputs and apply them",
    ).toEqual([]);
  });

  it("does not let a tile that asks for nothing claim it applies them", () => {
    // The two claims are not interchangeable. A tile with no wage-composition
    // input that printed the full explainer would be describing a calculation
    // that never runs — which is why the "not modeled" note is its own string.
    for (const [file, src] of files) {
      if (!src.includes("OBBBA_DEDUCTIONS_NOT_MODELED")) continue;
      expect(src.includes("qualifiedTips"), `${file} claims not to model these`).toBe(false);
    }
  });
});
