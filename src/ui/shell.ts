/**
 * The application shell (BUILD-SPEC.md §10, §11, Phase 4). It assembles the
 * header (wordmark, inline search, theme switch), the command palette, the
 * fragment router, and the content area that home and tiles render into. The
 * shell knows tiles only through the registry and the {@link TileContext}
 * interface, so new tiles never require touching this file.
 */
import { Router, permalinkFor, type Route } from "./router";
import { donutChart, paletteVar, type Slice } from "./charts";
import { CommandPalette } from "./commandPalette";
import { SituationPanel } from "./situationPanel";
import { renderReadout } from "./readoutView";
import { renderReport } from "./reportView";
import { applyStoredPreferences } from "./theme";
import { fuzzyFilter } from "./fuzzy";
import { el, clear, option } from "./dom";
import { tileHowResources } from "./explainer";
import { evaluateTaxes, type TaxInput } from "../engine/tax";
import type { FilingStatus } from "../data/schemas";
import { loadBundledData, type BundledData } from "../data/browser";
import { PILLARS, type TileContext, type TileDefinition } from "../tiles/types";
import {
  getTile,
  tilesForPillar,
  SEARCH_ENTRIES,
  searchEntryText,
  type SearchEntry,
} from "../tiles/registry";
import { SituationStore } from "../profile/situation";

/** Navigate to a tile/home, optionally deep-linking into a hub sub-tool. */
type NavigateFn = (id: string | null, params?: URLSearchParams) => void;

const SVG_NS = "http://www.w3.org/2000/svg";

/** Build an SVG node with attributes (no innerHTML — XSS-safe by construction). */
function svgEl(tag: string, attrs: Record<string, string>, ...children: SVGElement[]): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const child of children) node.append(child);
  return node;
}

function iconSvg(...children: SVGElement[]): SVGElement {
  return svgEl(
    "svg",
    {
      viewBox: "0 0 24 24",
      width: "24",
      height: "24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
      focusable: "false",
    },
    ...children,
  );
}

/**
 * The header: just the wordmark and its lowercase tagline. No theme toggle, no
 * search button — enklayve ships a single calm light theme, and search lives in
 * the home and ⌘K (BUILD-SPEC-2 §0.7, simplified further 2026-06-01).
 */
function buildHeader(navigate: (id: string | null) => void): HTMLElement {
  const wordmark = el(
    "button",
    {
      type: "button",
      class: "wordmark-link",
      attrs: { "aria-label": "enklayve home" },
      on: { click: () => navigate(null) },
    },
    el("span", { class: "wordmark", text: "enklayve" }),
    el("span", { class: "wordmark-tagline", text: "personal finance" }),
  );

  return el("header", { class: "app-header" }, wordmark);
}

/**
 * The site footer: a one-line trust note, then a row of uniform buttons — My
 * Situation and the trust links (Why enklayve, the source, the author credit),
 * kept out of the minimal header. Every item is the same shape and size so the
 * row reads as one tidy group and wraps cleanly on a phone. Shown on every view.
 */
function buildFooter(
  navigate: (id: string | null) => void,
  openSituation: () => void,
): HTMLElement {
  const linkBtn = (text: string, href: string, extra = ""): HTMLElement =>
    el(
      "a",
      {
        class: `footer-btn ${extra}`.trim(),
        href,
        attrs: { rel: "noopener noreferrer", target: "_blank" },
      },
      text,
    );

  const situationBtn = el("button", {
    type: "button",
    class: "footer-btn",
    text: "My situation",
    on: { click: openSituation },
  });

  const whyBtn = el("button", {
    type: "button",
    class: "footer-btn",
    text: "Why enklayve",
    on: { click: () => navigate("about") },
  });

  return el(
    "footer",
    { class: "app-footer" },
    el("p", {
      class: "footer-trust",
      text: "Free forever · Private by design · Educational information, not advice.",
    }),
    el(
      "div",
      { class: "footer-links" },
      situationBtn,
      whyBtn,
      linkBtn("GitHub", "https://github.com/clay-good/enklayve"),
      linkBtn("Made with ♥ by Clay Good", "https://claygood.com", "footer-btn--accent"),
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
      text: "Drop a pay stub, W-2, or tax form",
    }),
    el("span", {
      class: "readout-dropzone-sub",
      text: "We read it right here on your device and fill in your numbers for you. It is never uploaded.",
    }),
  );
}

