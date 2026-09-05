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
import { capMonths, MAX_HORIZON_MONTHS } from "../engine/finance";
import { el } from "../ui/dom";
import { countUp } from "../ui/countup";
import {
  clampNote,
  didClamp,
  field,
  parseNonNegative,
  parseNumber,
  pct,
  tryExampleButton,
} from "../ui/form";
import type { SituationStore } from "../profile/situation";
import type { TileContext, TileDefinition } from "./types";

interface Config {
  /** Rainy-day target in months of essential expenses. */
  targetMonths: number;
  /** Safe withdrawal rate, as a percentage (e.g. 4 for 4%). */
  withdrawalRatePct: number;
  /** Assets beyond liquid savings (investments, home equity) for net worth. */
  otherAssets: number;
  /** Monthly amount saved toward the Enough Number (a labeled assumption). */
  monthlySavings: number;
  /** Essential monthly expenses — the link when it carries one, My Situation otherwise. */
  essential: number;
  /** Total monthly spending. `undefined` means "same as essentials", which is what it falls back to. */
  total: number | undefined;
  /** Liquid savings. */
  savings: number;
}

/**
 * The link wins where it says something; My Situation answers where it does not.
 *
 * That is the rule every other Safe Harbor tile already followed — Sabbatical,
 * Downshift and Life Insurance all read `p.has("s") ? … : profile.get(…)` — and
 * this one, the pillar's front door, did not. Its three shared figures came from
 * the profile alone, which is session-only by design, so the URL it wrote was
 * shareable in form and empty in fact: a reader following the link that produced
 * "$12,000 covers 3.8 months" saw "Add your essential monthly expenses below."
 * A reload of the sender's own tab did the same thing.
 */
function readConfig(p: URLSearchParams, profile: SituationStore): Config {
  return {
    targetMonths: Math.max(1, capMonths(parseNonNegative(p.get("m"), 3))),
    withdrawalRatePct: Math.max(0.1, parseNumber(p.get("wr"), 4)),
    otherAssets: parseNonNegative(p.get("assets"), 0),
    monthlySavings: parseNonNegative(p.get("sav"), 0),
    essential: p.has("ess")
      ? parseNonNegative(p.get("ess"), 0)
      : (profile.get("essentialMonthlyExpenses") ?? 0),
    total: p.has("tot") ? parseNonNegative(p.get("tot"), 0) : profile.get("totalMonthlyExpenses"),
    savings: p.has("s") ? parseNonNegative(p.get("s"), 0) : (profile.get("liquidSavings") ?? 0),
  };
}

function writeConfig(c: Config): URLSearchParams {
  const p = new URLSearchParams();
  if (c.targetMonths !== 3) p.set("m", String(c.targetMonths));
  if (c.withdrawalRatePct !== 4) p.set("wr", String(c.withdrawalRatePct));
  if (c.otherAssets > 0) p.set("assets", String(c.otherAssets));
  if (c.monthlySavings > 0) p.set("sav", String(c.monthlySavings));
  // Written whether or not they are zero, unlike the assumptions above. An
  // assumption left at its default is restored by the default; these three are
  // restored by My Situation, and a profile is not silent. Omitting a zero here
  // means a reader who clears their savings to 0 gets a link — and a reload —
  // that answers with the $12,000 another tile put in the profile earlier in
  // the session. `tot` is the exception, because `undefined` is a real value it
  // carries: "same as essentials", which is what it falls back to.
  p.set("ess", String(c.essential));
  if (c.total !== undefined) p.set("tot", String(c.total));
  p.set("s", String(c.savings));
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
  /** Gap left to the Enough Number (0 once reached). */
  enoughGap: number;
  /** Months to close the gap at the savings rate; Infinity when no rate is set. */
  monthsToEnough: number;
}

