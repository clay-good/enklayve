import { describe, it, expect, vi } from "vitest";
import { renderHome, renderAllTools, renderReadout } from "../src/ui/shell";
import { SituationStore } from "../src/profile/situation";

describe("shell home view", () => {
  it("renders the hero, the Readout dropzone, the pillar cards, and the All Tools card", () => {
    const root = document.createElement("main");
    renderHome(
      root,
      () => {},
      () => {},
    );
    expect(root.querySelector(".hero-title")?.textContent).toContain("Know where you stand");
    // The Readout dropzone is the hero (BUILD-SPEC-2 §1.1).
    expect(root.querySelector(".readout-dropzone")).not.toBeNull();
    // One expandable card per pillar (Take Home, Owed, Safe Harbor, Your Plan).
    expect(root.querySelectorAll("details.pillar-card").length).toBe(4);
    // Plus a dedicated All Tools index card, not a mega dropdown.
    expect(root.querySelector(".index-card")).not.toBeNull();
    // The fully-built Take-Home Pay tile is reachable from a card.
    const links = Array.from(root.querySelectorAll(".tile-link-title")).map((n) => n.textContent);
    expect(links).toContain("Take-Home Pay");
  });

  it("the dropzone navigates to the Readout", () => {
    const root = document.createElement("main");
    const navigate = vi.fn();
    renderHome(root, navigate, () => {});
    root.querySelector<HTMLButtonElement>(".readout-dropzone")?.click();
    expect(navigate).toHaveBeenCalledWith("readout");
  });

  it("the All Tools card navigates to the index", () => {
    const root = document.createElement("main");
    const navigate = vi.fn();
    renderHome(root, navigate, () => {});
    root.querySelector<HTMLButtonElement>(".index-card")?.click();
    expect(navigate).toHaveBeenCalledWith("all-tools");
  });
});

describe("All Tools index view", () => {
  it("lists every tile, grouped by pillar", () => {
    const root = document.createElement("main");
    renderAllTools(root, () => {});
    const titles = Array.from(root.querySelectorAll(".tile-link-title")).map((n) => n.textContent);
    // Every registry tile appears exactly once (the static tools.html mirrors this).
    expect(titles).toContain("Take-Home Pay");
    expect(titles).toContain("What Am I Owed Screener");
    expect(titles).toContain("My Plan");
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe("Readout view", () => {
  it("renders the live dropzone and the on-device privacy promise", () => {
    const root = document.createElement("main");
    renderReadout({ container: root, navigate: () => {}, profile: new SituationStore() });
    expect(root.querySelector(".tile-title")?.textContent).toContain("Readout");
    expect(root.querySelector(".readout-dropzone--live")).not.toBeNull();
    expect(root.querySelector('input[type="file"]')).not.toBeNull();
    expect(root.textContent).toContain("never uploaded");
    expect(root.textContent).toContain("connect-src 'none'");
  });
});