/** Pay frequencies the budget income can be entered at, with periods/year so we
 *  can annualize wages for the tax engine and divide the tax back down again. */
const BUDGET_FREQUENCIES: { value: string; label: string; periods: number }[] = [
  { value: "weekly", label: "Weekly", periods: 52 },
  { value: "biweekly", label: "Bi-Weekly", periods: 26 },
  { value: "monthly", label: "Monthly", periods: 12 },
  { value: "annually", label: "Annually", periods: 1 },
];

const BUDGET_FILING_STATUSES: { value: FilingStatus; label: string }[] = [
  { value: "single", label: "Single" },
  { value: "married_jointly", label: "Married filing jointly" },
  { value: "married_separately", label: "Married filing separately" },
  { value: "head_of_household", label: "Head of household" },
  { value: "qualifying_surviving_spouse", label: "Qualifying surviving spouse" },
];

/** Living-expense buckets (everything that isn't tax or investing). */
const BUDGET_SPEND_ROWS: { key: string; label: string }[] = [
  { key: "housing", label: "Housing" },
  { key: "transport", label: "Transport" },
  { key: "food", label: "Food" },
  { key: "debt", label: "Debt" },
  { key: "other", label: "All other expenses" },
];

/** The two investing lines that count toward your investment rate. */
const BUDGET_INVEST_ROWS: { key: string; label: string }[] = [
  { key: "retirement", label: "Retirement investments" },
  { key: "brokerage", label: "Brokerage" },
];

/**
 * The home budget — now enklayve's one and only budget (consolidated 2026-06-02,
 * replacing the standalone Budget Overview tile). A live, hands-on calculator
 * that takes anyone from "where do I stand?" to a clear answer in about a minute:
 * enter your income at any pay frequency, pick your filing status and state, and
 * the same deterministic tax engine the Take-Home tile uses fills in your taxes
 * automatically. Split the rest across the big living-expense buckets and two
 * investing lines, and watch a donut fill while "left to assign" falls toward
 * zero. It reports your total expenses, total investments, honest net income, and
 * your investment rate against both gross and net. US dollars, US defaults.
 */
