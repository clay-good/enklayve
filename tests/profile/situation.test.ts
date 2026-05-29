import { describe, it, expect } from "vitest";
import { SituationStore } from "../../src/profile/situation";

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
});
