/**
 * The application shell (BUILD-SPEC.md §10, §11, Phase 4). It assembles the
 * header (wordmark, inline search, theme switch), the command palette, the
 * fragment router, and the content area that home and tiles render into. The
 * shell knows tiles only through the registry and the {@link TileContext}
 * interface, so new tiles never require touching this file.
 */
import { Router, permalinkFor, type Route } from "./router";
import { CommandPalette } from "./commandPalette";
import { applyStoredPreferences, setTheme, THEMES, getTheme, type Theme } from "./theme";
import { el, option, clear } from "./dom";
import { loadBundledData, type BundledData } from "../data/browser";
import { PILLARS, type TileContext, type TileDefinition } from "../tiles/types";
import { getTile, tilesForPillar } from "../tiles/registry";

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

function buildHeader(navigate: (id: string | null) => void, openPalette: () => void): HTMLElement {
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

  return el(
    "header",
    { class: "app-header" },
    wordmark,
    el("div", { class: "header-actions" }, search, themeControl()),
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

function renderHome(
  container: HTMLElement,
  navigate: (id: string | null) => void,
  openPalette: () => void,
): void {
  clear(container);
  document.title = "enklayve — know where you stand, privately";

  const hero = el(
    "section",
    { class: "hero" },
    el("h1", { class: "hero-title", text: "Know where you stand. Privately." }),
    el("p", {
      class: "hero-sub",
      text: "Your real take-home, what you owe, and what you're owed — computed entirely on your device. Nothing ever leaves.",
    }),
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

  const grid = el("div", { class: "pillar-grid" });
  for (const pillar of PILLARS) {
    const tiles = tilesForPillar(pillar.id);
    grid.append(
      el(
        "section",
        { class: "pillar-card" },
        el("h2", { class: "pillar-title", text: pillar.title }),
        el("p", { class: "pillar-blurb", text: pillar.blurb }),
        el("ul", { class: "tile-list" }, ...tiles.map((t) => tileLink(t, (id) => navigate(id)))),
      ),
    );
  }

  container.append(hero, search, grid);
}

function renderTileView(
  container: HTMLElement,
  tile: TileDefinition,
  route: Route,
  router: Router,
  data: BundledData | null,
  locale: string,
  navigate: (id: string | null) => void,
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
    locale,
    data,
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

  const palette = new CommandPalette((tile) => navigate(tile.id));
  const openPalette = (): void => palette.show();

  const content = el("main", { id: "content", class: "content", attrs: { tabindex: "-1" } });
  const header = buildHeader(navigate, openPalette);

  root.replaceChildren(header, content);
  document.body.append(palette.element);

  // Cmd/Ctrl-K toggles the palette from anywhere.
  const onKeyDown = (e: KeyboardEvent): void => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      palette.toggle();
    }
  };
  window.addEventListener("keydown", onKeyDown);

  let data: BundledData | null = null;
  try {
    data = await loadBundledData();
  } catch {
    data = null;
  }

  router.start((route) => {
    if (!route.tileId) {
      renderHome(content, navigate, openPalette);
      return;
    }
    const tile = getTile(route.tileId);
    if (!tile) {
      navigate(null);
      return;
    }
    renderTileView(content, tile, route, router, data, locale, navigate);
  });

  return {
    navigate,
    destroy: () => {
      router.stop();
      window.removeEventListener("keydown", onKeyDown);
      palette.element.remove();
    },
  };
}

// Exposed for unit tests.
export { renderHome, renderTileView };
