/**
 * The hub factory (consolidation pass, 2026-06-02). A "hub" is one tile that
 * hosts several related calculators behind a segmented control, so the catalog
 * shows ~10 calm topic areas instead of 53 separate tools. Crucially it REUSES
 * each calculator's existing `mount` unchanged: the hub mounts the active
 * sub-tool into a sub-container with a thin wrapped TileContext that
 *   - keeps a reserved `tool` URL key so a hub view is deep-linkable/shareable,
 *   - resets the URL on a tool switch so one sub-tool's keys never leak to the
 *     next, and
 *   - remaps a sub-tool's `navigate(<sibling id>)` to this hub + `?tool=<id>`
 *     (e.g. Pell linking to the FAFSA SAI estimator, now its sibling).
 * The sub-tool's own "How this works" + resources render under it; the hub
 * itself defines no `how`, so the shell appends only the privacy promise.
 */
import { el, clear } from "../ui/dom";
import { tileHowResources } from "../ui/explainer";
import type { Pillar, TileContext, TileDefinition } from "./types";

export interface HubConfig {
  id: string;
  title: string;
  pillar: Pillar;
  description: string;
  /** The calculators this hub hosts (their existing tile definitions). */
  tools: TileDefinition[];
  /** Sub-tool id shown first; defaults to the first tool. Plan deep-links rely
   *  on this matching the step's target (e.g. debt → debt-freedom). */
  defaultTool?: string;
}

/** Reserved URL key that selects the active sub-tool within a hub. */
export const HUB_TOOL_KEY = "tool";

function pickActive(raw: string | null, tools: TileDefinition[], fallback: string): string {
  return raw && tools.some((t) => t.id === raw) ? raw : fallback;
}

export function defineHub(config: HubConfig): TileDefinition {
  const { id, title, pillar, description, tools } = config;
  const fallback = config.defaultTool ?? tools[0]!.id;

  return {
    id,
    title,
    pillar,
    description,
    status: "ready",
    // Aggregate sub-tool keywords so the hub itself is still findable; direct
    // per-sub-tool search uses the registry's SEARCH_ENTRIES.
    keywords: Array.from(new Set(tools.flatMap((t) => [t.title, ...t.keywords]))),
    mount: (ctx) => mountHub(ctx, config, fallback),
  };
}

function mountHub(ctx: TileContext, config: HubConfig, fallback: string): void {
  const { id, tools } = config;
  clear(ctx.root);

  let activeId = pickActive(ctx.params.get(HUB_TOOL_KEY), tools, fallback);
  // The params the active sub-tool reads. Starts from the deep-linked URL and is
  // replaced with a clean slate when the user switches tools.
  let currentParams = ctx.params;

  // A segmented button group (role="group" + aria-pressed), not a tablist: there
  // is no separate tabpanel element, and a pressed-button group is the
  // unambiguous, axe-clean a11y pattern for "pick one of these calculators."
  const seg = el("div", {
    class: "segmented",
    attrs: { role: "group", "aria-label": `${config.title} tools` },
  });
  const subContainer = el("div", { class: "hub-tool" });
  const explainerHost = el("div", { class: "hub-howres" });

  const activeTool = (): TileDefinition => tools.find((t) => t.id === activeId) ?? tools[0]!;

  function wrappedCtx(tool: TileDefinition): TileContext {
    return {
      root: subContainer,
      params: currentParams,
      setParams: (p) => {
        const merged = new URLSearchParams(p);
        merged.set(HUB_TOOL_KEY, tool.id);
        currentParams = merged;
        ctx.setParams(merged);
      },
      permalink: (p) => {
        const merged = new URLSearchParams(p ?? currentParams);
        merged.set(HUB_TOOL_KEY, tool.id);
        return ctx.permalink(merged);
      },
      navigate: (tileId, params) => {
        if (tileId && tools.some((t) => t.id === tileId)) {
          ctx.navigate(id, new URLSearchParams({ [HUB_TOOL_KEY]: tileId }));
        } else {
          ctx.navigate(tileId, params);
        }
      },
      locale: ctx.locale,
      data: ctx.data,
      profile: ctx.profile,
    };
  }

  function syncSegments(): void {
    for (const btn of seg.querySelectorAll<HTMLButtonElement>(".segmented__btn")) {
      const on = btn.dataset.tool === activeId;
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.classList.toggle("is-active", on);
    }
  }

  function renderTool(): void {
    const tool = activeTool();
    const wc = wrappedCtx(tool);
    clear(subContainer);
    tool.mount?.(wc);
    clear(explainerHost);
    const howres = tileHowResources(tool, wc.navigate);
    if (howres) explainerHost.append(howres);
    syncSegments();
  }

  for (const tool of tools) {
    const btn = el("button", {
      type: "button",
      class: "segmented__btn",
      text: tool.title,
      attrs: { "aria-pressed": tool.id === activeId ? "true" : "false" },
      on: {
        click: () => {
          if (activeId === tool.id) return;
          activeId = tool.id;
          // A clean slate so the previous sub-tool's URL keys don't bleed in.
          currentParams = new URLSearchParams({ [HUB_TOOL_KEY]: activeId });
          ctx.setParams(currentParams);
          renderTool();
        },
      },
    });
    btn.dataset.tool = tool.id;
    if (tool.id === activeId) btn.classList.add("is-active");
    seg.append(btn);
  }

  ctx.root.append(seg, subContainer, explainerHost);
  renderTool();
}
