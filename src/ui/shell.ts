/**
 * The application shell (BUILD-SPEC.md §10, §11, Phase 4). It assembles the
 * header (wordmark, inline search, theme switch), the command palette, the
 * fragment router, and the content area that home and tiles render into. The
 * shell knows tiles only through the registry and the {@link TileContext}
 * interface, so new tiles never require touching this file.
 */
import { Router, permalinkFor, type Route } from "./router";
import { CommandPalette } from "./commandPalette";
import { SituationPanel } from "./situationPanel";
import { applyStoredPreferences, setTheme, THEMES, getTheme, type Theme } from "./theme";
import { el, option, clear } from "./dom";
import { loadBundledData, type BundledData } from "../data/browser";
import { PILLARS, type TileContext, type TileDefinition } from "../tiles/types";
import { getTile, tilesForPillar } from "../tiles/registry";
import { SituationStore } from "../profile/situation";

const THEME_LABELS: Record<Theme, string> = {
  light: "Light",
  dark: "Dark",
  "high-contrast": "High contrast",
};

function themeControl(): HTMLElement {
  const select = el(
    "select",
    {
      class: "theme-select",
      attrs: { "aria-label": "Color theme" },
      on: {
        change: (e) => setTheme((e.target as HTMLSelectElement).value as Theme),
      },
    },
    ...THEMES.map((t) => option(t, THEME_LABELS[t], t === getTheme())),
  );
  return el(
    "label",
    { class: "theme-control" },
    el("span", { class: "visually-hidden", text: "Theme" }),
    select,
  );
}

function buildHeader(
  navigate: (id: string | null) => void,
  openPalette: () => void,
  openSituation: () => void,
): HTMLElement {
  const wordmark = el(
    "button",
    {
      type: "button",
      class: "wordmark-link",
      attrs: { "aria-label": "enklayve home" },
      on: { click: () => navigate(null) },
    },
    el("span", { class: "wordmark", text: "enklayve" }),
  );

  const search = el(
    "button",
    {
      type: "button",
      class: "btn btn--ghost search-trigger",
      on: { click: openPalette },
    },
    el("span", { text: "Search tools" }),
    el("kbd", { class: "kbd", text: "⌘K" }),
  );

  const situation = el("button", {
    type: "button",
    class: "btn btn--ghost situation-trigger",
    text: "Your Situation",
    on: { click: openSituation },
  });

  return el(
    "header",
    { class: "app-header" },
    wordmark,
    el("div", { class: "header-actions" }, search, situation, themeControl()),
  );
}

function tileLink(tile: TileDefinition, navigate: (id: string) => void): HTMLElement {
  return el(
    "li",
    {},
    el(
      "button",
      {
        type: "button",
        class: tile.status === "ready" ? "tile-link" : "tile-link tile-link--soon",
        on: { click: () => navigate(tile.id) },
      },
      el("span", { class: "tile-link-title", text: tile.title }),
      tile.status === "coming-soon"
        ? el("span", { class: "badge badge--soon", text: "soon" })
        : null,
    ),
  );
}

/**
 * The Readout dropzone — the hero of the home experience (BUILD-SPEC-2 §1.1,
 * §2). It is the single most personal moment in the product: drop a document
 * and get an instant private readout, parsed on the device. The parsing engine
 * lands in Phase 14; for now the dropzone is the inviting entry point that
 * navigates into the Readout view.
 */
function readoutDropzone(navigate: (id: string | null) => void): HTMLElement {
  return el(
    "button",
    {
      type: "button",
      class: "readout-dropzone",
      attrs: {
        "aria-label": "Open the Readout to drop a pay stub, W-2, 1040, or 1095-A",
      },
      on: { click: () => navigate("readout") },
    },
    el("span", { class: "readout-dropzone-icon", attrs: { "aria-hidden": "true" }, text: "⤓" }),
    el("span", {
      class: "readout-dropzone-title",
      text: "Drop a pay stub, W-2, 1040, or 1095-A",
    }),
    el("span", {
      class: "readout-dropzone-sub",
      text: "Get an instant private readout — parsed on your device, never uploaded.",
    }),
  );
}

