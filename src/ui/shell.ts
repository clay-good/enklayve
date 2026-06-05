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
import { renderReadout } from "./readoutView";
import { renderReport } from "./reportView";
import { applyStoredPreferences } from "./theme";
import { el, clear, option } from "./dom";
import { tileHowResources } from "./explainer";
import { evaluateTaxes, type TaxInput } from "../engine/tax";
import type { FilingStatus } from "../data/schemas";
import { loadBundledData, type BundledData } from "../data/browser";
import { type TileContext, type TileDefinition } from "../tiles/types";
import { getTile, TILES, SUB_TOOLS } from "../tiles/registry";
import { SituationStore } from "../profile/situation";

/** Navigate to a tile/home, optionally deep-linking into a hub sub-tool. */
type NavigateFn = (id: string | null, params?: URLSearchParams) => void;

/**
 * The header: just the wordmark and its lowercase tagline. No theme toggle, no
 * search button — enklayve ships a single calm light theme, and tools are
 * reached from the All Tools index and ⌘K (BUILD-SPEC-2 §0.7).
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
function buildFooter(navigate: (id: string | null) => void): HTMLElement {
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

  const whyBtn = el("button", {
    type: "button",
    class: "footer-btn",
    text: "Why enklayve",
    on: { click: () => navigate("about") },
  });

  // The browse-everything path now that the home leads with search, not a grid.
  const allToolsBtn = el("button", {
    type: "button",
    class: "footer-btn",
    text: "All tools",
    on: { click: () => navigate("all-tools") },
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
      allToolsBtn,
      whyBtn,
      linkBtn("GitHub", "https://github.com/clay-good/enklayve"),
      linkBtn("Made with ♥ by Clay Good", "https://claygood.com", "footer-btn--accent"),
    ),
  );
}

/**
 * The Readout dropzone — the hero of the home experience (BUILD-SPEC-2 §1.1,
 * §2). It is the single most personal moment in the product: drop a document
 * and get an instant private readout, parsed on the device. This is the inviting
 * entry point that navigates into the Readout view, where the deterministic,
 * anchored extraction engine (Phase 14) reads the document.
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

/** All 50 states + DC, alphabetical by name. Not every state's income tax is
 *  modeled yet; the budget computes state tax for the ones it has and falls back
 *  to federal + FICA (with an honest note) for the rest. */
