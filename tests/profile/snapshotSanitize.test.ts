import { describe, it, expect } from "vitest";
import { MAX_PROFILE_ROWS, sanitizeSnapshot, SituationStore } from "../../src/profile/situation";
import { MAX_INPUT_MAGNITUDE } from "../../src/ui/form";

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

/**
 * The shape check was the first half of this boundary and it was the only half.
 *
 * `NaN` and a string where a number belongs were caught; a **finite** figure of
 * any size was not, and neither was a list of any length. Both of those are the
 * things the *other* door into a tile — a typed field or a deep link, through
 * `parseNonNegative` — has always stopped, and a restored file is the door that
 * carries a whole situation at once rather than one field.
 */
describe("a restored snapshot cannot be absurd, only wrong", () => {
  it("clamps a finite-but-enormous value instead of letting it reach Money", () => {
    // `?bal=1e308` used to throw a RangeError out of `Money.from` and render a
    // blank page for sixteen tiles. The same value in a profile file blanked
    // the Downshift tile, by the same overflow, one door further in.
    const clean = sanitizeSnapshot({ values: { annualIncome: 1e308, liquidSavings: -1e308 } });
    expect(clean.values.annualIncome).toBe(MAX_INPUT_MAGNITUDE);
    expect(clean.values.liquidSavings).toBe(-MAX_INPUT_MAGNITUDE);
  });

  it("clamps rather than drops, so the figure stays visible and editable", () => {
    // Dropping it would be the other defensible answer, and it is the worse
    // one: a value that vanished from My Situation on restore is a field the
    // person has to notice is gone.
    expect(sanitizeSnapshot({ values: { annualIncome: 1e308 } }).values.annualIncome).toBeDefined();
  });

  it("leaves every figure a household could really hold exactly as it was", () => {
    const real = { annualIncome: 82_000, liquidSavings: 0, essentialMonthlyExpenses: 3_412.75 };
    expect(sanitizeSnapshot({ values: real }).values).toEqual(real);
  });

  it("caps how many rows a restored list may carry", () => {
    // A magnitude ceiling stops one absurd value and says nothing about an
    // absurd count. 50,000 debts in a file took the Debt Freedom tile past
    // eight seconds and twelve thousand DOM nodes before the tab stopped
    // answering — the freeze the horizon caps exist to prevent, through the
    // one door with no cap on it.
    const many = sanitizeSnapshot({
      values: {
        ages: Array.from({ length: 50_000 }, () => 40),
        debts: Array.from({ length: 50_000 }, (_, i) => ({
          name: `d${i}`,
          balance: 1_000,
          ratePct: 20,
        })),
      },
    });
    expect(many.values.ages).toHaveLength(MAX_PROFILE_ROWS);
    expect(many.values.debts).toHaveLength(MAX_PROFILE_ROWS);
    // The rows that survive are the ones the file listed first, unchanged.
    expect(many.values.debts?.[0]).toEqual({ name: "d0", balance: 1_000, ratePct: 20 });
  });

  it("leaves a household's real list alone", () => {
    const debts = [
      { name: "Card", balance: 4_200, ratePct: 24.99 },
      { name: "Car", balance: 11_800, ratePct: 6.4 },
    ];
    expect(sanitizeSnapshot({ values: { debts, ages: [38, 36, 7] } }).values).toEqual({
      debts,
      ages: [38, 36, 7],
    });
  });

  it("clamps inside a row, not just at the top level", () => {
    const clean = sanitizeSnapshot({
      values: { debts: [{ name: "Card", balance: 1e308, ratePct: 1e308 }] },
    });
    expect(clean.values.debts?.[0]?.balance).toBe(MAX_INPUT_MAGNITUDE);
    expect(clean.values.debts?.[0]?.ratePct).toBe(MAX_INPUT_MAGNITUDE);
  });
});

/**
 * The ceiling belongs on the write, not on each entrance.
 *
 * `load` is one of two ways a value gets in and `set` is the other, and `set`
 * had no check at all — the Readout writes every confirmed field from a
 * document through it, and a tile writing a value it computed rather than
 * parsed has no parse boundary to go through either.
 */
describe("the store bounds a direct write too", () => {
  it("clamps a number written straight in", () => {
    const store = new SituationStore();
    store.set("annualIncome", 1e300, "extracted");
    expect(store.get("annualIncome")).toBe(MAX_INPUT_MAGNITUDE);
  });

  it("clamps inside a list and caps its length", () => {
    const store = new SituationStore();
    store.set(
      "debts",
      Array.from({ length: 5_000 }, () => ({ name: "d", balance: 1e300, ratePct: 20 })),
    );
    expect(store.get("debts")).toHaveLength(MAX_PROFILE_ROWS);
    expect(store.get("debts")?.[0]?.balance).toBe(MAX_INPUT_MAGNITUDE);
  });

  it("leaves a real value and a real list untouched", () => {
    const store = new SituationStore();
    const debts = [{ name: "Card", balance: 4_200, ratePct: 24.99 }];
    store.set("annualIncome", 82_000);
    store.set("debts", debts);
    store.set("stateCode", "tx");
    expect(store.get("annualIncome")).toBe(82_000);
    expect(store.get("debts")).toEqual(debts);
    expect(store.get("stateCode")).toBe("tx");
  });
});