function renderHome(
  container: HTMLElement,
  navigate: (id: string | null) => void,
  openPalette: () => void,
): void {
  clear(container);
  document.title = "enklayve";

  const hero = el(
    "section",
    { class: "hero" },
    el("h1", { class: "hero-title", text: "Know where you stand. Privately." }),
    el("p", {
      class: "hero-sub",
      text: "Your real take-home, what you owe, and what you're owed — computed entirely on your device. Nothing ever leaves.",
    }),
    readoutDropzone(navigate),
  );

  const search = el(
    "button",
    {
      type: "button",
      class: "home-search",
      attrs: { "aria-label": "Search any tool or question" },
      on: { click: openPalette },
    },
    el("span", { class: "home-search-text", text: "Search any tool or question…" }),
    el("kbd", { class: "kbd", text: "⌘K" }),
  );

  // Compact grouped browsing: one expandable card per pillar (plus Your Plan),
  // collapsed by default so the home stays short to scroll (BUILD-SPEC-2 §1.1,
  // §1.2). Native <details>/<summary> keeps it fully keyboard- and
  // screen-reader-operable without a mega dropdown.
  const grid = el("div", { class: "pillar-grid" });
  for (const pillar of PILLARS) {
    const tiles = tilesForPillar(pillar.id);
    const card = el(
      "details",
      { class: "pillar-card" },
      el(
        "summary",
        { class: "pillar-summary" },
        el(
          "span",
          { class: "pillar-summary-text" },
          el("span", { class: "pillar-title", text: pillar.title }),
          el("span", { class: "pillar-blurb", text: pillar.blurb }),
        ),
        el("span", {
          class: "pillar-count",
          text: `${tiles.length} ${tiles.length === 1 ? "tool" : "tools"}`,
        }),
      ),
      el("ul", { class: "tile-list" }, ...tiles.map((t) => tileLink(t, (id) => navigate(id)))),
    );
    grid.append(card);
  }

  // The All Tools index card: a stable, linkable, crawlable home for every tool.
  const indexCard = el(
    "button",
    {
      type: "button",
      class: "index-card",
      on: { click: () => navigate("all-tools") },
    },
    el("span", { class: "pillar-title", text: "All tools" }),
    el("span", { class: "pillar-blurb", text: "Browse the full index of every tool." }),
  );
  grid.append(indexCard);

  container.append(hero, search, grid);
}

/**
 * The All Tools index (BUILD-SPEC-2 §1.2): a stable, linkable home for every
 * tool, grouped by pillar. The client route mirrors the static `tools.html`
 * emitted at build time for search-engine crawlability.
 */
function renderAllTools(container: HTMLElement, navigate: (id: string | null) => void): void {
  clear(container);
  document.title = "All tools — enklayve";

  const back = el(
    "button",
    { type: "button", class: "btn btn--ghost back-link", on: { click: () => navigate(null) } },
    "← Home",
  );

  const head = el(
    "div",
    { class: "tile-head" },
    back,
    el("h1", { class: "tile-title", text: "All tools" }),
    el("p", {
      class: "tile-desc",
      text: "Every enklayve tool, grouped by pillar. Each runs entirely on your device.",
    }),
  );

  const sections = el("div", { class: "all-tools" });
  for (const pillar of PILLARS) {
    const tiles = tilesForPillar(pillar.id);
    if (tiles.length === 0) continue;
    sections.append(
      el(
        "section",
        { class: "all-tools-group" },
        el("h2", { class: "pillar-title", text: pillar.title }),
        el("ul", { class: "tile-list" }, ...tiles.map((t) => tileLink(t, (id) => navigate(id)))),
      ),
    );
  }

  container.append(el("article", { class: "tile" }, head, sections));
}

/**
 * The Readout view (BUILD-SPEC-2 §2). Deterministic on-device document parsing
 * lands in Phase 14; this is the destination of the hero dropzone until then,
 * explaining the privacy promise so the entry point is honest about its state.
 */
