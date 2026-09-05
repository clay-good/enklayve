import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  SituationStore,
  SituationValuesSchema,
  type SituationKey,
  type SituationValues,
} from "../../src/profile/situation";

/**
 * One of every field, so the completeness checks below cannot be satisfied by a
 * profile that happens to be missing the newest one.
 *
 * Typed `Required<SituationValues>`, which is the half of this that the
 * compiler enforces: adding a field to the interface fails to build here until
 * somebody gives it a value, and the tests then check that the value survives
 * the two places a profile can be dropped on the floor.
 */
const EVERY_FIELD: Required<SituationValues> = {
  filingStatus: "married_jointly",
  stateCode: "md",
  // A `localAddOns` id, not a place name — see SituationValues. It read
  // "Gallatin" while nothing consumed the field, which is exactly how a fixture
  // teaches the wrong convention to whoever reads it next.
  county: "md-montgomery",
  householdSize: 3,
  ages: [41, 39, 8],
  // The count the credits take. It agrees with the one child under 17 in
  // `ages` above, because a fixture that disagreed with itself would teach the
  // next reader that the two are independent — they describe one household.
  qualifyingChildren: 1,
  annualIncome: 92_000,
  qualifiedTipsAnnual: 14_000,
  qualifiedOvertimeAnnual: 3200,
  preTaxContributions: 8000,
  retirementContributionsAnnual: 7000,
  employerMatchAnnual: 4600,
  employerMatchCaptured: 3000,
  debts: [{ name: "card", balance: 4200, ratePct: 22.99 }],
  essentialMonthlyExpenses: 3400,
  totalMonthlyExpenses: 4800,
  liquidSavings: 11_000,
};

/**
 * Every declared field is read by something.
 *
 * `Required<SituationValues>` above makes the compiler demand a *value* for a
 * new field; nothing demanded a *reader*. `preTaxContributions` was declared,
 * documented, carried through the portable file format and the Standing
 * Ledger, and read by no line of application code for as long as it existed —
 * so a household's 401(k) was asked for again by every tile that wanted it.
 * `county` was in the same state until the day the county taxes shipped.
 *
 * A profile field nobody reads is either dead weight in a file format people
 * carry between sessions, or a feature somebody stopped halfway. Both are worth
 * failing a build over, and neither is visible from the type.
 */
describe("every field in the profile is read by something", () => {
  const SRC = resolve(__dirname, "..", "..", "src");

  function readersOf(field: string): number {
    let count = 0;
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts") && !p.endsWith("situation.ts")) {
          count += readFileSync(p, "utf8").split(`get("${field}")`).length - 1;
        }
      }
    };
    walk(SRC);
    return count;
  }

  for (const field of Object.keys(EVERY_FIELD)) {
    it(`${field} is read somewhere in src/`, () => {
      expect(
        readersOf(field),
        `${field} is declared on the profile and nothing calls profile.get("${field}") — ` +
          "either wire it to the tile that should use it, or take it out of a file format " +
          "people carry between sessions",
      ).toBeGreaterThan(0);
    });
  }
});

describe("SituationStore", () => {
  it("stores values with provenance, defaulting to typed", () => {
    const s = new SituationStore();
    s.set("annualIncome", 85000);
    s.set("stateCode", "ca", "extracted");
    expect(s.get("annualIncome")).toBe(85000);
    expect(s.sourceOf("annualIncome")).toBe("typed");
    expect(s.sourceOf("stateCode")).toBe("extracted");
    expect(s.has("county")).toBe(false);
  });

  it("notifies subscribers on change and stops after unsubscribe", () => {
    const s = new SituationStore();
    let calls = 0;
    const off = s.subscribe(() => calls++);
    s.set("filingStatus", "single");
    s.set("annualIncome", 50000);
    expect(calls).toBe(2);
    off();
    s.set("annualIncome", 60000);
    expect(calls).toBe(2);
  });

  it("clears every field", () => {
    const s = new SituationStore();
    s.set("annualIncome", 85000);
    s.set("filingStatus", "married_jointly");
    s.clear();
    expect(s.has("annualIncome")).toBe(false);
    expect(s.entries()).toHaveLength(0);
  });

  it("round-trips through snapshot/load with an independent ages array", () => {
    const s = new SituationStore();
    s.set("householdSize", 3);
    s.set("ages", [40, 38, 7]);
    const snap = s.snapshot();

    const t = new SituationStore();
    t.load(snap);
    expect(t.get("householdSize")).toBe(3);
    expect(t.get("ages")).toEqual([40, 38, 7]);

    // Mutating the source must not bleed into the snapshot/loaded copy.
    s.get("ages")!.push(99);
    expect(t.get("ages")).toEqual([40, 38, 7]);
  });

  it("round-trips every field there is, not only the two this file used to set", () => {
    // A profile is carried between sessions as a file the user holds. A field
    // that snapshots but does not load back is a value the reader entered once
    // and silently lost — and it fails silently, because everything else in the
    // file still works.
    const s = new SituationStore();
    for (const [key, value] of Object.entries(EVERY_FIELD)) {
      s.set(key as SituationKey, value as never);
    }
    const t = new SituationStore();
    t.load(s.snapshot());
    for (const [key, value] of Object.entries(EVERY_FIELD)) {
      expect(t.get(key as SituationKey), `${key} did not survive the round trip`).toEqual(value);
    }
  });

  it("validates every field on load, so a new one cannot skip the value check", () => {
    // `load` is the gate: it parses a restored snapshot through
    // SituationValuesSchema so a NaN from a carried file cannot reach the tax
    // engine. A field added to the interface but not to the schema is dropped
    // by that parse — the same silent loss, arriving from the other direction —
    // so the two lists have to agree, and nothing but this says so.
    // The schema is wrapped in `.catch(...)`, so its object shape is one
    // unwrap in: `_def.innerType` is the ZodObject the keys live on.
    const inSchema = new Set(Object.keys(SituationValuesSchema._def.innerType.shape));
    const missing = Object.keys(EVERY_FIELD).filter((k) => !inSchema.has(k));
    expect(
      missing,
      `these fields exist on SituationValues but not in SituationValuesSchema, so a restored profile drops them: ${missing.join(", ")}`,
    ).toEqual([]);
  });
});
