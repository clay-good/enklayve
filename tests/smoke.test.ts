import { describe, it, expect, vi } from "vitest";
import { renderHome, renderAbout, renderAllTools, renderReadout } from "../src/ui/shell";
import { SituationStore } from "../src/profile/situation";

describe("shell home view", () => {
  it("renders the hero, the Readout dropzone, and the teaching journey (not a category grid)", () => {
    const root = document.createElement("main");
    renderHome(root, () => {});
    expect(root.querySelector(".hero-title")?.textContent).toContain("Know where you stand");
    // The Readout dropzone is the hero (BUILD-SPEC-2 §1.1).
    expect(root.querySelector(".readout-dropzone")).not.toBeNull();
    // The home leads with the ordered journey, one card per plan step (the
    // browse spine, 2026-05-30) — the eight-category grid is gone.
    expect(root.querySelectorAll(".journey-step").length).toBe(7);
    expect(root.querySelector("details.pillar-card")).toBeNull();
    // Each step teaches a lesson and links to its tool.
    const titles = Array.from(root.querySelectorAll(".journey-step-title")).map(
      (n) => n.textContent,
    );
    expect(titles[0]).toContain("cushion");
    expect(root.querySelectorAll(".journey-open").length).toBe(7);
    // And a quiet escape hatch to the full catalog.
    expect(root.querySelector(".home-browse-link")).not.toBeNull();
  });

  it("the dropzone navigates to the Readout", () => {
    const root = document.createElement("main");
    const navigate = vi.fn();
    renderHome(root, navigate);
    root.querySelector<HTMLButtonElement>(".readout-dropzone")?.click();
    expect(navigate).toHaveBeenCalledWith("readout");
  });

  it("the first step links to its tool and the CTA opens My Plan", () => {
    const root = document.createElement("main");
    const navigate = vi.fn();
    renderHome(root, navigate);
    root.querySelector<HTMLButtonElement>(".journey-open")?.click();
    expect(navigate).toHaveBeenCalledWith("peace-of-mind");
    root.querySelector<HTMLButtonElement>(".journey-cta")?.click();
    expect(navigate).toHaveBeenCalledWith("your-plan");
  });

  it("the browse-all link navigates to the index", () => {
    const root = document.createElement("main");
    const navigate = vi.fn();
    renderHome(root, navigate);
    root.querySelector<HTMLButtonElement>(".home-browse-link")?.click();
    expect(navigate).toHaveBeenCalledWith("all-tools");
  });
});

describe("Why enklayve (about) view", () => {
  it("renders the trust story moved off the home, with a heading-one", () => {
    const root = document.createElement("main");
    renderAbout(root, () => {});
    expect(root.querySelector("h1.tile-title")?.textContent).toBe("Why enklayve");
    expect(root.querySelector(".home-explainer")).not.toBeNull();
    expect(root.textContent).toContain("Free, forever");
  });

  it("the back link returns home", () => {
    const root = document.createElement("main");
    const navigate = vi.fn();
    renderAbout(root, navigate);
    root.querySelector<HTMLButtonElement>(".back-link")?.click();
    expect(navigate).toHaveBeenCalledWith(null);
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
