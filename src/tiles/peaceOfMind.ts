/**
 * Peace of Mind dashboard (BUILD-SPEC.md §5.2) — the calm-wealth overview that
 * consolidates the Safe Harbor readings into one place, so the user enters their
 * situation once and sees every lens together rather than re-typing the same
 * essentials and savings into four near-identical calculators:
 *
 *   - Cushion (the rainy-day fund): months of essential expenses your savings
 *     cover, against a chosen target.
 *   - Runway: how long savings last at your full burn, plus a downshift scenario
 *     (cutting back to essentials).
 *   - Net worth (the war chest): assets minus debts.
 *   - My Enough Number: annual essentials ÷ a safe withdrawal rate, with
 *     progress toward it.
 *
 * Every figure is computed on the device from My Situation. Assumptions (the
 * target months and the withdrawal rate) are shown and adjustable — never hidden
 * (§5.3). The tone frames progress, never "you are behind".
 */
import { el } from "../ui/dom";
import { countUp } from "../ui/countup";
import { field, parseNonNegative, parseNumber, pct, tryExampleButton } from "../ui/form";
import type { SituationStore } from "../profile/situation";
import type { TileContext, TileDefinition } from "./types";

interface Config {
  /** Rainy-day target in months of essential expenses. */
  targetMonths: number;
  /** Safe withdrawal rate, as a percentage (e.g. 4 for 4%). */
  withdrawalRatePct: number;
  /** Assets beyond liquid savings (investments, home equity) for net worth. */
  otherAssets: number;
}

function readConfig(p: URLSearchParams): Config {
  return {
    targetMonths: Math.max(1, parseNonNegative(p.get("m"), 3)),
    withdrawalRatePct: Math.max(0.1, parseNumber(p.get("wr"), 4)),
    otherAssets: parseNonNegative(p.get("assets"), 0),
  };
}

function writeConfig(c: Config): URLSearchParams {
  const p = new URLSearchParams();
  if (c.targetMonths !== 3) p.set("m", String(c.targetMonths));
  if (c.withdrawalRatePct !== 4) p.set("wr", String(c.withdrawalRatePct));
  if (c.otherAssets > 0) p.set("assets", String(c.otherAssets));
  return p;
}

interface Readings {
  essential: number;
  total: number;
  savings: number;
  debts: number;
  netWorth: number;
  cushionMonths: number;
  cushionTarget: number;
  runwayMonths: number;
  downshiftMonths: number;
  annualEssentials: number;
  enough: number;
  enoughProgressPct: number;
}

function compute(profile: SituationStore, config: Config): Readings {
  const essential = profile.get("essentialMonthlyExpenses") ?? 0;
  const total = profile.get("totalMonthlyExpenses") ?? essential;
  const savings = profile.get("liquidSavings") ?? 0;
  const debts = (profile.get("debts") ?? []).reduce((sum, d) => sum + d.balance, 0);
  const netWorth = savings + config.otherAssets - debts;
  const annualEssentials = essential * 12;
  const enough = annualEssentials / (config.withdrawalRatePct / 100);
  return {
    essential,
    total,
    savings,
    debts,
    netWorth,
    cushionMonths: essential > 0 ? savings / essential : 0,
    cushionTarget: essential * config.targetMonths,
    runwayMonths: total > 0 ? savings / total : 0,
    downshiftMonths: essential > 0 ? savings / essential : 0,
    annualEssentials,
    enough,
    enoughProgressPct: enough > 0 ? Math.min(100, (netWorth / enough) * 100) : 0,
  };
}

const usd = (n: number, locale: string): string =>
  new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
const months = (n: number): string => `${n.toFixed(1)} months`;

/** One calm reading: a label, an animated headline, a sub-line, and an optional
 * progress bar. */
