import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { renderHome, renderAbout, renderAllTools, renderReadout, mountApp } from "../src/ui/shell";
import { loadBundledData, type BundledData } from "../src/data/browser";
import { SituationStore } from "../src/profile/situation";

describe("shell home view (redesigned 2026-06-01)", () => {
  it("leads with hero, dropzone, and the budget (no tool grid, no search box)", () => {
    const root = document.createElement("main");
    renderHome(root, () => {});
    expect(root.querySelector(".hero-title")?.textContent).toContain("made simple");
    // The Readout dropzone (BUILD-SPEC-2 §1.1) and the budget remain.
    expect(root.querySelector(".readout-dropzone")).not.toBeNull();
    expect(root.querySelector(".home-budget")).not.toBeNull();
    // The home search box and the tool grid are both gone; tools are reached via
    // the All Tools index (footer) and the ⌘K palette.
    expect(root.querySelector(".home-search")).toBeNull();
    expect(root.querySelector(".home-tools-group")).toBeNull();
    expect(root.querySelectorAll(".tile-link-title").length).toBe(0);
  });

  it("the document title is just the brand", () => {
    const root = document.createElement("main");
    renderHome(root, () => {});
    expect(document.title).toBe("enklayve");
  });

  it("the dropzone navigates to the Readout", () => {
    const root = document.createElement("main");
    const navigate = vi.fn();
    renderHome(root, navigate);
    root.querySelector<HTMLButtonElement>(".readout-dropzone")?.click();
    expect(navigate).toHaveBeenCalledWith("readout");
  });

  it("no longer shows the hero CTA or the 'see your plan' hint (My Plan retired)", () => {
    const root = document.createElement("main");
    renderHome(root, () => {});
    expect(root.querySelector(".hero-cta-btn")).toBeNull();
    expect(root.querySelector(".home-start-hint")).toBeNull();
  });
});

describe("home budget — the one and only budget (consolidated 2026-06-02)", () => {
  let data: BundledData;
  beforeAll(async () => {
    data = await loadBundledData();
  });

  it("renders the full calculator: income + frequency + filing + state controls", () => {
    const root = document.createElement("main");
    renderHome(root, () => {}, data);
    const budget = root.querySelector(".home-budget")!;
    expect(budget.querySelector(".home-budget__title")?.textContent).toContain("60 seconds");
    const aria = (label: string): Element | null => budget.querySelector(`[aria-label="${label}"]`);
    expect(aria("Income")).not.toBeNull();
    expect(aria("How often you're paid")?.tagName).toBe("SELECT");
    expect(aria("Filing status")?.tagName).toBe("SELECT");
    expect(aria("State")?.tagName).toBe("SELECT");
    // The expense and investing rows are present.
    expect(aria("Housing")).not.toBeNull();
    expect(aria("Retirement investments")).not.toBeNull();
    expect(aria("Brokerage")).not.toBeNull();
  });

  it("lists all 50 states plus DC in the state dropdown", () => {
    const root = document.createElement("main");
    renderHome(root, () => {}, data);
    const state = root.querySelector<HTMLSelectElement>('[aria-label="State"]')!;
    const labels = Array.from(state.options).map((o) => o.textContent);
    // Placeholder + 50 states + District of Columbia.
    expect(state.options.length).toBe(52);
    expect(labels).toContain("California");
    expect(labels).toContain("Texas");
    expect(labels).toContain("Wyoming");
    expect(labels).toContain("District of Columbia");
  });

  it("shows an honest note when a state's income tax isn't modeled yet", () => {
    const root = document.createElement("main");
    renderHome(root, () => {}, data);
    const note = root.querySelector<HTMLElement>(".home-budget__note")!;
    expect(note.hidden).toBe(true); // no state selected yet
    const state = root.querySelector<HTMLSelectElement>('[aria-label="State"]')!;
    // New Jersey has an income tax but isn't modeled → the note appears.
    state.value = "nj";
    state.dispatchEvent(new Event("change"));
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain("New Jersey");
    // California IS modeled → no note.
    state.value = "ca";
    state.dispatchEvent(new Event("change"));
    expect(note.hidden).toBe(true);
  });

  it("auto-computes taxes through the tax engine (not a manual field)", () => {
    const root = document.createElement("main");
    renderHome(root, () => {}, data);
    // Taxes is a derived, read-only line, not an editable input.
    expect(root.querySelector('[aria-label="Taxes"]')).toBeNull();
    const taxes = root.querySelector(".home-budget__derived-value")?.textContent ?? "";
    // $5,000/mo single, no state → real federal + FICA, well above zero.
    expect(taxes.startsWith("$")).toBe(true);
    expect(taxes).not.toBe("$0");
  });

  it("reports total expenses, total investments, take-home pay, and both investment rates", () => {
    const root = document.createElement("main");
    renderHome(root, () => {}, data);
    const labels = Array.from(root.querySelectorAll(".home-budget__stat-label")).map(
      (n) => n.textContent,
    );
    expect(labels).toContain("Total expenses");
    expect(labels).toContain("Total investments");
    // Net income is now take-home pay (income minus taxes only, not expenses).
    expect(labels.some((l) => l?.includes("Take-home pay"))).toBe(true);
    expect(labels.some((l) => l?.includes("gross income"))).toBe(true);
    expect(labels.some((l) => l?.includes("take-home pay"))).toBe(true);
    // The investment rates render as percentages.
    const values = Array.from(
      root.querySelectorAll(".home-budget__stat--strong .home-budget__stat-value"),
    ).map((n) => n.textContent);
    expect(values.every((v) => v?.endsWith("%") || v === "—")).toBe(true);
  });

  it("drops the 'open the full budget' hop and closes with the anti-budget note", () => {
    const root = document.createElement("main");
    renderHome(root, () => {}, data);
    const buttons = Array.from(root.querySelectorAll("button")).map((b) => b.textContent ?? "");
    expect(buttons.some((t) => t.toLowerCase().includes("open the full budget"))).toBe(false);
    expect(root.querySelector(".budget-why__title")?.textContent).toBe(
      "The anti-budget: give every dollar a job",
    );
    // Split into labeled parts so it reads fast and scans well.
    expect(root.querySelectorAll(".budget-why__subhead").length).toBe(3);
  });

  it("the budget still renders without data (taxes held at zero, no crash)", () => {
    const root = document.createElement("main");
    renderHome(root, () => {}); // no data argument
    expect(root.querySelector(".home-budget")).not.toBeNull();
    expect(root.querySelector(".home-budget__derived-value")?.textContent).toBe("$0");
  });
});