function homeBudgetWidget(data: BundledData | null): HTMLElement {
  const fmt0 = (n: number): string =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(Math.round(n));
  const pct0 = (r: number): string => `${Math.round(r * 100)}%`;
  // The fields only accept whole dollars — floor every keystroke to an integer.
  const toInt = (v: string): number => Math.max(0, Math.floor(Number(v) || 0));

  // Federal + FICA tables drive the auto-computed tax line; absent them (the data
  // failed to load) the budget still works with taxes held at zero.
  const fed = data?.federal() ?? null;
  const fica = data?.fica() ?? null;
  const stateCodes = data?.stateCodes() ?? [];

  let income = 5000;
  let freq = "monthly";
  let fs: FilingStatus = "single";
  let stateCode = "";
  const spend: Record<string, number> = {
    housing: 1500,
    transport: 400,
    food: 600,
    debt: 300,
    other: 500,
  };
  const invest: Record<string, number> = { retirement: 500, brokerage: 200 };

  // Fixed colors so each donut slice matches its row dot. Taxes read as a muted,
  // "unavoidable" slate rather than a bright discretionary color.
  const color: Record<string, string> = {
    taxes: "var(--enk-text-muted)",
    housing: paletteVar(0),
    transport: paletteVar(1),
    food: paletteVar(2),
    debt: paletteVar(3),
    other: paletteVar(4),
    retirement: paletteVar(5),
    brokerage: paletteVar(6),
  };

  const periodsFor = (f: string): number =>
    BUDGET_FREQUENCIES.find((x) => x.value === f)?.periods ?? 12;

  /** Annual total tax (federal income + FICA + state) via the shared engine. */
  const annualTax = (): number => {
    if (!fed || !fica) return 0;
    const annualWages = income * periodsFor(freq);
    const stateJ = stateCode && data ? (data.state(stateCode) ?? undefined) : undefined;
    const input: TaxInput = { filingStatus: fs, wages: annualWages };
    return evaluateTaxes(input, { federal: fed, fica, state: stateJ }).totals.totalTax.toNumber();
  };

  const viz = el("div", { class: "home-budget__viz", attrs: { "aria-live": "polite" } });
  const taxesValue = el("span", { class: "home-budget__derived-value" });

  const render = (): void => {
    const periods = periodsFor(freq);
    const taxes = annualTax() / periods; // the engine works annually; bring it back
    const totalExpenses = BUDGET_SPEND_ROWS.reduce((s, r) => s + Math.max(0, spend[r.key] ?? 0), 0);
    const totalInvest = BUDGET_INVEST_ROWS.reduce((s, r) => s + Math.max(0, invest[r.key] ?? 0), 0);
    // Honest net: what's left after taxes and living costs — the pool you invest from.
    const net = income - taxes - totalExpenses;
    const left = net - totalInvest;
    const balanced = Math.round(left) === 0 && income > 0;
    const over = left < 0;

    taxesValue.textContent = fmt0(taxes);

    const slices: Slice[] = [];
    const push = (label: string, value: number, c: string): void => {
      if (value > 0) slices.push({ label, value, color: c });
    };
    push("Taxes", taxes, color.taxes!);
    for (const r of BUDGET_SPEND_ROWS) push(r.label, Math.max(0, spend[r.key] ?? 0), color[r.key]!);
    for (const r of BUDGET_INVEST_ROWS)
      push(r.label, Math.max(0, invest[r.key] ?? 0), color[r.key]!);
    if (left > 0) slices.push({ label: "Left to assign", value: left, color: "var(--enk-accent)" });

    const status = el(
      "p",
      {
        class: `home-budget__status${balanced ? " is-balanced" : ""}${over ? " is-over" : ""}`,
      },
      el("span", {
        class: "home-budget__status-label",
        text: over ? "Over by" : "Left to assign",
      }),
      el("span", { class: "home-budget__status-value", text: fmt0(Math.abs(left)) }),
      el("span", {
        class: "home-budget__status-note",
        text: balanced ? "Every dollar has a job 🎉" : over ? "Trim a little" : "Give it a job",
      }),
    );

    const grossRate = income > 0 ? totalInvest / income : 0;
    const netRate = net > 0 ? totalInvest / net : 0;
    const stat = (label: string, value: string, strong = false): HTMLElement =>
      el(
        "div",
        { class: `home-budget__stat${strong ? " home-budget__stat--strong" : ""}` },
        el("span", { class: "home-budget__stat-label", text: label }),
        el("span", { class: "home-budget__stat-value", text: value }),
      );
    const stats = el(
      "div",
      { class: "home-budget__stats" },
      stat("Total expenses", fmt0(totalExpenses)),
      stat("Total investments", fmt0(totalInvest)),
      stat("Net income (after tax & expenses)", fmt0(net)),
      stat("Investment rate, of gross income", pct0(grossRate), true),
      stat("Investment rate, of net income", net > 0 ? pct0(netRate) : "—", true),
    );

    clear(viz);
    viz.append(
      donutChart({
        slices,
        locale: "en-US",
        ariaLabel: "How your income is split across taxes, expenses, investments, and what is left",
        centerValue: fmt0(income),
        centerLabel: "income",
      }),
      status,
      stats,
    );
  };

  const numRow = (
    label: string,
    value: number,
    dotColor: string | null,
    step: number,
    onInput: (n: number) => void,
  ): HTMLElement => {
    const input = el("input", {
      type: "number",
      min: 0,
      step,
      value,
      attrs: { inputmode: "numeric", "aria-label": label },
      on: {
        input: (e) => {
          onInput(toInt((e.target as HTMLInputElement).value));
          render();
        },
      },
    });
    const dot = el("span", { class: "home-budget__dot", attrs: { "aria-hidden": "true" } });
    if (dotColor) dot.style.background = dotColor;
    return el(
      "label",
      { class: "home-budget__row" },
      dotColor ? dot : null,
      el("span", { class: "home-budget__row-name", text: label }),
      input,
    );
  };

  const selectRow = (
    label: string,
    opts: { value: string; label: string }[],
    current: string,
    onChange: (v: string) => void,
  ): HTMLElement => {
    const sel = el(
      "select",
      { class: "home-budget__select", attrs: { "aria-label": label } },
      ...opts.map((o) => option(o.value, o.label, o.value === current)),
    );
    sel.value = current;
    sel.addEventListener("change", () => {
      onChange(sel.value);
      render();
    });
    return el(
      "label",
      { class: "home-budget__row home-budget__row--select" },
      el("span", { class: "home-budget__row-name", text: label }),
      sel,
    );
  };

  const stateOptions = [
    { value: "", label: "No state income tax" },
    ...stateCodes.map((code) => ({
      value: code,
      label: data?.state(code)?.name ?? code.toUpperCase(),
    })),
  ];

  const taxesDot = el("span", { class: "home-budget__dot", attrs: { "aria-hidden": "true" } });
  taxesDot.style.background = color.taxes!;
  const taxesRow = el(
    "div",
    { class: "home-budget__row home-budget__derived" },
    taxesDot,
    el("span", { class: "home-budget__row-name", text: "Taxes (estimated for you)" }),
    taxesValue,
  );

  const groupLabel = (text: string): HTMLElement => el("p", { class: "home-budget__group", text });

  const controls = el(
    "div",
    { class: "home-budget__controls" },
    groupLabel("Your income"),
    numRow("Income", income, null, 100, (n) => {
      income = n;
    }),
    selectRow("How often you're paid", BUDGET_FREQUENCIES, freq, (v) => {
      freq = v;
    }),
    selectRow("Filing status", BUDGET_FILING_STATUSES, fs, (v) => {
      fs = v as FilingStatus;
    }),
    selectRow("State", stateOptions, stateCode, (v) => {
      stateCode = v;
    }),
    taxesRow,
    groupLabel("Living expenses"),
    ...BUDGET_SPEND_ROWS.map((r) =>
      numRow(r.label, spend[r.key]!, color[r.key]!, 50, (n) => {
        spend[r.key] = n;
      }),
    ),
    groupLabel("Investing"),
    ...BUDGET_INVEST_ROWS.map((r) =>
      numRow(r.label, invest[r.key]!, color[r.key]!, 50, (n) => {
        invest[r.key] = n;
      }),
    ),
  );

  const section = el(
    "section",
    { class: "home-budget" },
    el("h2", { class: "home-budget__title", text: "Your whole money picture in 60 seconds" }),
    el("p", {
      class: "home-budget__sub",
      text: "Enter your income and where it goes. We estimate your taxes with the same engine as the Take-Home tool, then show what you invest and what's left. Give every dollar a job until what's left to assign reaches zero.",
    }),
    el("div", { class: "home-budget__grid" }, controls, viz),
  );

  render();
  return section;
}

