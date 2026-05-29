import { describe, it, expect } from "vitest";
import { renderHello } from "../src/main";

describe("Phase 0 hello page", () => {
  it("renders the enklayve wordmark", () => {
    const root = document.createElement("main");
    renderHello(root);
    const heading = root.querySelector("h1");
    expect(heading?.textContent).toBe("enklayve");
  });
});