const US_STATES: { code: string; name: string }[] = [
  { code: "al", name: "Alabama" },
  { code: "ak", name: "Alaska" },
  { code: "az", name: "Arizona" },
  { code: "ar", name: "Arkansas" },
  { code: "ca", name: "California" },
  { code: "co", name: "Colorado" },
  { code: "ct", name: "Connecticut" },
  { code: "de", name: "Delaware" },
  { code: "dc", name: "District of Columbia" },
  { code: "fl", name: "Florida" },
  { code: "ga", name: "Georgia" },
  { code: "hi", name: "Hawaii" },
  { code: "id", name: "Idaho" },
  { code: "il", name: "Illinois" },
  { code: "in", name: "Indiana" },
  { code: "ia", name: "Iowa" },
  { code: "ks", name: "Kansas" },
  { code: "ky", name: "Kentucky" },
  { code: "la", name: "Louisiana" },
  { code: "me", name: "Maine" },
  { code: "md", name: "Maryland" },
  { code: "ma", name: "Massachusetts" },
  { code: "mi", name: "Michigan" },
  { code: "mn", name: "Minnesota" },
  { code: "ms", name: "Mississippi" },
  { code: "mo", name: "Missouri" },
  { code: "mt", name: "Montana" },
  { code: "ne", name: "Nebraska" },
  { code: "nv", name: "Nevada" },
  { code: "nh", name: "New Hampshire" },
  { code: "nj", name: "New Jersey" },
  { code: "nm", name: "New Mexico" },
  { code: "ny", name: "New York" },
  { code: "nc", name: "North Carolina" },
  { code: "nd", name: "North Dakota" },
  { code: "oh", name: "Ohio" },
  { code: "ok", name: "Oklahoma" },
  { code: "or", name: "Oregon" },
  { code: "pa", name: "Pennsylvania" },
  { code: "ri", name: "Rhode Island" },
  { code: "sc", name: "South Carolina" },
  { code: "sd", name: "South Dakota" },
  { code: "tn", name: "Tennessee" },
  { code: "tx", name: "Texas" },
  { code: "ut", name: "Utah" },
  { code: "vt", name: "Vermont" },
  { code: "va", name: "Virginia" },
  { code: "wa", name: "Washington" },
  { code: "wv", name: "West Virginia" },
  { code: "wi", name: "Wisconsin" },
  { code: "wy", name: "Wyoming" },
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
  const perPeriodLabel = (f: string): string =>
    ({ weekly: "a week", biweekly: "every 2 weeks", monthly: "a month", annually: "a year" })[f] ??
    "a month";
  // True only for the 25 states whose income tax is modeled (the rest fall back
  // to federal + FICA with an honest note).
  const isModeled = (code: string): boolean => !!(code && data && data.state(code));

  /** Annual total tax (federal income + FICA + state) via the shared engine. */
  const annualTax = (): number => {
    if (!fed || !fica) return 0;
    const annualWages = income * periodsFor(freq);
    const stateJ = isModeled(stateCode) ? (data!.state(stateCode) ?? undefined) : undefined;
    const input: TaxInput = { filingStatus: fs, wages: annualWages };
    return evaluateTaxes(input, { federal: fed, fica, state: stateJ }).totals.totalTax.toNumber();
  };

  const viz = el("div", { class: "home-budget__viz", attrs: { "aria-live": "polite" } });
  const taxesValue = el("span", { class: "home-budget__derived-value" });
  const incomeHint = el("p", { class: "home-budget__hint" });
  const taxNote = el("p", { class: "home-budget__note", attrs: { role: "note" } });

  const refreshChrome = (): void => {
    // The annualized-income caption: the same money, restated, for context.
    const annual = income * periodsFor(freq);
    incomeHint.textContent = income > 0 ? `That's about ${fmt0(annual)} a year` : "";
    // Honesty: if a state's income tax isn't modeled yet, say so plainly.
    if (stateCode && !isModeled(stateCode)) {
      const name = US_STATES.find((s) => s.code === stateCode)?.name ?? stateCode.toUpperCase();
      taxNote.textContent = `We don't model ${name}'s state income tax yet, so this shows federal + FICA only.`;
      taxNote.hidden = false;
    } else {
      taxNote.hidden = true;
      taxNote.textContent = "";
    }
  };

  const render = (): void => {
    const periods = periodsFor(freq);
    const taxes = annualTax() / periods; // the engine works annually; bring it back
    const totalExpenses = BUDGET_SPEND_ROWS.reduce((s, r) => s + Math.max(0, spend[r.key] ?? 0), 0);
    const totalInvest = BUDGET_INVEST_ROWS.reduce((s, r) => s + Math.max(0, invest[r.key] ?? 0), 0);
    // Take-home pay: what you actually keep after taxes (the money you live on
    // and invest from). "Left to assign" is the zero-based leftover after every
    // expense and investment is given a job.
    const takeHome = income - taxes;
    const left = takeHome - totalExpenses - totalInvest;
    const balanced = Math.round(left) === 0 && income > 0;
    const over = left < 0;

    taxesValue.textContent = fmt0(taxes);
    refreshChrome();

    const slices: Slice[] = [];
    // Whole-dollar slices so the legend matches the rest of the budget (taxes and
    // "left" can carry cents from the division above).
    const push = (label: string, value: number, c: string): void => {
      if (value > 0) slices.push({ label, value: Math.round(value), color: c });
    };
    push("Taxes", taxes, color.taxes!);
    for (const r of BUDGET_SPEND_ROWS) push(r.label, Math.max(0, spend[r.key] ?? 0), color[r.key]!);
    for (const r of BUDGET_INVEST_ROWS)
      push(r.label, Math.max(0, invest[r.key] ?? 0), color[r.key]!);
    if (left > 0)
      slices.push({ label: "Left to assign", value: Math.round(left), color: "var(--enk-accent)" });

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
        text: balanced
          ? "Every dollar has a job 🎉"
          : over
            ? "Trim a category to get back to zero"
            : "Send it to savings or a debt",
      }),
    );

    const grossRate = income > 0 ? totalInvest / income : 0;
    const takeHomeRate = takeHome > 0 ? totalInvest / takeHome : 0;
    const stat = (label: string, value: string, strong = false): HTMLElement =>
      el(
        "div",
        { class: `home-budget__stat${strong ? " home-budget__stat--strong" : ""}` },
        el("span", { class: "home-budget__stat-label", text: label }),
        el("span", { class: "home-budget__stat-value", text: value }),
      );
    // The two investment rates are the hero metrics: side-by-side tinted cards.
    const rates = el(
      "div",
      { class: "home-budget__rates" },
      stat("Investment rate, of gross income", pct0(grossRate), true),
      stat("Investment rate, of take-home pay", takeHome > 0 ? pct0(takeHomeRate) : "—", true),
    );
    const totals = el(
      "div",
      { class: "home-budget__totals" },
      stat("Total expenses", fmt0(totalExpenses)),
      stat("Total investments", fmt0(totalInvest)),
      stat("Take-home pay (after taxes)", fmt0(takeHome)),
    );
    const stats = el("div", { class: "home-budget__stats" }, rates, totals);

    clear(viz);
    viz.classList.toggle("is-balanced", balanced);
    viz.append(
      donutChart({
        slices,
        locale: "en-US",
        ariaLabel: "How your income is split across taxes, expenses, investments, and what is left",
        centerValue: fmt0(income),
        centerLabel: perPeriodLabel(freq),
      }),
      status,
      stats,
    );
  };

  // A whole-dollar input wrapped with a leading "$" so the money reads clearly.
  const moneyInput = (
    value: number,
    step: number,
    ariaLabel: string,
    onInput: (n: number) => void,
  ): HTMLElement => {
    const input = el("input", {
      type: "number",
      min: 0,
      step,
      value,
      attrs: { inputmode: "numeric", "aria-label": ariaLabel },
      on: {
        input: (e) => {
          onInput(toInt((e.target as HTMLInputElement).value));
          render();
        },
      },
    });
    return el(
      "span",
      { class: "home-budget__money" },
      el("span", { class: "home-budget__money-sign", attrs: { "aria-hidden": "true" }, text: "$" }),
      input,
    );
  };

  const numRow = (
    label: string,
    value: number,
    dotColor: string | null,
    step: number,
    onInput: (n: number) => void,
  ): HTMLElement => {
    const dot = el("span", { class: "home-budget__dot", attrs: { "aria-hidden": "true" } });
    if (dotColor) dot.style.background = dotColor;
    return el(
      "label",
      { class: "home-budget__row" },
      dotColor ? dot : null,
      el("span", { class: "home-budget__row-name", text: label }),
      moneyInput(value, step, label, onInput),
    );
  };

  const makeSelect = (
    label: string,
    opts: { value: string; label: string }[],
    current: string,
    extraClass: string,
    onChange: (v: string) => void,
  ): HTMLSelectElement => {
    const sel = el(
      "select",
      { class: `home-budget__select ${extraClass}`.trim(), attrs: { "aria-label": label } },
      ...opts.map((o) => option(o.value, o.label, o.value === current)),
    );
    sel.value = current;
    sel.addEventListener("change", () => {
      onChange(sel.value);
      render();
    });
    return sel;
  };

  const selectRow = (
    label: string,
    opts: { value: string; label: string }[],
    current: string,
    onChange: (v: string) => void,
  ): HTMLElement =>
    el(
      "label",
      { class: "home-budget__row home-budget__row--select" },
      el("span", { class: "home-budget__row-name", text: label }),
      makeSelect(label, opts, current, "", onChange),
    );

  const stateOptions = [
    { value: "", label: "Select your state…" },
    ...US_STATES.map((s) => ({ value: s.code, label: s.name })),
  ];

  // Income + how-often sit on one line ("$5,000 a month"), with the annual
  // equivalent restated underneath.
  const incomeBlock = el(
    "div",
    { class: "home-budget__income" },
    el(
      "label",
      { class: "home-budget__row home-budget__row--income" },
      el("span", { class: "home-budget__row-name", text: "Income" }),
      moneyInput(income, 100, "Income", (n) => {
        income = n;
      }),
      makeSelect(
        "How often you're paid",
        BUDGET_FREQUENCIES,
        freq,
        "home-budget__select--freq",
        (v) => {
          freq = v;
        },
      ),
    ),
    incomeHint,
  );

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
    incomeBlock,
    selectRow("Filing status", BUDGET_FILING_STATUSES, fs, (v) => {
      fs = v as FilingStatus;
    }),
    selectRow("State", stateOptions, stateCode, (v) => {
      stateCode = v;
    }),
    taxesRow,
    taxNote,
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
 * The anti-budget note that closes the home budget. Short, plain-English (about a
 * 7th-grade reading level), split into "why it works", "make it automatic", and
 * "the order to fund things" so the idea sticks and people act on it.
 */