function reading(opts: {
  label: string;
  headlineTarget: number;
  format: (n: number) => string;
  sub: string;
  progress?: { value: number; max: number; label: string };
}): HTMLElement {
  const headline = el("p", {
    class: "ph-reading-value",
    attrs: { "aria-live": "polite" },
    text: "",
  });
  countUp(headline, opts.headlineTarget, opts.format);
  const children: (HTMLElement | null)[] = [
    el("p", { class: "ph-reading-label", text: opts.label }),
    headline,
    el("p", { class: "ph-reading-sub", text: opts.sub }),
  ];
  if (opts.progress) {
    children.push(
      el("progress", {
        class: "ph-progress",
        attrs: {
          value: String(Math.min(opts.progress.value, opts.progress.max)),
          max: String(opts.progress.max),
          "aria-label": opts.progress.label,
        },
      }),
    );
  }
  return el(
    "section",
    { class: "ph-reading", attrs: { "aria-label": opts.label } },
    ...children.filter(Boolean),
  );
}

export function mountPeaceOfMind(ctx: TileContext): void {
  const { root, profile } = ctx;
  root.replaceChildren();
  let config = readConfig(ctx.params);

  const intro = el("p", {
    class: "ph-intro",
    text: "Where you stand, calmly. Enter your situation once and see every safe-harbor reading together, all computed on your device.",
  });

  const dashboard = el("div", { class: "ph-dashboard", attrs: { "aria-live": "polite" } });

  function renderDashboard(): void {
    dashboard.replaceChildren();
    const r = compute(profile, config);

    if (r.essential <= 0) {
      dashboard.append(
        el("p", {
          class: "ph-empty",
          text: "Add your essential monthly expenses below to see your cushion, runway, and Enough Number.",
        }),
      );
      return;
    }

    dashboard.append(
      reading({
        label: "Rainy-day cushion",
        headlineTarget: r.cushionMonths,
        format: months,
        sub: `Covers essentials. Target ${config.targetMonths} months = ${usd(r.cushionTarget, ctx.locale)}; you have ${usd(r.savings, ctx.locale)}.`,
        progress: {
          value: r.cushionMonths,
          max: config.targetMonths,
          label: "Progress to your cushion target",
        },
      }),
      reading({
        label: "Runway",
        headlineTarget: r.runwayMonths,
        format: months,
        sub: `At your full burn of ${usd(r.total, ctx.locale)}/mo. Cutting back to essentials would stretch it to ${months(r.downshiftMonths)}.`,
      }),
      reading({
        label: "Net worth (war chest)",
        headlineTarget: r.netWorth,
        format: (n) => usd(n, ctx.locale),
        sub: `Savings ${usd(r.savings, ctx.locale)} + other assets ${usd(config.otherAssets, ctx.locale)} − debts ${usd(r.debts, ctx.locale)}.`,
      }),
      reading({
        label: "My Enough Number",
        headlineTarget: r.enough,
        format: (n) => usd(n, ctx.locale),
        sub: `Annual essentials ${usd(r.annualEssentials, ctx.locale)} ÷ ${pct(config.withdrawalRatePct / 100)} withdrawal rate (your assumption). You're ${r.enoughProgressPct.toFixed(0)}% of the way, every step counts.`,
        progress: {
          value: r.enoughProgressPct,
          max: 100,
          label: "Progress toward My Enough Number",
        },
      }),
    );
  }

  // --- Shared inputs (My Situation, entered once) ---
  function numberField(
    name: string,
    label: string,
    value: number | undefined,
    onChange: (v: number) => void,
    step = 100,
  ): HTMLElement {
    const input = el("input", {
      type: "number",
      name,
      min: 0,
      step,
      value: value ?? "",
      attrs: { "aria-label": label, inputmode: "decimal" },
      on: {
        input: (e) => {
          onChange(parseNonNegative((e.target as HTMLInputElement).value, 0));
          renderDashboard();
        },
      },
    });
    return field(label, input);
  }

  const essentialField = numberField(
    "essential",
    "Essential monthly expenses",
    profile.get("essentialMonthlyExpenses"),
    (v) => profile.set("essentialMonthlyExpenses", v),
  );
  const totalField = numberField(
    "total",
    "Total monthly spending",
    profile.get("totalMonthlyExpenses"),
    (v) => profile.set("totalMonthlyExpenses", v),
  );
  const savingsField = numberField(
    "savings",
    "Liquid savings",
    profile.get("liquidSavings"),
    (v) => profile.set("liquidSavings", v),
    500,
  );

  // --- Adjustable assumptions (URL-encoded, deep-linkable) ---
  const assetsField = numberField(
    "assets",
    "Other assets (investments, home equity)",
    config.otherAssets || undefined,
    (v) => {
      config = { ...config, otherAssets: v };
      ctx.setParams(writeConfig(config));
    },
    1000,
  );
  const monthsInput = el("input", {
    type: "number",
    name: "m",
    min: 1,
    step: 1,
    value: config.targetMonths,
    attrs: { "aria-label": "Rainy-day target in months" },
    on: {
      input: (e) => {
        config = {
          ...config,
          targetMonths: Math.max(1, parseNonNegative((e.target as HTMLInputElement).value, 3)),
        };
        ctx.setParams(writeConfig(config));
        renderDashboard();
      },
    },
  });
  const wrInput = el("input", {
    type: "number",
    name: "wr",
    min: 0.1,
    step: 0.25,
    value: config.withdrawalRatePct,
    attrs: { "aria-label": "Safe withdrawal rate (percent)", inputmode: "decimal" },
    on: {
      input: (e) => {
        config = {
          ...config,
          withdrawalRatePct: Math.max(0.1, parseNumber((e.target as HTMLInputElement).value, 4)),
        };
        ctx.setParams(writeConfig(config));
        renderDashboard();
      },
    },
  });

  const tryExample = tryExampleButton(() => {
    profile.set("essentialMonthlyExpenses", 3200);
    profile.set("totalMonthlyExpenses", 4500);
    profile.set("liquidSavings", 12000);
    config = { targetMonths: 3, withdrawalRatePct: 4, otherAssets: 60000 };
    essentialField.querySelector("input")!.value = "3200";
    totalField.querySelector("input")!.value = "4500";
    savingsField.querySelector("input")!.value = "12000";
    assetsField.querySelector("input")!.value = "60000";
    monthsInput.value = "3";
    wrInput.value = "4";
    ctx.setParams(writeConfig(config));
    renderDashboard();
  });

  const inputs = el(
    "details",
    { class: "ph-config", attrs: { open: "" } },
    el("summary", { text: "My Situation & assumptions" }),
    el("p", {
      class: "ph-config-note",
      text: "These live only in this session and are cleared when you leave. Nothing is ever uploaded.",
    }),
    el(
      "div",
      { class: "tile-form" },
      essentialField,
      totalField,
      savingsField,
      assetsField,
      field("Rainy-day target (months)", monthsInput),
      field("Safe withdrawal rate (%)", wrInput),
    ),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(intro, dashboard, inputs);
  renderDashboard();
}

export const peaceOfMindTile: TileDefinition = {
  id: "peace-of-mind",
  title: "Peace of Mind",
  pillar: "stand",
  description: "Your cushion, runway, net worth, and Enough Number, one calm overview.",
  keywords: [
    "dashboard",
    "overview",
    "calm",
    "rainy day",
    "emergency fund",
    "cushion",
    "runway",
    "burn rate",
    "war chest",
    "net worth",
    "enough",
    "fire",
    "financial independence",
  ],
  status: "ready",
  how: "From your essentials, total spending, savings, and debts we compute four calm readings: your cushion (savings ÷ essential monthly spending = months covered), your runway (savings ÷ total monthly spending, plus a downshift scenario at essentials only), your net worth (savings + other assets − debts), and My Enough Number (annual essentials ÷ your safe-withdrawal rate, e.g. 4% ≈ 25×).\n\nThe target months and the withdrawal rate are your assumptions, shown and adjustable. The tone is progress, never shame.",
  resources: [
    {
      label: "CFPB, building an emergency fund",
      url: "https://www.consumerfinance.gov/an-essential-guide-to-building-an-emergency-fund/",
    },
    { label: "Investor.gov, saving & investing", url: "https://www.investor.gov/" },
  ],
  mount: mountPeaceOfMind,
};
