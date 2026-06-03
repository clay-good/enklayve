import { describe, it, expect } from "vitest";
import { defineHub } from "../../src/tiles/hub";
import { SEARCH_ENTRIES } from "../../src/tiles/registry";
import { SituationStore } from "../../src/profile/situation";
import type { TileContext, TileDefinition } from "../../src/tiles/types";

/**
 * The hub factory (consolidation, 2026-06-02): one tile hosting several existing
 * calculators behind a segmented control, reusing their `mount` unchanged. These
 * guard the wrapped-context plumbing (the reserved `tool` key, sibling-navigate
 * remap, per-sub-tool explainer) and the deep-link search index.
 */

interface Captured {
  [id: string]: TileContext;
}

function fakeTool(id: string, title: string): TileDefinition {
  return {
    id,
    title,
    pillar: "stand",
    description: `${title} description`,
    keywords: [id, `${id}-keyword`],
    status: "ready",
    how: `How ${title} works`,
    mount: () => {},
  };
}

function buildHub(captured: Captured): TileDefinition {
  const tools = [fakeTool("alpha", "Alpha"), fakeTool("beta", "Beta")].map((t) => ({
    ...t,
    mount: (ctx: TileContext) => {
      captured[t.id] = ctx;
      ctx.root.append(
        Object.assign(document.createElement("div"), { className: "marker", textContent: t.id }),
      );
    },
  }));
  return defineHub({ id: "h", title: "Hub", pillar: "stand", description: "a hub", tools });
}

function outer(params = new URLSearchParams()): {
  ctx: TileContext;
  setParamsCalls: URLSearchParams[];
  navCalls: [string | null, URLSearchParams | undefined][];
} {
  const setParamsCalls: URLSearchParams[] = [];
  const navCalls: [string | null, URLSearchParams | undefined][] = [];
  const ctx: TileContext = {
    root: document.createElement("div"),
    params,
    setParams: (p) => setParamsCalls.push(p),
    permalink: (p) => `https://x/#/h?${(p ?? params).toString()}`,
    navigate: (id, p) => navCalls.push([id, p]),
    locale: "en-US",
    data: null,
    profile: new SituationStore(),
  };
  return { ctx, setParamsCalls, navCalls };
}

const markers = (ctx: TileContext): string[] =>
  Array.from(ctx.root.querySelectorAll(".marker")).map((n) => n.textContent ?? "");

describe("hub factory", () => {
  it("mounts the default (first) sub-tool when no tool param is set", () => {
    const captured: Captured = {};
    const hub = buildHub(captured);
    const { ctx } = outer();
    hub.mount!(ctx);
    expect(markers(ctx)).toEqual(["alpha"]);
    expect(ctx.root.querySelector(".hub-howres")?.textContent).toContain("How Alpha works");
  });

  it("mounts the sub-tool named by ?tool=", () => {
    const captured: Captured = {};
    const hub = buildHub(captured);
    const { ctx } = outer(new URLSearchParams({ tool: "beta" }));
    hub.mount!(ctx);
    expect(markers(ctx)).toEqual(["beta"]);
    expect(ctx.root.querySelector(".hub-howres")?.textContent).toContain("How Beta works");
  });

  it("falls back to the default when ?tool= is unknown", () => {
    const captured: Captured = {};
    const hub = buildHub(captured);
    const { ctx } = outer(new URLSearchParams({ tool: "nope" }));
    hub.mount!(ctx);
    expect(markers(ctx)).toEqual(["alpha"]);
  });

  it("the segmented control switches sub-tool, clears the old one, and writes ?tool=", () => {
    const captured: Captured = {};
    const hub = buildHub(captured);
    const { ctx, setParamsCalls } = outer();
    hub.mount!(ctx);

    const tabs = Array.from(ctx.root.querySelectorAll<HTMLButtonElement>(".segmented__btn"));
    expect(tabs.map((t) => t.textContent)).toEqual(["Alpha", "Beta"]);
    expect(ctx.root.querySelector(".segmented")?.getAttribute("role")).toBe("group");

    const beta = tabs.find((t) => t.dataset.tool === "beta")!;
    beta.click();
    // Only the new sub-tool is mounted (old content cleared).
    expect(markers(ctx)).toEqual(["beta"]);
    expect(beta.getAttribute("aria-pressed")).toBe("true");
    // Switching resets the URL to just the new tool (no stale sibling keys).
    const last = setParamsCalls.at(-1)!;
    expect(last.get("tool")).toBe("beta");
    expect([...last.keys()]).toEqual(["tool"]);
  });

  it("the wrapped setParams and permalink inject the reserved tool key", () => {
    const captured: Captured = {};
    const hub = buildHub(captured);
    const { ctx, setParamsCalls } = outer();
    hub.mount!(ctx);

    captured.alpha!.setParams(new URLSearchParams({ x: "1" }));
    const written = setParamsCalls.at(-1)!;
    expect(written.get("x")).toBe("1");
    expect(written.get("tool")).toBe("alpha");

    const link = captured.alpha!.permalink(new URLSearchParams({ y: "2" }));
    expect(link).toContain("y=2");
    expect(link).toContain("tool=alpha");
  });

  it("remaps a sub-tool navigating to a sibling into a hub deep link", () => {
    const captured: Captured = {};
    const hub = buildHub(captured);
    const { ctx, navCalls } = outer();
    hub.mount!(ctx);

    // alpha → beta is a sibling: should become navigate("h", ?tool=beta).
    captured.alpha!.navigate("beta");
    expect(navCalls.at(-1)![0]).toBe("h");
    expect(navCalls.at(-1)![1]?.get("tool")).toBe("beta");

    // A non-sibling id passes straight through.
    captured.alpha!.navigate("your-plan");
    expect(navCalls.at(-1)).toEqual(["your-plan", undefined]);
  });
});

describe("search index (deep links)", () => {
  it("carries a deep-link entry for each sub-tool and a plain entry for each hub", () => {
    const eitc = SEARCH_ENTRIES.find(
      (e) => e.title === "What Am I Owed Screener" || e.tool === "eitc",
    );
    expect(SEARCH_ENTRIES.some((e) => e.tool === "eitc" && e.hubId === "benefits")).toBe(true);
    expect(SEARCH_ENTRIES.some((e) => e.tool === "refinance" && e.hubId === "debt")).toBe(true);
    // Hubs themselves are searchable with no tool (open at their default).
    expect(SEARCH_ENTRIES.some((e) => e.hubId === "paycheck-taxes" && !e.tool)).toBe(true);
    // My Plan stays a standalone, tool-less entry.
    expect(SEARCH_ENTRIES.some((e) => e.hubId === "your-plan" && !e.tool)).toBe(true);
    expect(eitc).toBeTruthy();
  });
});