function compute(profile: SituationStore, config: Config): Readings {
  const essential = config.essential;
  const total = config.total ?? essential;
  const savings = config.savings;
  const debts = (profile.get("debts") ?? []).reduce((sum, d) => sum + d.balance, 0);
  const netWorth = savings + config.otherAssets - debts;
  const annualEssentials = essential * 12;
  const enough = annualEssentials / (config.withdrawalRatePct / 100);
  // Linear arrival: how long the current monthly savings rate takes to close the
  // gap to the Enough Number, not counting investment growth (a deliberately
  // conservative, market-return-free projection — §5.3, SPEC-3 §4.8).
  const enoughGap = Number.isFinite(enough) && enough > netWorth ? enough - netWorth : 0;
  const monthsToEnough =
    config.monthlySavings > 0 && enoughGap > 0 ? capMonths(enoughGap / config.monthlySavings) : 0;
  return {
    essential,
    total,
    savings,
    debts,
    netWorth,
    // Capped at the engine's horizon ceiling, like every other horizon on the
    // site. These are divisions done here rather than in the engine, and they
    // were the one set that skipped it: a deep link with a cent of monthly
    // spending printed a runway of 100000000000000000.0 months — finite, so the
    // no-NaN sweep passed it, and in the middle of a calm sentence.
    cushionMonths: essential > 0 ? capMonths(savings / essential) : 0,
    cushionTarget: essential * config.targetMonths,
    runwayMonths: total > 0 ? capMonths(savings / total) : 0,
    downshiftMonths: essential > 0 ? capMonths(savings / essential) : 0,
    annualEssentials,
    enough,
    // Both netWorth and `enough` can overflow to Infinity on absurd inputs
    // (essentials near Number.MAX_VALUE), and Infinity / Infinity is NaN — guard
    // it so the "% of the way" copy and the progress bar never render NaN.
    enoughProgressPct:
      enough > 0 && Number.isFinite(netWorth) ? Math.min(100, (netWorth / enough) * 100) : 0,
    enoughGap,
    monthsToEnough,
  };
}

/** A months count as calm prose: "about 8 years 4 months", year-only past a year. */
function durationLabel(totalMonths: number): string {
  if (!Number.isFinite(totalMonths) || totalMonths <= 0) return "—";
  if (totalMonths >= MAX_HORIZON_MONTHS) return `over ${MAX_HORIZON_MONTHS / 12} years`;
  const years = Math.floor(totalMonths / 12);
  const months = Math.round(totalMonths % 12);
  if (years === 0) return `${months} month${months === 1 ? "" : "s"}`;
  if (months === 0) return `${years} year${years === 1 ? "" : "s"}`;
  return `${years} yr ${months} mo`;
}

