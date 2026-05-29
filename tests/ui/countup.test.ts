import { describe, it, expect, afterEach, vi } from "vitest";
import { countUp } from "../../src/ui/countup";

function stubReducedMotion(matches: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe("count-up reveal", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sets the final value immediately when motion is reduced", () => {
    stubReducedMotion(true);
    const node = document.createElement("output");
    const cancel = countUp(node, 1234, (n) => `$${n.toFixed(0)}`);
    expect(node.textContent).toBe("$1234");
    cancel();
  });

  it("settles on the final value when cancelled mid-animation", () => {
    stubReducedMotion(false);
    const node = document.createElement("output");
    const cancel = countUp(node, 500, (n) => `$${n.toFixed(0)}`);
    cancel();
    expect(node.textContent).toBe("$500");
  });
});
