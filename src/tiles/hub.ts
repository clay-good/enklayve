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
 * The sub-tool's own "How this works" + resources render under it, so the hub
 * normally defines no `how` and the shell appends only the privacy promise. The
 * one exception is a Pillar 4 hub at harm tier 2 or 3, which carries a `how` so
 * the release audit can see the advice line the bar requires (SPEC-4 §3.2).
 */
import { el, clear } from "../ui/dom";
import { tileHowResources } from "../ui/explainer";
import type { Pillar, TileContext, TileDefinition } from "./types";
import { hubIdForTool } from "./registry";

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

  // A hub inherits the *strictest* harm tier among the calculators it hosts, and
  // the union of their channels (SPEC-4 §3.2). A hub is a container, but it is
  // also a real navigable tile, so it must satisfy the Pillar 4 bar rather than
  // slipping under it: hosting a tier-3 screener makes the hub rights-adjacent.
  const strictest = tools.reduce<TileDefinition | undefined>(
    (worst, t) =>
      t.harmTier !== undefined && (worst?.harmTier === undefined || t.harmTier > worst.harmTier)
        ? t
        : worst,
    undefined,
  );
  const harmTier = strictest?.harmTier;
  const channels = tools.flatMap((t) => t.channels ?? []);
  // The advice line comes from the tool that *set* the tier, not from whichever
  // calculator happens to be listed first. The hub is rights-adjacent because of
  // that one tool, so its "how" is the one that must carry the line — picking
  // any other tool's silently inherits a "how" with no advice line in it.
  const advice = strictest?.how ?? tools.find((t) => t.how)?.how;

  return {
    id,
    title,
    pillar,
    description,
    status: "ready",
    ...(harmTier !== undefined ? { harmTier } : {}),
    ...(channels.length > 0 ? { channels } : {}),
    // Each sub-tool renders its own "how" (including its advice line) under the
    // active calculator; the hub carries one so the audit can see it too.
    ...(harmTier !== undefined && harmTier >= 2 && advice ? { how: advice } : {}),
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
        // A sub-tool is not a route. Resolve the hub that owns the target —
        // this one or another — and hand the router the hub plus `?tool=`.
        // Two things were wrong here before a cross-hub handoff needed them.
        // The remap only recognized siblings of THIS hub, so navigating to a
        // calculator in another one fell through to a tile id the router
        // cannot resolve and dropped the reader on the home page. And the
        // remap threw the caller's params away, so a link carrying a value —
        // Auto Loan handing its first year of interest to the car loan
        // deduction — arrived empty even when it arrived.
        // This hub's own tools first, so a hub built outside the registry (a
        // test fixture) still remaps its siblings; then the registry, which is
        // what makes a cross-hub target resolvable at all.
        const targetHub = !tileId
          ? undefined
          : tools.some((t) => t.id === tileId)
            ? id
            : hubIdForTool(tileId);
        if (tileId && targetHub) {
          const merged = new URLSearchParams(params ?? undefined);
          merged.set(HUB_TOOL_KEY, tileId);
          ctx.navigate(targetHub, merged);
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