/**
 * The anti-budget note that closes the home budget (moved here from the retired
 * standalone Budget Overview tile, 2026-06-02). Why assigning every dollar up
 * front beats a month of willpower — the "why" that follows the calculator.
 */
function budgetWhy(): HTMLElement {
  const para = (text: string): HTMLElement => el("p", { class: "budget-why__p", text });
  return el(
    "section",
    { class: "budget-why home-budget-why" },
    el("h2", { class: "budget-why__title", text: "Zero Dollar Based Budget or Anti-Budget" }),
    para(
      "This is the anti-budget. Most budgets fail because they run on willpower: you try to spend a little less in the moment, hundreds of moments a month, and willpower always runs out. Giving every dollar a job flips that. You make the decisions once, before the month starts, so by the time you are standing in the store the choice is already made and there is nothing left to resist.",
    ),
    para(
      "That is a change at the structural layer, not a motivational one. When the money is assigned up front (rent here, groceries here, savings moved the day you are paid), the default quietly does the work. You are not fighting yourself; you have changed the shape of the choice. Habits that live in the structure stay. Habits that lean on willpower fade by the third week.",
    ),
    para(
      "So give every dollar a job, saving and debt payoff included, until what is left to assign reaches exactly zero. A dollar without a job drifts away. A dollar with one tends to stay.",
    ),
  );
}

