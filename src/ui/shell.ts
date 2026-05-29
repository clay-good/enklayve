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

/**
 * The site footer: two centered links, the author credit and the source. Shown
 * on every view. It's the only outbound chrome, in keeping with the calm,
 * non-transactional feel.
 */
function buildFooter(): HTMLElement {
  const link = (text: string, href: string, extra = ""): HTMLElement =>
    el(
      "a",
      {
        class: `footer-link ${extra}`.trim(),
        href,
        attrs: { rel: "noopener noreferrer", target: "_blank" },
      },
      text,
    );
  return el(
    "footer",
    { class: "app-footer" },
    el(
      "div",
      { class: "footer-links" },
      link("Made with ♥ by Clay Good", "https://claygood.com", "footer-link--accent"),
      link("GitHub", "https://github.com/clay-good/enklayve"),
    ),
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
      text: "Get an instant private readout, parsed on your device, never uploaded.",
    }),
  );
}

function renderHome(container: HTMLElement, navigate: (id: string | null) => void): void {
  clear(container);
  document.title = "enklayve";

  const hero = el(
    "section",
    { class: "hero" },
    el("h1", { class: "hero-title", text: "Know where you stand, and what to do next." }),
    el("p", {
      class: "hero-sub",
      text: "The honest money guidance the experts charge hundreds for: your real paycheck, what you owe, what you're owed, and your next right step. Here it's free, and it always will be. No login, no ads, no cookie banner, no upsell. It runs entirely on your device, shows its math, and links every source, so you can simply trust what you see.",
    }),
    el("p", {
      class: "hero-disclaimer",
      text: "Free forever. Private by design. Educational information, not financial, tax, or legal advice.",
    }),
    readoutDropzone(navigate),
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

  container.append(hero, grid, homeExplainer());
}

/** Trusted U.S. resources to learn the public rules behind the numbers. */
const US_RESOURCES: { label: string; url: string }[] = [
  { label: "IRS, federal taxes", url: "https://www.irs.gov/" },
  { label: "Benefits.gov, federal benefits", url: "https://www.benefits.gov/" },
  { label: "HealthCare.gov, ACA marketplace", url: "https://www.healthcare.gov/" },
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
    { class: "home-explainer", attrs: { "aria-label": "Why enklayve" } },
    el("h2", { class: "home-explainer-title", text: "Why enklayve" }),
    el("p", {
      class: "home-explainer-lede",
      text: "There are a thousand budgeting apps, tax calculators, and money coaches. Almost all of them want your email, your data, your attention, or your money. enklayve wants none of it. Here is what makes it different.",
    }),
    el(
      "div",
      { class: "explainer-points" },
      point(
        "Free, forever",
        "No accounts, no ads, no cookie banner, no upsell, no premium tier, ever. The finance celebrities sell this; we think knowing where you stand should be a public good, free for everyone.",
      ),
      point(
        "Truly private",
        "Every number is computed on your device. There is no server to send your data to, so it cannot leak, be sold, or train anything. Your money stays yours.",
      ),
      point(
        "Shows its work",
        "Every figure shows the exact math and links the public rule behind it. You never have to trust a personality. You can verify it yourself, down to the citation.",
      ),
      point(
        "Genuinely useful",
        "Your real take-home pay, federal and state taxes, the benefits and credits you may be owed, debt payoff, and your next right step, all in one calm place.",
      ),
      point(
        "No dark patterns",
        "No streaks, no guilt, no fear-of-missing-out, no notifications begging you back. It respects your time and never tries to manipulate you. Just answers.",
      ),
      point(
        "Built to last",
        "Open source, deterministic, and reproducible from public data. It works offline, installs like an app, and will still give the same honest answer years from now.",
      ),
    ),
    el("h3", { class: "explainer-subhead", text: "Where it works" }),
    el("p", {
      class: "home-explainer-lede",
      text: "enklayve covers U.S. federal and state taxes and benefits today. Support for more places, starting with Europe, India, China, and Russia, is on the roadmap as we learn each one's rules properly. We would rather be right than everywhere.",
    }),
    el("h3", { class: "explainer-subhead", text: "Trusted resources" }),
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
  );
}

/**
 * The All Tools index (BUILD-SPEC-2 §1.2): a stable, linkable home for every
 * tool, grouped by pillar. The client route mirrors the static `tools.html`
 * emitted at build time for search-engine crawlability.
 */
function renderAllTools(container: HTMLElement, navigate: (id: string | null) => void): void {
  clear(container);
  document.title = "All tools · enklayve";

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
  document.title = `${tile.title} · enklayve`;

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
      text: "Computed entirely on your device for U.S. taxes and benefits, nothing is ever sent anywhere, and it's free forever. This is educational information, not financial, tax, investment, or legal advice; it's an estimate from public data and your inputs, so verify anything important with the official source or a qualified professional.",
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

  root.replaceChildren(header, content, buildFooter());
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
      renderHome(content, navigate);
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