describe("shell chrome (header + footer)", () => {
  afterEach(() => document.body.replaceChildren());

  it("header is just the wordmark + lowercase tagline — no toggle, no buttons", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    await mountApp(root);
    const header = root.querySelector(".app-header")!;
    expect(header.querySelector(".wordmark")?.textContent).toBe("enklayve");
    expect(header.querySelector(".wordmark-tagline")?.textContent).toBe("personal finance");
    // Single light theme: no theme toggle anywhere, and no old header controls.
    expect(header.querySelector(".theme-toggle")).toBeNull();
    expect(root.querySelector(".theme-toggle")).toBeNull();
    expect(header.textContent).not.toContain("Search tools");
    expect(header.textContent).not.toContain("My Situation");
  });

  it("footer holds uniform buttons (All tools, Why enklayve, GitHub); My situation is gone", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    await mountApp(root);
    const labels = Array.from(root.querySelectorAll(".app-footer .footer-btn")).map(
      (b) => b.textContent,
    );
    expect(labels).toContain("All tools");
    expect(labels).toContain("Why enklayve");
    expect(labels).toContain("GitHub");
    // The My Situation panel was retired; its footer button is gone.
    expect(labels).not.toContain("My situation");
    expect(labels.some((t) => t?.toLowerCase().includes("contrast"))).toBe(false);
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
  it("lists every hub and every calculator it hosts", () => {
    const root = document.createElement("main");
    renderAllTools(root, () => {});
    // The topic hubs are the headings.
    const hubs = Array.from(root.querySelectorAll(".all-tools-hub")).map((n) => n.textContent);
    expect(hubs).toContain("Paycheck & Taxes");
    expect(hubs).toContain("Benefits & Aid");
    expect(hubs).not.toContain("My Plan");
    // Individual calculators are now listed by name under their hub, so the
    // browse path reaches every tool, not just the 10 hubs.
    const tools = Array.from(root.querySelectorAll(".tile-link-title")).map((n) => n.textContent);
    expect(tools).toContain("Take-Home Pay");
    expect(tools).toContain("Earned Income Tax Credit");
    expect(tools).toContain("Roth Conversion Ladder");
    expect(new Set(tools).size).toBe(tools.length);
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
