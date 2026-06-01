import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHome, renderAbout, renderAllTools, renderReadout, mountApp } from "../src/ui/shell";
import { SituationStore } from "../src/profile/situation";

describe("shell home view (redesigned 2026-06-01)", () => {
  it("renders the three calm zones: hero, dropzone, live search, then all tools grouped", () => {
    const root = document.createElement("main");
    renderHome(root, () => {});
    expect(root.querySelector(".hero-title")?.textContent).toContain("made simple");
    // Zone 1: the Readout dropzone (BUILD-SPEC-2 §1.1).
    expect(root.querySelector(".readout-dropzone")).not.toBeNull();
    // Zone 2: a live search combobox (no longer only the ⌘K palette).
    const search = root.querySelector<HTMLInputElement>(".home-search-input");
    expect(search).not.toBeNull();
    expect(search?.getAttribute("role")).toBe("combobox");
    expect(search?.getAttribute("aria-expanded")).toBe("false");
    // Zone 3: every tool, grouped under plain-language headings (the teaching
    // journey and the eight-category grid are both gone).
    expect(root.querySelector(".journey-step")).toBeNull();
    expect(root.querySelectorAll(".home-tools-group").length).toBeGreaterThanOrEqual(8);
    const titles = Array.from(root.querySelectorAll(".tile-link-title")).map((n) => n.textContent);
    expect(titles).toContain("Take-Home Pay");
    expect(titles).toContain("My Plan");
  });

  it("the dropzone navigates to the Readout", () => {
    const root = document.createElement("main");
    const navigate = vi.fn();
    renderHome(root, navigate);
    root.querySelector<HTMLButtonElement>(".readout-dropzone")?.click();
    expect(navigate).toHaveBeenCalledWith("readout");
  });

  it("live search reveals matching tools as you type, and a result opens its tool", () => {
    const root = document.createElement("main");
    const navigate = vi.fn();
    renderHome(root, navigate);
    const input = root.querySelector<HTMLInputElement>(".home-search-input")!;
    const results = root.querySelector<HTMLElement>(".home-search-results")!;
    expect(results.hidden).toBe(true);
    input.value = "take home";
    input.dispatchEvent(new Event("input"));
    expect(results.hidden).toBe(false);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    const first = results.querySelector<HTMLElement>(".home-search-opt");
    expect(first?.textContent).toContain("Take-Home Pay");
    first?.click();
    expect(navigate).toHaveBeenCalledWith("take-home");
  });

  it("the 'see your plan' hint opens My Plan", () => {
    const root = document.createElement("main");
    const navigate = vi.fn();
    renderHome(root, navigate);
    root.querySelector<HTMLButtonElement>(".home-start-link")?.click();
    expect(navigate).toHaveBeenCalledWith("your-plan");
  });
});

describe("shell chrome (header + footer, redesigned 2026-06-01)", () => {
  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
    document.documentElement.removeAttribute("data-theme");
    document.body.replaceChildren();
  });
  afterEach(() => document.body.replaceChildren());

  it("header is just the wordmark + lowercase tagline and a sun/moon toggle", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    await mountApp(root);
    const header = root.querySelector(".app-header")!;
    expect(header.querySelector(".wordmark")?.textContent).toBe("enklayve");
    expect(header.querySelector(".wordmark-tagline")?.textContent).toBe("personal finance counsel");
    expect(header.querySelector(".theme-toggle svg")).not.toBeNull();
    // The old header controls are gone (BUILD-SPEC-2 §0.7).
    expect(header.textContent).not.toContain("Search tools");
    expect(header.textContent).not.toContain("My Situation");
  });

  it("footer holds uniform buttons including My situation and the high-contrast toggle", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    await mountApp(root);
    const labels = Array.from(root.querySelectorAll(".app-footer .footer-btn")).map(
      (b) => b.textContent,
    );
    expect(labels).toContain("My situation");
    expect(labels.some((t) => t?.startsWith("High contrast"))).toBe(true);
    expect(labels).toContain("Why enklayve");
  });

  it("the sun/moon flips light <-> dark, reading the live theme (works without storage)", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    await mountApp(root);
    const toggle = root.querySelector<HTMLButtonElement>(".theme-toggle")!;
    toggle.click();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    toggle.click();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("the footer high-contrast toggle turns the third theme on and off", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    await mountApp(root);
    const hc = Array.from(root.querySelectorAll<HTMLButtonElement>(".app-footer .footer-btn")).find(
      (b) => b.textContent?.startsWith("High contrast"),
    )!;
    hc.click();
    expect(document.documentElement.getAttribute("data-theme")).toBe("high-contrast");
    expect(hc.getAttribute("aria-pressed")).toBe("true");
    hc.click();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
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
