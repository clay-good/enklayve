import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateTaxes, type TaxContext } from "../../src/engine/tax";
import type { FilingStatus } from "../../src/data/schemas";
import { loadDatasets, type Datasets } from "../helpers/datasets";

/**
 * Generated golden snapshot — the drift guard (BUILD-SPEC.md §9: "CI fails if
 * any case drifts"). A 147-case matrix (statuses × incomes × jurisdictions) is
 * computed and compared against the committed snapshot.json. Any change to the
 * engine or a dataset that moves a number must be reviewed and re-committed via
 * `npm run golden:regen`.
 */
const SNAPSHOT_PATH = resolve(__dirname, "snapshot.json");
const REGEN = process.env.REGEN_GOLDEN === "1";

const STATUSES: FilingStatus[] = ["single", "married_jointly", "head_of_household"];
const INCOMES = [0, 25000, 50000, 75000, 100000, 200000, 500000];
const STATE_CODES = [null, "ca", "ny", "tx", "pa", "oh", "dc"] as const;

interface CaseResult {
  federalIncomeTax: string;
  ficaTotal: string;
  stateIncomeTax: string;
  totalTax: string;
  takeHome: string;
  marginalRate: number;
  effectiveRate: number;
}

const cents = (m: { roundToCents(): { toString(): string } }): string =>
  m.roundToCents().toString();

let ds: Datasets;
beforeAll(async () => {
  ds = await loadDatasets();
});

function computeMatrix(): Record<string, CaseResult> {
  const out: Record<string, CaseResult> = {};
  for (const status of STATUSES) {
    for (const wages of INCOMES) {
      for (const code of STATE_CODES) {
        const ctx: TaxContext = code
          ? { federal: ds.federal, state: ds.state(code), fica: ds.fica }
          : { federal: ds.federal, fica: ds.fica };
        const r = evaluateTaxes({ filingStatus: status, wages }, ctx);
        out[`${status}|${wages}|${code ?? "federal"}`] = {
          federalIncomeTax: cents(r.federal.incomeTax),
          ficaTotal: cents(r.fica.total),
          stateIncomeTax: r.state ? cents(r.state.incomeTax) : "0",
          totalTax: cents(r.totals.totalTax),
          takeHome: cents(r.totals.takeHome),
          marginalRate: r.totals.marginalRate,
          effectiveRate: r.totals.effectiveRate,
        };
      }
    }
  }
  return out;
}

describe("golden snapshot matrix (147 cases)", () => {
  it("matches the committed snapshot", () => {
    const matrix = computeMatrix();
    expect(Object.keys(matrix).length).toBe(STATUSES.length * INCOMES.length * STATE_CODES.length);

    if (REGEN) {
      writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(matrix, null, 2)}\n`, "utf8");
      return;
    }

    expect(existsSync(SNAPSHOT_PATH), "snapshot.json missing — run `npm run golden:regen`").toBe(
      true,
    );
    const committed = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as Record<string, CaseResult>;
    expect(matrix).toEqual(committed);
  });
});
