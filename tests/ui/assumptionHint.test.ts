import { describe, it, expect } from "vitest";
import { assumptionHint } from "../../src/ui/form";

/**
 * The calm assumption-band hint (SPEC-3 §2.4 / hardening B2). It is a pure,
 * non-blocking signal — never a clamp — that a labeled rate left any defensible
 * band, so an extreme scenario reads as a stress case rather than a fact. Pinned
 * here as a shared primitive; the per-tile wiring is pinned in the tile tests.
 */
const BAND = { low: -20, high: 20, label: "Home appreciation" };

describe("assumptionHint", () => {
  it("returns null inside the band, including the inclusive edges", () => {
    expect(assumptionHint(0, BAND)).toBeNull();
    expect(assumptionHint(-20, BAND)).toBeNull();
    expect(assumptionHint(20, BAND)).toBeNull();
  });

  it("flags a value above the band as unusually high", () => {
    const hint = assumptionHint(35, BAND);
    expect(hint).not.toBeNull();
    expect(hint!.className).toBe("assumption-hint");
    expect(hint!.getAttribute("role")).toBe("note");
    expect(hint!.textContent).toContain("Home appreciation of 35.0% is unusually high");
    expect(hint!.textContent).toContain("stress scenario, not a recommendation");
  });

  it("flags a value below the band as unusually low", () => {
    const hint = assumptionHint(-50, BAND);
    expect(hint!.textContent).toContain("Home appreciation of -50.0% is unusually low");
  });

  it("never renders NaN/Infinity text for a non-finite input", () => {
    expect(assumptionHint(Number.NaN, BAND)).toBeNull();
    expect(assumptionHint(Number.POSITIVE_INFINITY, BAND)).toBeNull();
  });

  it("is deterministic — the same input yields the same message", () => {
    expect(assumptionHint(35, BAND)!.textContent).toBe(assumptionHint(35, BAND)!.textContent);
  });
});