// Both helpers guard non-finite the same way the shared formatters do
// (Money.format, the pct helper, the count-up): an overflowing or NaN reading
// renders the neutral "(out of range)" sentinel, never "$NaN" / "$∞" / "NaN".
const usd = (n: number, locale: string): string =>
  Number.isFinite(n)
    ? new Intl.NumberFormat(locale, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(n)
    : "(out of range)";
/**
 * A months reading, in the calm register the rest of the tile uses.
 *
 * At the ceiling it says so rather than printing 1200.0, because the cap is the
 * point past which this stops being an answer — quoting it to a tenth of a
 * month would dress a limit up as a measurement. Below it, digits are grouped:
 * this was the only figure on the page that was not, so a large but perfectly
 * real reading arrived as an unbroken run of numerals beside money that was
 * formatted properly.
 */
const months = (n: number): string => {
  if (!Number.isFinite(n)) return "(out of range)";
  if (n >= MAX_HORIZON_MONTHS) return `over ${MAX_HORIZON_MONTHS / 12} years`;
  return `${n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} months`;
};

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
  let config = readConfig(ctx.params, profile);

  const intro = el("p", {
    class: "ph-intro",
    text: "Where you stand, calmly. Enter your situation once and see every safe-harbor reading together, all computed on your device.",
  });

  // Disclose any deep-link clamp (SPEC-3 §2.3 / B1): the withdrawal-rate floor
  // (0.1%) and the rainy-day target's floor and ceiling silently rewrite an
  // out-of-range fragment, so a pasted link wouldn't reproduce exactly without
  // this note. The ceiling is the newer half — `?m=1e15` used to print "Target
  // 1000000000000000 months" beside a cushion figure computed from it.
  const clampMessages: string[] = [];
  const rawTarget = parseNonNegative(ctx.params.get("m"), 3);
  if (didClamp(ctx.params, "m", rawTarget, config.targetMonths)) {
    clampMessages.push(
      rawTarget < config.targetMonths
        ? `the rainy-day target was raised to the ${config.targetMonths}-month minimum`
        : `the rainy-day target was capped at ${config.targetMonths.toLocaleString("en-US")} months`,
    );
  }
  if (didClamp(ctx.params, "wr", parseNumber(ctx.params.get("wr"), 4), config.withdrawalRatePct)) {
    clampMessages.push(`the withdrawal rate was raised to its ${config.withdrawalRatePct}% floor`);
  }

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

    // Arrival projection: when do you reach the Enough Number at your savings rate?
    let arrivalTarget: number;
    let arrivalFormat: (n: number) => string;
    let arrivalSub: string;
    if (r.enoughGap <= 0) {
      arrivalTarget = 0;
      arrivalFormat = () => "You're there";
      arrivalSub = "Your net worth already covers your Enough Number. Nicely done.";
    } else if (config.monthlySavings > 0) {
      arrivalTarget = r.monthsToEnough;
      arrivalFormat = durationLabel;
      arrivalSub = `Saving ${usd(config.monthlySavings, ctx.locale)}/mo (your assumption) closes the ${usd(r.enoughGap, ctx.locale)} gap. This is linear — it doesn't count investment growth, so it's the cautious estimate.`;
    } else {
      arrivalTarget = 0;
      arrivalFormat = () => "Add a monthly amount";
      arrivalSub = "Enter what you save each month below to project when you arrive.";
    }
    dashboard.append(
      reading({
        label: "Time to your Enough Number",
        headlineTarget: arrivalTarget,
        format: arrivalFormat,
        sub: arrivalSub,
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

  // Each of these still fills My Situation, so the other Safe Harbor tiles pick
  // it up without re-typing — and now also the URL, so the reading survives a
  // reload and travels with the link.
  const essentialField = numberField(
    "ess",
    "Essential monthly expenses",
    config.essential || undefined,
    (v) => {
      profile.set("essentialMonthlyExpenses", v);
      config = { ...config, essential: v };
      ctx.setParams(writeConfig(config));
    },
  );
  const totalField = numberField("tot", "Total monthly spending", config.total, (v) => {
    profile.set("totalMonthlyExpenses", v);
    config = { ...config, total: v };
    ctx.setParams(writeConfig(config));
  });
  const savingsField = numberField(
    "s",
    "Liquid savings",
    config.savings || undefined,
    (v) => {
      profile.set("liquidSavings", v);
      config = { ...config, savings: v };
      ctx.setParams(writeConfig(config));
    },
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
  const savingsRateField = numberField(
    "sav",
    "Monthly savings toward your Enough Number",
    config.monthlySavings || undefined,
    (v) => {
      config = { ...config, monthlySavings: v };
      ctx.setParams(writeConfig(config));
      renderDashboard();
    },
    100,
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
          targetMonths: Math.max(
            1,
            capMonths(parseNonNegative((e.target as HTMLInputElement).value, 3)),
          ),
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
    config = {
      targetMonths: 3,
      withdrawalRatePct: 4,
      otherAssets: 60000,
      monthlySavings: 1500,
      essential: 3200,
      total: 4500,
      savings: 12000,
    };
    essentialField.querySelector("input")!.value = "3200";
    totalField.querySelector("input")!.value = "4500";
    savingsField.querySelector("input")!.value = "12000";
    assetsField.querySelector("input")!.value = "60000";
    savingsRateField.querySelector("input")!.value = "1500";
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
      savingsRateField,
      field("Rainy-day target (months)", monthsInput),
      field("Safe withdrawal rate (%)", wrInput),
    ),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  const note = clampNote(root, clampMessages);
  root.append(intro, ...(note ? [note] : []), dashboard, inputs);
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
  how: "From your essentials, total spending, savings, and debts we compute calm readings: your cushion (savings ÷ essential monthly spending = months covered), your runway (savings ÷ total monthly spending, plus a downshift scenario at essentials only), your net worth (savings + other assets − debts), and My Enough Number (annual essentials ÷ your safe-withdrawal rate, e.g. 4% ≈ 25×).\n\nEnter a monthly savings amount and we also project the time to your Enough Number — a straight-line estimate at that rate that deliberately doesn't assume any investment growth, so it's the cautious version. The target months, the withdrawal rate, and the savings rate are your assumptions, shown and adjustable. The tone is progress, never shame.",
  resources: [
    {
      label: "CFPB, building an emergency fund",
      url: "https://www.consumerfinance.gov/an-essential-guide-to-building-an-emergency-fund/",
    },
    { label: "Investor.gov, saving & investing", url: "https://www.investor.gov/" },
  ],
  mount: mountPeaceOfMind,
};
