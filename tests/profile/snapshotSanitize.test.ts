import { describe, it, expect } from "vitest";
import { sanitizeSnapshot, SituationStore } from "../../src/profile/situation";

/**
 * What a restored snapshot may put into the profile.
 *
 * `SituationStore.load` used to spread whatever it was handed straight into the
 * store, and neither path that reaches it checked the values: the ledger's file
 * schema says `values: z.record(z.string(), z.unknown())`, which checks that
 * `values` is an object and nothing about what is in it, and the portable
 * profile file checked only its format id. So a restore was a way into every
 * tile that the catalog's "no tile throws or paints a non-finite value" sweep
 * does not cover, because that sweep drives form inputs and deep links rather
 * than a restored profile. A `NaN` for `annualIncome` reached the tax engine
 * exactly as a typed one would.
 */
describe("sanitizing a restored snapshot", () => {
  it("keeps a good snapshot exactly as it came", () => {
    const snapshot = {
      values: { annualIncome: 82_000, filingStatus: "single", stateCode: "tx" },
      sources: { annualIncome: "typed", filingStatus: "typed", stateCode: "typed" },
    };
    expect(sanitizeSnapshot(snapshot)).toEqual(snapshot);
    // Key order too: a ledger file round-trips bit for bit and its situation is
    // this object.
    expect(Object.keys(sanitizeSnapshot(snapshot).values)).toEqual([
      "annualIncome",
      "filingStatus",
      "stateCode",
    ]);
  });

  it("drops a value that is not a number where a number belongs", () => {
    const clean = sanitizeSnapshot({
      values: { annualIncome: NaN, liquidSavings: Infinity, householdSize: "three" },
      sources: {},
    });
    expect(clean.values).toEqual({});
  });

  it("costs the bad field and not the rest of the file", () => {
    // There are no accounts here: the file is the only copy someone has, so a
    // restore that refuses everything over one bad field is the worse failure.
    const clean = sanitizeSnapshot({
      values: { annualIncome: NaN, liquidSavings: 4_000, stateCode: "ca" },
      sources: {},
    });
    expect(clean.values).toEqual({ liquidSavings: 4_000, stateCode: "ca" });
  });

  it("drops an unknown key rather than carrying it into the store", () => {
    const clean = sanitizeSnapshot({
      values: { annualIncome: 1, __proto__polluted: 1 },
      sources: {},
    });
    expect(Object.keys(clean.values)).toEqual(["annualIncome"]);
  });

  it("refuses a filing status the engine does not have", () => {
    expect(sanitizeSnapshot({ values: { filingStatus: "single" } }).values.filingStatus).toBe(
      "single",
    );
    expect(sanitizeSnapshot({ values: { filingStatus: "sole_trader" } }).values).toEqual({});
  });

  it("checks inside the arrays too", () => {
    expect(sanitizeSnapshot({ values: { ages: [34, 7] } }).values.ages).toEqual([34, 7]);
    expect(sanitizeSnapshot({ values: { ages: [34, NaN] } }).values).toEqual({});
    const debts = [{ name: "Visa", balance: 4_000, ratePct: 22.99 }];
    expect(sanitizeSnapshot({ values: { debts } }).values.debts).toEqual(debts);
    expect(
      sanitizeSnapshot({ values: { debts: [{ name: "Visa", balance: "lots", ratePct: 1 }] } })
        .values,
    ).toEqual({});
  });

  it("does not enforce economics, only shape", () => {
    // A negative balance or a zero income is a state a person can genuinely be
    // in, and the tiles handle it. A string where a number belongs is not.
    const clean = sanitizeSnapshot({ values: { annualIncome: 0, liquidSavings: -250 } });
    expect(clean.values).toEqual({ annualIncome: 0, liquidSavings: -250 });
  });

  it("drops provenance for a value that did not survive", () => {
    // Otherwise a field shows as "extracted" when it is not there at all.
    const clean = sanitizeSnapshot({
      values: { annualIncome: NaN },
      sources: { annualIncome: "extracted" },
    });
    expect(clean.sources).toEqual({});
  });

  it("never throws, whatever it is handed", () => {
    for (const junk of [null, undefined, 42, "text", [], { values: 7 }, { values: null }]) {
      expect(() => sanitizeSnapshot(junk)).not.toThrow();
    }
  });
});

describe("the store is where the check lives", () => {
  it("cleans on load, so every restore path is covered by one rule", () => {
    // Both the portable profile file and the Standing Ledger restore through
    // here. Checking in either caller would mean writing it twice.
    const store = new SituationStore();
    store.load({
      values: { annualIncome: NaN, liquidSavings: 900 },
      sources: {},
    } as never);
    expect(store.snapshot().values.annualIncome).toBeUndefined();
    expect(store.snapshot().values.liquidSavings).toBe(900);
  });
});