/** A small search-glass icon (paired with the home search input). */
function searchIcon(): SVGElement {
  return iconSvg(
    svgEl("circle", { cx: "11", cy: "11", r: "7" }),
    svgEl("line", { x1: "21", y1: "21", x2: "16.65", y2: "16.65" }),
  );
}

/**
 * The home live search (BUILD-SPEC-2 §1.1 zone 2): a single centered box that
 * shows matching tools in a dropdown as you type. It's a proper combobox so it's
 * keyboard- and screen-reader-friendly (arrows move, Enter opens, Escape
 * clears). The ⌘K command palette still works everywhere; this is the visible,
 * obvious search the home leads with.
 */
function homeSearch(navigate: NavigateFn): HTMLElement {
  const MAX = 8;
  let results: SearchEntry[] = [];
  let active = -1;

  const list = el("ul", {
    id: "home-search-results",
    class: "home-search-results",
    hidden: true,
    attrs: { role: "listbox", "aria-label": "Search results" },
  });

  const input = el("input", {
    type: "text",
    class: "home-search-input",
    placeholder: "Search for a tool, like “take-home pay” or “debt”…",
    attrs: {
      role: "combobox",
      "aria-expanded": "false",
      "aria-controls": "home-search-results",
      "aria-autocomplete": "list",
      "aria-label": "Search for a tool",
      autocomplete: "off",
    },
  });

  const choose = (i: number): void => {
    const entry = results[i];
    if (entry)
      navigate(entry.hubId, entry.tool ? new URLSearchParams({ tool: entry.tool }) : undefined);
  };

  const render = (): void => {
    clear(list);
    if (results.length === 0) {
      list.hidden = true;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      return;
    }
    results.forEach((entry, i) => {
      const isActive = i === active;
      list.append(
        el(
          "li",
          {
            id: `home-opt-${i}`,
            class: isActive ? "home-search-opt home-search-opt--active" : "home-search-opt",
            attrs: { role: "option", "aria-selected": isActive ? "true" : "false" },
            on: {
              click: () => choose(i),
              mousemove: () => {
                if (active !== i) {
                  active = i;
                  render();
                }
              },
            },
          },
          el("span", { class: "home-search-opt-title", text: entry.title }),
          el("span", { class: "home-search-opt-desc", text: entry.description }),
        ),
      );
    });
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    if (active >= 0) input.setAttribute("aria-activedescendant", `home-opt-${active}`);
    else input.removeAttribute("aria-activedescendant");
  };

  const refresh = (): void => {
    const q = input.value.trim();
    results = q
      ? fuzzyFilter(q, SEARCH_ENTRIES, searchEntryText)
          .slice(0, MAX)
          .map((r) => r.item)
      : [];
    active = results.length > 0 ? 0 : -1;
    render();
  };

  input.addEventListener("input", refresh);
  input.addEventListener("keydown", (e) => {
    const ev = e as KeyboardEvent;
    if (results.length === 0) {
      if (ev.key === "Escape") {
        input.value = "";
        refresh();
      }
      return;
    }
    switch (ev.key) {
      case "ArrowDown":
        ev.preventDefault();
        active = (active + 1) % results.length;
        render();
        break;
      case "ArrowUp":
        ev.preventDefault();
        active = (active - 1 + results.length) % results.length;
        render();
        break;
      case "Enter":
        ev.preventDefault();
        choose(active);
        break;
      case "Escape":
        ev.preventDefault();
        input.value = "";
        refresh();
        break;
    }
  });

  const box = el("div", { class: "home-search-box" });
  box.append(
    el("span", { class: "home-search-icon", attrs: { "aria-hidden": "true" } }, searchIcon()),
    input,
  );
  return el("div", { class: "home-search" }, box, list);
}