function renderReadout(container: HTMLElement, navigate: (id: string | null) => void): void {
  clear(container);
  document.title = "The Readout — enklayve";

  const back = el(
    "button",
    { type: "button", class: "btn btn--ghost back-link", on: { click: () => navigate(null) } },
    "← Home",
  );

  const head = el(
    "div",
    { class: "tile-head" },
    back,
    el("h1", { class: "tile-title", text: "The Readout" }),
    el("p", {
      class: "tile-desc",
      text: "Drop a pay stub, W-2, 1040, 1099, 1095-A, or mortgage statement and get an instant private readout.",
    }),
  );

  const body = el(
    "div",
    { class: "tile-body" },
    el("p", {
      class: "coming-soon-note",
      text: "On-device document parsing is being built phase by phase. When it lands, files are read locally with pdf.js and never uploaded — the Content-Security-Policy connect-src stays 'none', so the browser physically cannot send your documents anywhere.",
    }),
  );

  container.append(el("article", { class: "tile" }, head, body));
}

function renderTileView(
  container: HTMLElement,
  tile: TileDefinition,
  route: Route,
  router: Router,
  data: BundledData | null,
  locale: string,
  navigate: (id: string | null) => void,
  profile: SituationStore,
): void {
  clear(container);
  document.title = `${tile.title} — enklayve`;

  const back = el(
    "button",
    {
      type: "button",
      class: "btn btn--ghost back-link",
      on: { click: () => navigate(null) },
    },
    "← All tools",
  );

  const head = el(
    "div",
    { class: "tile-head" },
    back,
    el("h1", { class: "tile-title", text: tile.title }),
    el("p", { class: "tile-desc", text: tile.description }),
  );

  const body = el("div", { class: "tile-body" });
  container.append(el("article", { class: "tile" }, head, body));

  if (tile.status !== "ready" || !tile.mount) {
    body.append(
      el("p", {
        class: "coming-soon-note",
        text: "This tool is on the way. Its engine and data are being built phase by phase.",
      }),
    );
    return;
  }

  const ctx: TileContext = {
    root: body,
    params: route.params,
    setParams: (p) => router.replaceState(tile.id, p),
    permalink: (p) => permalinkFor(tile.id, p ?? route.params),
    navigate,
    locale,
    data,
    profile,
  };
  tile.mount(ctx);
}

export interface ShellHandle {
  navigate(id: string | null): void;
  destroy(): void;
}

/**
 * Build and mount the full shell into `root`. Data is loaded (and integrity-
 * gated) before routing begins so tiles always see a settled dataset. Returns a
 * handle for tests and teardown.
 */
export async function mountApp(root: HTMLElement): Promise<ShellHandle> {
  const { locale } = applyStoredPreferences();

  const router = new Router();
  const navigate = (id: string | null): void => router.navigate(id);

  // The single in-memory session profile every tile shares (SPEC-2 §3).
  const profile = new SituationStore();

  const palette = new CommandPalette((tile) => navigate(tile.id));
  const openPalette = (): void => palette.show();

  let data: BundledData | null = null;
  try {
    data = await loadBundledData();
  } catch {
    data = null;
  }

  const situationPanel = new SituationPanel(profile, data);
  const openSituation = (): void => situationPanel.show();

  const content = el("main", { id: "content", class: "content", attrs: { tabindex: "-1" } });
  const header = buildHeader(navigate, openPalette, openSituation);

  root.replaceChildren(header, content);
  document.body.append(palette.element, situationPanel.element);

  // Cmd/Ctrl-K toggles the palette from anywhere.
  const onKeyDown = (e: KeyboardEvent): void => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      palette.toggle();
    }
  };
  window.addEventListener("keydown", onKeyDown);

  // Privacy: the profile lives only in memory and is cleared on unload
  // (SPEC §2 principle 8, SPEC-2 §3.2). Nothing is ever persisted automatically.
  const onPageHide = (): void => profile.clear();
  window.addEventListener("pagehide", onPageHide);

  router.start((route) => {
    if (!route.tileId) {
      renderHome(content, navigate, openPalette);
      return;
    }
    if (route.tileId === "all-tools") {
      renderAllTools(content, navigate);
      return;
    }
    if (route.tileId === "readout") {
      renderReadout(content, navigate);
      return;
    }
    const tile = getTile(route.tileId);
    if (!tile) {
      navigate(null);
      return;
    }
    renderTileView(content, tile, route, router, data, locale, navigate, profile);
  });

  return {
    navigate,
    destroy: () => {
      router.stop();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pagehide", onPageHide);
      palette.element.remove();
      situationPanel.element.remove();
    },
  };
}

// Exposed for unit tests.
export { renderHome, renderTileView, renderAllTools, renderReadout };
