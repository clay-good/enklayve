import { describe, it, expect } from "vitest";
import { renderHome } from "../src/ui/shell";

describe("shell home view", () => {
  it("renders the enklayve hero and the pillar grid", () => {
    const root = document.createElement("main");
    renderHome(
      root,
      () => {},
      () => {},
    );
    expect(root.querySelector(".hero-title")?.textContent).toContain("Know where you stand");
    // One card per pillar (Take Home, Owed, Safe Harbor, Your Plan).
    expect(root.querySelectorAll(".pillar-card").length).toBe(4);
    // The fully-built Take-Home Pay tile is listed.
    const links = Array.from(root.querySelectorAll(".tile-link-title")).map((n) => n.textContent);
    expect(links).toContain("Take-Home Pay");
  });
});