/**
 * The home (redesigned 2026-06-01, BUILD-SPEC-2 §0.7): three calm, centered
 * zones — the Readout dropzone, a live search box, and then every tool listed
 * under plain-language headings. No teaching journey, no wall of value props:
 * just the helper, spelled out simply. The trust story stays on `#/about`, and
 * the full plan is one tap away under "See your plan".
 */
function renderHome(
  container: HTMLElement,
  navigate: (id: string | null) => void,
  data: BundledData | null = null,
): void {
  clear(container);
  document.title = "enklayve: free, private money tools that show their math";

  const hero = el(
    "section",
    { class: "hero" },
    el("h1", { class: "hero-title", text: "Your money, made simple." }),
    el("p", {
      class: "hero-sub",
      text: "Your real take-home pay, the taxes you owe, the benefits you might be missing, and your next smart move. Free forever, truly private, and every number shows its math, computed right here on your device, never uploaded.",
    }),
  );

  // The front door: the plan is enklayve's strongest, simplest thing, so it
  // leads. One bold action hands a newcomer their ordered money plan; the
  // dropzone, the mini-budget, and search follow as other ways in.
  const planCta = el(
    "div",
    { class: "hero-cta" },
    el("button", {
      type: "button",
      class: "btn btn--accent hero-cta-btn",
      text: "Show me my next step →",
      on: { click: () => navigate("your-plan") },
    }),
    el("p", {
      class: "hero-cta-note",
      text: "A calm, ordered plan with your single next right move on top. Free, private, and fully yours to adjust.",
    }),
  );

  const startHint = el(
    "p",
    { class: "home-start-hint" },
    el("span", { text: "Not sure where to begin? " }),
    el("button", {
      type: "button",
      class: "home-start-link",
      text: "See your plan →",
      on: { click: () => navigate("your-plan") },
    }),
  );

  // Every tool, listed under its plain-language money area (BUILD-SPEC-2 §1.5).
  const toolsHead = el(
    "div",
    { class: "home-tools-head" },
    el("h2", { class: "home-tools-title", text: "All tools" }),
    el("p", {
      class: "home-tools-sub",
      text: "Pick any tool below. A number you enter in one is shared with the rest, so you only type it once.",
    }),
  );

  const groups = el("div", { class: "home-tools" });
  for (const pillar of PILLARS) {
    const tiles = tilesForPillar(pillar.id);
    if (tiles.length === 0) continue;
    groups.append(
      el(
        "section",
        { class: "home-tools-group" },
        el("h3", { class: "home-group-title", text: pillar.title }),
        el("p", { class: "home-group-blurb", text: pillar.blurb }),
        el("ul", { class: "tile-list" }, ...tiles.map((t) => tileLink(t, (id) => navigate(id)))),
      ),
    );
  }

  container.append(
    hero,
    planCta,
    readoutDropzone(navigate),
    homeBudgetWidget(data),
    budgetWhy(),
    homeSearch(navigate),
    startHint,
    toolsHead,
    groups,
  );
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
    { class: "home-explainer" },
    el("p", {
      class: "home-explainer-lede",
      text: "There are a thousand budgeting apps, tax calculators, and money coaches. Almost all of them want your email, your data, your attention, or your money. enklayve wants none of it. Here is what makes it different.",
    }),
    el("h2", { class: "explainer-subhead", text: "What makes it different" }),
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
    el("h2", { class: "explainer-subhead", text: "Where it works" }),
    el("p", {
      class: "home-explainer-lede",
      text: "enklayve covers U.S. federal and state taxes and benefits today. Support for more places, starting with Europe, India, China, and Russia, is on the roadmap as we learn each one's rules properly. We would rather be right than everywhere.",
    }),
    el("h2", { class: "explainer-subhead", text: "Trusted resources" }),
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
 * The "Why enklayve" page (route `#/about`): the trust story — free forever,
 * truly private, shows its work — used to crowd the home. It now lives on its
 * own calm page, reachable from the footer, so the home can lead with the
 * journey instead of a wall of value propositions.
 */
function renderAbout(container: HTMLElement, navigate: (id: string | null) => void): void {
  clear(container);
  document.title = "Why enklayve · enklayve";

  const back = el(
    "button",
    { type: "button", class: "btn btn--ghost back-link", on: { click: () => navigate(null) } },
    "← Home",
  );

  const head = el(
    "div",
    { class: "tile-head" },
    back,
    el("h1", { class: "tile-title", text: "Why enklayve" }),
  );
  container.append(el("article", { class: "tile" }, head, homeExplainer()));
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
      text: "Every enklayve tool, grouped by topic. Each runs entirely on your device.",
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
  navigate: NavigateFn,
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

  // Hubs carry no `how`/`resources` of their own (their active sub-tool renders
  // those); for an ordinary tile this adds its "How this works" + "Learn more".
  const howres = tileHowResources(tile);
  if (howres) section.append(howres);

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
  const navigate: NavigateFn = (id, params) => router.navigate(id, params);

  // The single in-memory session profile every tile shares (SPEC-2 §3).
  const profile = new SituationStore();

  const palette = new CommandPalette((entry) =>
    navigate(entry.hubId, entry.tool ? new URLSearchParams({ tool: entry.tool }) : undefined),
  );

  let data: BundledData | null = null;
  try {
    data = await loadBundledData();
  } catch {
    data = null;
  }

  const situationPanel = new SituationPanel(profile, data);
  const openSituation = (): void => situationPanel.show();

  const content = el("main", { id: "content", class: "content", attrs: { tabindex: "-1" } });
  const header = buildHeader(navigate);
  const footer = buildFooter(navigate, openSituation);

  root.replaceChildren(header, content, footer);
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

  const renderRoute = (route: Route): void => {
    if (!route.tileId) {
      renderHome(content, navigate, data);
      return;
    }
    if (route.tileId === "all-tools") {
      renderAllTools(content, navigate);
      return;
    }
    if (route.tileId === "about") {
      renderAbout(content, navigate);
      return;
    }
    if (route.tileId === "readout") {
      renderReadout({ container: content, navigate, profile, data });
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
  };

  // After any real navigation (a hashchange — input edits use replaceState and
  // never reach the handler), return the reader to the top of the freshly
  // rendered view and move focus into it. Without this, clicking a link near
  // the bottom of a long page left you stranded at that same scroll offset on
  // the new page instead of at its start.
  //
  // The jump is forced *instant* (overriding the global `scroll-behavior:
  // smooth`, which would otherwise animate a long, distracting scroll up) and
  // repeated on the next frame: on mobile the page height isn't settled the
  // instant we replace the content, so a single synchronous scroll can land
  // short and leave you near the bottom. The rAF pass corrects that once layout
  // has settled.
  const jumpToTop = (): void => {
    if (typeof window.scrollTo !== "function") return;
    try {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
    } catch {
      window.scrollTo(0, 0);
    }
  };
  let firstRoute = true;
  router.start((route) => {
    renderRoute(route);
    jumpToTop();
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(jumpToTop);
    // Keyboard and screen-reader users land in the new content, not back in the
    // page chrome. Skip the first paint so we don't steal initial focus, and
    // preventScroll so focusing can't fight the jump-to-top above.
    if (!firstRoute && typeof content.focus === "function") {
      content.focus({ preventScroll: true });
    }
    firstRoute = false;
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
export { renderHome, renderAbout, renderTileView, renderAllTools, renderReadout, renderReport };