function budgetWhy(): HTMLElement {
  const para = (text: string): HTMLElement => el("p", { class: "budget-why__p", text });
  const subhead = (text: string): HTMLElement => el("h3", { class: "budget-why__subhead", text });
  return el(
    "section",
    { class: "budget-why home-budget-why" },
    el("h2", { class: "budget-why__title", text: "The anti-budget: give every dollar a job" }),
    para(
      "Most budgets fail because they run on willpower, and willpower runs out by week three. So flip it. Decide where every dollar goes before the month starts. When the choice is already made, there is nothing left to fight at the store.",
    ),
    subhead("Then make it automatic"),
    para(
      "Get yourself out of the way. Turn on automatic 401(k), IRA, and HSA contributions so the money moves before you can spend it. Put every bill on autopay. Set money to move to savings on payday. You are building a little robot that grows your money while you sleep, and the robot never gets tired or tempted.",
    ),
    subhead("Fund things in this order"),
    para(
      "Grab your full 401(k) match first, because it is free money. Then pay off high-interest debt fast, since clearing a 24% card is a guaranteed 24% raise. Then save six months of expenses in a high-yield savings account. After that, invest in this order: 401(k), traditional IRA, HSA, then a regular brokerage. Once it all runs on autopilot, buy whatever future you believe in, from a rental house to index funds to a rare Charizard.",
    ),
    subhead("Just do the next thing"),
    para(
      "That is the whole plan, and you do not need a separate dashboard to run it. Look at the budget above to see where you stand, then find the first line here you have not finished and do only that one. Cushion, match, debt, six-month fund, then invest, one move at a time. Knowing where you stand is just knowing which line you are on. The rest is patience and autopay.",
    ),
  );
}

