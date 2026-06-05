import { describe, it, expect } from "vitest";
import { parseHash, buildHash } from "../../src/ui/router";

describe("fragment router", () => {
  it("parses the home route from an empty or bare hash", () => {
    expect(parseHash("").tileId).toBeNull();
    expect(parseHash("#").tileId).toBeNull();
    expect(parseHash("#/").tileId).toBeNull();
  });

  it("parses a tile id with no params", () => {
    const route = parseHash("#/take-home");
    expect(route.tileId).toBe("take-home");
    expect(route.params.toString()).toBe("");
  });

  it("round-trips tile state through the fragment", () => {
    const params = new URLSearchParams({ fs: "single", w: "85000", st: "ca" });
    const hash = buildHash("take-home", params);
    const route = parseHash(hash);
    expect(route.tileId).toBe("take-home");
    expect(route.params.get("w")).toBe("85000");
    expect(route.params.get("st")).toBe("ca");
    expect(route.params.get("fs")).toBe("single");
  });

  it("omits the query when there are no params", () => {
    expect(buildHash("take-home")).toBe("#/take-home");
    expect(buildHash(null)).toBe("#");
  });

  it("tolerates a malformed percent-sequence instead of throwing", () => {
    // A garbled link must not crash routing (it would blank the page); it falls
    // back to the raw text, which resolves to an unknown tile → the home.
    expect(() => parseHash("#/%")).not.toThrow();
    expect(() => parseHash("#/%zz")).not.toThrow();
    expect(parseHash("#/%").tileId).toBe("%");
    // A malformed percent in a query value is likewise tolerated.
    expect(() => parseHash("#/debt?c0=%E0%A4%A")).not.toThrow();
  });

  it("round-trips text values with URL-special characters", () => {
    const params = new URLSearchParams({ c0: "Card & Loan #1 = 50%" });
    const route = parseHash(buildHash("debt", params));
    expect(route.tileId).toBe("debt");
    expect(route.params.get("c0")).toBe("Card & Loan #1 = 50%");
  });
});
