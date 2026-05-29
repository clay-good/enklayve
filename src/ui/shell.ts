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
import { renderReadout } from "./readoutView";
import { renderReport } from "./reportView";
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
    text: "My Situation",
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
        "aria-label": "Open the Readout to drop a pay stub, W-2, or 1040",
      },
      on: { click: () => navigate("readout") },
    },
    el("span", { class: "readout-dropzone-icon", attrs: { "aria-hidden": "true" }, text: "⤓" }),
    el("span", {
      class: "readout-dropzone-title",
      text: "Drop a pay stub, W-2, or 1040",
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
      text: "A calm, kind personal-finance guide for the United States. See your real take-home, what you owe, and what you're owed — with the math shown and every source linked. It's all computed on your device, and nothing ever leaves.",
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

  // Compact grouped browsing: one expandable card per pillar (plus My Plan),
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

  container.append(hero, search, grid, homeExplainer());
}

/** Trusted U.S. resources to learn the public rules behind the numbers. */
const US_RESOURCES: { label: string; url: string }[] = [
  { label: "IRS — federal taxes", url: "https://www.irs.gov/" },
  { label: "Benefits.gov — federal benefits", url: "https://www.benefits.gov/" },
  { label: "HealthCare.gov — ACA marketplace", url: "https://www.healthcare.gov/" },
  {
    label: "Consumer Financial Protection Bureau",
    url: "https://www.consumerfinance.gov/consumer-tools/",
  },
  { label: "Social Security Administration", url: "https://www.ssa.gov/" },
  { label: "Federal Student Aid (FAFSA)", url: "https://studentaid.gov/" },
];

/**
 * The home "how this works / why you can trust it" section: warm, plain-English,
 * US-only, and pointing to the public sources behind every number.
 */
function homeExplainer(): HTMLElement {
  const point = (title: string, body: string): HTMLElement =>
    el(
      "div",
      { class: "explainer-point" },
      el("h3", { class: "explainer-point-title", text: title }),
      el("p", { class: "explainer-point-body", text: body }),
    );

  return el(
    "section",
    { class: "home-explainer", attrs: { "aria-label": "How enklayve works" } },
    el("h2", { class: "home-explainer-title", text: "How this works" }),
    el(
      "div",
      { class: "explainer-points" },
      point(
        "It's truly private",
        "Every number is computed on your device. The page literally cannot send your data anywhere — there's no server to send it to.",
      ),
      point(
        "It shows its work",
        "Every tool explains the logic and the math, and cites the public U.S. rule behind each figure, so you never have to just trust it.",
      ),
      point(
        "It's for the United States",
        "enklayve is built around U.S. federal and state taxes and benefits. We're keeping the scope U.S.-only for now so every figure stays accurate.",
      ),
      point(
        "It's free and on your side",
        "No accounts, no ads, no upsell. It's a calm guide that gives you the next right step — never shame.",
      ),
    ),
    el("h3", { class: "explainer-subhead", text: "Trusted U.S. resources" }),
    el(
      "ul",
      { class: "explainer-resources" },
      ...US_RESOURCES.map((r) =>
        el(
          "li",
          {},
          el(
            "a",
            { href: r.url, attrs: { rel: "noopener noreferrer", target: "_blank" } },
            r.label,
          ),
        ),
      ),
    ),
    el("p", {
      class: "explainer-promise",
      text: "This is information to help you understand your money, not financial, tax, or legal advice.",
    }),
  );
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

  // "How this works" + "Learn more" — explain the logic and the math, and point
  // to trusted U.S. sources, on every tool page (a warm, helpful default).
  const explainer = tileExplainer(tile);
  if (explainer) container.querySelector(".tile")?.append(explainer);
}

/**
 * The explainer shown under every tool: a plain-English "how this works" (the
 * logic and the math), trusted U.S. resource links, and the privacy + US-only
 * promise. Returns null only if a tile somehow has nothing to add.
 */
function tileExplainer(tile: TileDefinition): HTMLElement | null {
  const section = el("section", { class: "tile-explainer" });

  if (tile.how) {
    const how = el("details", { class: "explainer-how", attrs: { open: "" } });
    how.append(el("summary", { text: "How this works" }));
    for (const para of tile.how.split(/\n\n+/)) {
      how.append(el("p", { class: "explainer-para", text: para.trim() }));
    }
    section.append(how);
  }

  if (tile.resources && tile.resources.length > 0) {
    const list = el(
      "ul",
      { class: "explainer-resources" },
      ...tile.resources.map((r) =>
        el(
          "li",
          {},
          el(
            "a",
            {
              href: r.url,
              attrs: { rel: "noopener noreferrer", target: "_blank" },
            },
            r.label,
          ),
        ),
      ),
    );
    section.append(el("h3", { class: "explainer-subhead", text: "Learn more" }), list);
  }

  section.append(
    el("p", {
      class: "explainer-promise",
      text: "Computed entirely on your device for U.S. taxes and benefits — nothing is ever sent anywhere. Every figure shows its source; this is information, not financial or tax advice.",
    }),
  );

  return section;
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
      renderReadout({ container: content, navigate, profile });
      return;
    }
    if (route.tileId === "report") {
      renderReport({ container: content, navigate, profile, data });
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
export { renderHome, renderTileView, renderAllTools, renderReadout, renderReport };