/**
 * The home: a short, calm column — the hero line, the Readout dropzone, the
 * budget (your situation and your plan in one live picture), and the anti-budget
 * note. Tools are reached from the All Tools index (footer) and the ⌘K palette;
 * the per-tool SEO pages and `#/all-tools` index remain.
 */
function renderHome(
  container: HTMLElement,
  navigate: (id: string | null) => void,
  data: BundledData | null = null,
): void {
  clear(container);
  document.title = "enklayve";

  const hero = el(
    "section",
    { class: "hero" },
    el("h1", { class: "hero-title", text: "Your money, made simple." }),
    el("p", {
      class: "hero-sub",
      text: "Your real take-home pay, the taxes you owe, the benefits you might be missing, and your next smart move. Free forever, truly private, and every number shows its math, computed right here on your device, never uploaded.",
    }),
  );

  container.append(hero, readoutDropzone(navigate), homeBudgetWidget(data), budgetWhy());
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
function renderAllTools(container: HTMLElement, navigate: NavigateFn): void {
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
      text: "Every enklayve calculator, grouped by topic. Each runs entirely on your device.",
    }),
  );

  // One section per topic hub (the unit the app actually navigates to); each
  // heading opens the hub, and every calculator it hosts is listed beneath,
  // deep-linking into the hub already switched to that tool — so the browse
  // path reaches all the calculators by name, not just the 10 hubs.
  const sections = el("div", { class: "all-tools" });
  for (const hub of TILES) {
    const subs = SUB_TOOLS.filter((s) => s.hubId === hub.id).map((s) => s.tile);
    sections.append(
      el(
        "section",
        { class: "all-tools-group" },
        el(
          "h2",
          { class: "all-tools-hub-heading" },
          el(
            "button",
            { type: "button", class: "all-tools-hub", on: { click: () => navigate(hub.id) } },
            hub.title,
          ),
        ),
        el("ul", { class: "tile-list" }, ...subs.map((t) => subToolLink(t, hub.id, navigate))),
      ),
    );
  }

  container.append(el("article", { class: "tile" }, head, sections));
}

/** A calculator entry under a hub in the All Tools index (title + description). */
function subToolLink(tile: TileDefinition, hubId: string, navigate: NavigateFn): HTMLElement {
  return el(
    "li",
    {},
    el(
      "button",
      {
        type: "button",
        class: "tile-link tile-link--stacked",
        on: { click: () => navigate(hubId, new URLSearchParams({ tool: tile.id })) },
      },
      el("span", { class: "tile-link-title", text: tile.title }),
      el("span", { class: "tile-link-desc", text: tile.description }),
    ),
  );
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

  const content = el("main", { id: "content", class: "content", attrs: { tabindex: "-1" } });
  const header = buildHeader(navigate);
  const footer = buildFooter(navigate);

  // Skip-to-content link (WCAG 2.4.1 "bypass blocks"): the first focusable thing
  // on the page, hidden until focused. It focuses the <main> directly rather than
  // navigating to `#content` — a bare hash fragment would be parsed by the
  // fragment router and bounce the reader to the home.
  const skipLink = el(
    "a",
    {
      class: "skip-link",
      href: "#content",
      on: {
        click: (e) => {
          e.preventDefault();
          content.focus();
          content.scrollIntoView();
        },
      },
    },
    "Skip to content",
  );

  root.replaceChildren(skipLink, header, content, footer);
  document.body.append(palette.element);

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
    },
  };
}

// Exposed for unit tests.
export { renderHome, renderAbout, renderTileView, renderAllTools, renderReadout, renderReport };
