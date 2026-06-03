/**
 * My Plan tile (BUILD-SPEC-2 §4): the calm, deterministic guidance engine made
 * visible. It reads My Situation, surfaces the single next right step with its
 * dollar figure and a link to the tile that performs it, shows the math for every
 * step, and cites the rule behind the one statutory threshold (the retirement
 * limit). It is opinionated by default and fully adjustable (§4.2): the user can
 * change the rainy-day target, choose smallest-balance vs highest-rate debt
 * payoff, reorder steps, and turn steps off — all encoded in the URL so a plan is
 * deep-linkable. The tone follows the Safe Harbor rules (SPEC §5.3): it frames
 * progress and the next step, never "you are behind."
 */
import { el, option, clear, copyToClipboard } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
import {
  evaluatePlan,
  DEFAULT_CONFIG,
  DEFAULT_ORDER,
  type PlanConfig,
  type PlanInput,
  type PlanStepId,
  type DebtStrategy,
  type StepResult,
} from "../engine/plan";
import { Money } from "../engine/money";
import type { CitationData } from "../data/schemas";
import type { SituationStore, Debt } from "../profile/situation";
import type { TileContext, TileDefinition } from "./types";

// If the integrity gate rejects the bundled limits, the plan still works and
// stays sourced: the same public IRS figure, cited without a content hash.
const FALLBACK_LIMIT = 24500;
const FALLBACK_CITATION: CitationData = {
  sourceUrl: "https://www.irs.gov/pub/irs-drop/n-25-67.pdf",
  sourceDocument: "IRS Notice 2025-67 (2026 retirement plan limits)",
  effectiveYear: 2026,
  dateRetrieved: "2026-06-02",
};

const STRATEGY_PARAM: Record<DebtStrategy, string> = {
  "highest-rate": "rate",
  "smallest-balance": "balance",
};
const STRATEGY_FROM_PARAM: Record<string, DebtStrategy> = {
  rate: "highest-rate",
  balance: "smallest-balance",
};

function readConfig(p: URLSearchParams): PlanConfig {
  const orderRaw = (p.get("order") ?? "")
    .split(",")
    .filter((id): id is PlanStepId => DEFAULT_ORDER.includes(id as PlanStepId));
  // Keep every known step present even if the URL omits some.
  const order =
    orderRaw.length > 0
      ? [...orderRaw, ...DEFAULT_ORDER.filter((id) => !orderRaw.includes(id))]
      : [...DEFAULT_ORDER];
  const off = (p.get("off") ?? "")
    .split(",")
    .filter((id): id is PlanStepId => DEFAULT_ORDER.includes(id as PlanStepId));
  return {
    starterCushion: parseNonNegative(p.get("starter"), DEFAULT_CONFIG.starterCushion),
    rainyDayMonths: Math.max(1, parseNonNegative(p.get("m"), DEFAULT_CONFIG.rainyDayMonths)),
    highCostThresholdPct: parseNonNegative(p.get("thr"), DEFAULT_CONFIG.highCostThresholdPct),
    debtStrategy: STRATEGY_FROM_PARAM[p.get("ds") ?? ""] ?? DEFAULT_CONFIG.debtStrategy,
    enoughMultiple: Math.max(1, parseNonNegative(p.get("em"), DEFAULT_CONFIG.enoughMultiple)),
    order,
    disabled: off,
  };
}

function writeConfig(c: PlanConfig): URLSearchParams {
  const p = new URLSearchParams();
  if (c.rainyDayMonths !== DEFAULT_CONFIG.rainyDayMonths) p.set("m", String(c.rainyDayMonths));
  if (c.debtStrategy !== DEFAULT_CONFIG.debtStrategy) p.set("ds", STRATEGY_PARAM[c.debtStrategy]);
  if (c.highCostThresholdPct !== DEFAULT_CONFIG.highCostThresholdPct) {
    p.set("thr", String(c.highCostThresholdPct));
  }
  if (c.enoughMultiple !== DEFAULT_CONFIG.enoughMultiple) p.set("em", String(c.enoughMultiple));
  if (c.starterCushion !== DEFAULT_CONFIG.starterCushion)
    p.set("starter", String(c.starterCushion));
  if (c.order.join(",") !== DEFAULT_ORDER.join(",")) p.set("order", c.order.join(","));
  if (c.disabled.length > 0) p.set("off", c.disabled.join(","));
  return p;
}

function deriveInput(profile: SituationStore, ctx: TileContext): PlanInput {
  const limits = ctx.data?.retirementLimits() ?? null;
  return {
    liquidSavings: profile.get("liquidSavings") ?? 0,
    essentialMonthlyExpenses: profile.get("essentialMonthlyExpenses") ?? 0,
    employerMatchAnnual: profile.get("employerMatchAnnual") ?? 0,
    employerMatchCaptured: profile.get("employerMatchCaptured") ?? 0,
    debts: profile.get("debts") ?? [],
    retirementContributionsAnnual: profile.get("retirementContributionsAnnual") ?? 0,
    retirementLimitAnnual: limits?.limits.elective_deferral_401k ?? FALLBACK_LIMIT,
    retirementLimitCitation: limits?.citation ?? FALLBACK_CITATION,
    sinkingGoals: [],
  };
}

const STATUS_MARK: Record<StepResult["status"], string> = {
  complete: "✓",
  active: "→",
  upcoming: "•",
};
const STATUS_WORD: Record<StepResult["status"], string> = {
  complete: "On track",
  active: "Your next step",
  upcoming: "Up next",
};

function citationLink(c: CitationData): HTMLElement {
  return el(
    "a",
    {
      class: "cite-link",
      href: c.sourceUrl,
      attrs: {
        rel: "noopener noreferrer",
        target: "_blank",
        title: `Source: ${c.sourceDocument} (${c.effectiveYear})`,
      },
    },
    "source",
  );
}

function stepMath(step: StepResult): HTMLElement {
  const rows = step.math.map((line) =>
    el(
      "tr",
      { class: "bd-row" },
      el("th", { class: "bd-label", attrs: { scope: "row" }, text: line.label }),
      el("td", { class: "bd-value", text: line.value }),
    ),
  );
  const table = el("table", { class: "breakdown-table" }, el("tbody", {}, ...rows));
  const cite = step.citation
    ? el(
        "p",
        { class: "plan-step-cite" },
        el("span", { text: `${step.citation.sourceDocument} (${step.citation.effectiveYear}) ` }),
        citationLink(step.citation),
      )
    : null;
  return el(
    "details",
    { class: "breakdown" },
    el("summary", { text: "Show the math" }),
    table,
    cite,
  );
}

export function mountYourPlan(ctx: TileContext): void {
  const { root, profile } = ctx;
  root.replaceChildren();
  let config = readConfig(ctx.params);

  const intro = el("p", {
    class: "plan-intro",
    text: "A calm, ordered plan that reads My Situation and shows the single next right step, opinionated by default, fully yours to adjust. Every figure is computed on your device.",
  });

  // --- The plan output (the next step + the full ordered list) ---
  const planOutput = el("div", { class: "plan-output", attrs: { "aria-live": "polite" } });

  function persistConfig(): void {
    ctx.setParams(writeConfig(config));
  }

  function moveStep(id: PlanStepId, delta: number): void {
    const idx = config.order.indexOf(id);
    const next = idx + delta;
    if (idx < 0 || next < 0 || next >= config.order.length) return;
    const order = [...config.order];
    const a = order[idx];
    const b = order[next];
    if (a === undefined || b === undefined) return;
    order[idx] = b;
    order[next] = a;
    config = { ...config, order };
    persistConfig();
    renderPlan();
  }

  function toggleStep(id: PlanStepId, enabled: boolean): void {
    const disabled = enabled
      ? config.disabled.filter((d) => d !== id)
      : [...config.disabled.filter((d) => d !== id), id];
    config = { ...config, disabled };
    persistConfig();
    renderPlan();
  }

  function stepRow(step: StepResult, index: number): HTMLElement {
    const toggle = el("input", {
      type: "checkbox",
      checked: true,
      attrs: { "aria-label": `Include the “${step.title}” step` },
      on: { change: (e) => toggleStep(step.id, (e.target as HTMLInputElement).checked) },
    });
    const up = el("button", {
      type: "button",
      class: "btn btn--ghost plan-move",
      text: "▲",
      attrs: { "aria-label": `Move “${step.title}” earlier` },
      disabled: index === 0,
      on: { click: () => moveStep(step.id, -1) },
    });
    const down = el("button", {
      type: "button",
      class: "btn btn--ghost plan-move",
      text: "▼",
      attrs: { "aria-label": `Move “${step.title}” later` },
      on: { click: () => moveStep(step.id, 1) },
    });
    const open = el("button", {
      type: "button",
      class: "btn btn--ghost plan-open",
      text: "Open the tool →",
      on: {
        click: () =>
          ctx.navigate(
            step.tileId,
            step.tool ? new URLSearchParams({ tool: step.tool }) : undefined,
          ),
      },
    });

    const statusLine = step.satisfied
      ? el("p", { class: "plan-step-status", text: "On track, nothing to do here right now." })
      : el("p", { class: "plan-step-status plan-step-status--action", text: step.action });

    return el(
      "li",
      { class: `plan-step plan-step--${step.status}` },
      el(
        "div",
        { class: "plan-step-head" },
        el("span", {
          class: "plan-step-mark",
          attrs: { "aria-hidden": "true" },
          text: STATUS_MARK[step.status],
        }),
        el(
          "div",
          { class: "plan-step-titles" },
          el("span", { class: "plan-step-title", text: step.title }),
          el("span", { class: "plan-step-tag", text: STATUS_WORD[step.status] }),
        ),
        el(
          "div",
          { class: "plan-step-controls" },
          up,
          down,
          el(
            "label",
            { class: "plan-step-include" },
            toggle,
            el("span", { class: "visually-hidden", text: `Include ${step.title}` }),
          ),
        ),
      ),
      statusLine,
      stepMath(step),
      open,
    );
  }

  function renderPlan(): void {
    clear(planOutput);
    const input = deriveInput(profile, ctx);
    const result = evaluatePlan(input, config);

    // The hero: the one next right step (or a calm "you're on track" when done).
    if (result.current) {
      const c = result.current;
      const amount =
        c.amount && c.amount.greaterThan(Money.zero()) ? c.amount.format(ctx.locale) : null;
      planOutput.append(
        el(
          "section",
          { class: "plan-next", attrs: { "aria-label": "Your next right step" } },
          el("p", { class: "plan-next-eyebrow", text: "Your next right step" }),
          el("h2", { class: "plan-next-title", text: c.title }),
          el("p", { class: "plan-next-action", text: c.action }),
          amount ? el("p", { class: "plan-next-amount" }, el("span", { text: amount })) : null,
          el(
            "div",
            { class: "plan-next-actions" },
            el("button", {
              type: "button",
              class: "btn btn--accent",
              text: "Open the tool that does this →",
              on: {
                click: () =>
                  ctx.navigate(
                    c.tileId,
                    c.tool ? new URLSearchParams({ tool: c.tool }) : undefined,
                  ),
              },
            }),
            el("button", {
              type: "button",
              class: "btn btn--ghost",
              text: "Copy link",
              on: { click: () => void copyToClipboard(ctx.permalink(writeConfig(config))) },
            }),
          ),
        ),
      );
    } else {
      planOutput.append(
        el(
          "section",
          { class: "plan-next plan-next--done", attrs: { "aria-label": "Plan status" } },
          el("p", { class: "plan-next-eyebrow", text: "Where you stand" }),
          el("h2", { class: "plan-next-title", text: "You're on track across every step." }),
          el("p", {
            class: "plan-next-action",
            text: "Each step below is met for now. Revisit whenever your situation changes.",
          }),
        ),
      );
    }

    // The full ordered plan.
    planOutput.append(
      el("h3", { class: "plan-list-head", text: "The whole plan" }),
      el("ol", { class: "plan-list" }, ...result.steps.map((s, i) => stepRow(s, i))),
    );
  }

  // --- My Situation inputs the plan reads (entered once, used everywhere) ---
  function numberInput(
    name: string,
    label: string,
    value: number | undefined,
    onChange: (v: number) => void,
    step = 100,
  ): HTMLInputElement {
    return el("input", {
      type: "number",
      name,
      min: 0,
      step,
      value: value ?? "",
      attrs: { "aria-label": label, inputmode: "decimal" },
      on: {
        input: (e) => {
          onChange(parseNonNegative((e.target as HTMLInputElement).value, 0));
          renderPlan();
        },
      },
    });
  }

  const savingsInput = numberInput(
    "savings",
    "Liquid savings",
    profile.get("liquidSavings"),
    (v) => profile.set("liquidSavings", v),
    500,
  );
  const essentialInput = numberInput(
    "essential",
    "Essential monthly expenses",
    profile.get("essentialMonthlyExpenses"),
    (v) => profile.set("essentialMonthlyExpenses", v),
    100,
  );
  const matchInput = numberInput(
    "match",
    "Employer match available per year",
    profile.get("employerMatchAnnual"),
    (v) => profile.set("employerMatchAnnual", v),
    100,
  );
  const matchGotInput = numberInput(
    "matchgot",
    "Employer match you're capturing per year",
    profile.get("employerMatchCaptured"),
    (v) => profile.set("employerMatchCaptured", v),
    100,
  );
  const retireInput = numberInput(
    "retire",
    "Annual tax-advantaged retirement contributions",
    profile.get("retirementContributionsAnnual"),
    (v) => profile.set("retirementContributionsAnnual", v),
    500,
  );

  const situationEditor = el(
    "div",
    { class: "tile-form plan-situation" },
    field("Liquid savings", savingsInput),
    field("Essential monthly expenses", essentialInput),
    field("Employer match available / yr", matchInput),
    field("Match you're capturing / yr", matchGotInput),
    field("Retirement contributions / yr", retireInput),
  );

  // --- Debts (shared with My Situation; drives the high-cost-debt step) ---
  const debtsContainer = el("div", { class: "plan-debts" });

  function currentDebts(): Debt[] {
    return profile.get("debts") ?? [];
  }
  function setDebts(debts: Debt[]): void {
    profile.set("debts", debts);
    renderPlan();
  }

  function renderDebts(): void {
    clear(debtsContainer);
    const debts = currentDebts();
    debts.forEach((debt, i) => {
      const name = el("input", {
        type: "text",
        value: debt.name,
        attrs: { "aria-label": `Debt ${i + 1} name` },
        on: {
          input: (e) => {
            debts[i] = { ...debt, name: (e.target as HTMLInputElement).value };
            profile.set("debts", debts);
            renderPlan();
          },
        },
      });
      const bal = el("input", {
        type: "number",
        min: 0,
        step: 100,
        value: debt.balance,
        attrs: { "aria-label": `Debt ${i + 1} balance`, inputmode: "decimal" },
        on: {
          input: (e) => {
            debts[i] = {
              ...debt,
              balance: parseNonNegative((e.target as HTMLInputElement).value, 0),
            };
            profile.set("debts", debts);
            renderPlan();
          },
        },
      });
      const rate = el("input", {
        type: "number",
        min: 0,
        step: 0.25,
        value: debt.ratePct,
        attrs: { "aria-label": `Debt ${i + 1} rate percent`, inputmode: "decimal" },
        on: {
          input: (e) => {
            debts[i] = {
              ...debt,
              ratePct: parseNonNegative((e.target as HTMLInputElement).value, 0),
            };
            profile.set("debts", debts);
            renderPlan();
          },
        },
      });
      const remove = el("button", {
        type: "button",
        class: "btn btn--ghost",
        text: "Remove",
        attrs: { "aria-label": `Remove debt ${i + 1}` },
        on: { click: () => setDebts(debts.filter((_, j) => j !== i)) },
      });
      debtsContainer.append(
        el(
          "div",
          { class: "plan-debt-row" },
          field(`Debt ${i + 1} name`, name),
          field("Balance", bal),
          field("Rate %", rate),
          remove,
        ),
      );
    });
    debtsContainer.append(
      el("button", {
        type: "button",
        class: "btn btn--ghost plan-add-debt",
        text: "+ Add a debt",
        on: {
          click: () => setDebts([...currentDebts(), { name: "Debt", balance: 0, ratePct: 0 }]),
        },
      }),
    );
  }

  // --- Adjustability controls (§4.2) ---
  const monthsInput = el("input", {
    type: "number",
    name: "m",
    min: 1,
    step: 1,
    value: config.rainyDayMonths,
    attrs: { "aria-label": "Rainy-day target in months" },
    on: {
      input: (e) => {
        config = {
          ...config,
          rainyDayMonths: Math.max(1, parseNonNegative((e.target as HTMLInputElement).value, 3)),
        };
        persistConfig();
        renderPlan();
      },
    },
  });
  const strategySelect = el(
    "select",
    {
      name: "ds",
      attrs: { "aria-label": "Debt payoff strategy" },
      on: {
        change: (e) => {
          config = {
            ...config,
            debtStrategy: (e.target as HTMLSelectElement).value as DebtStrategy,
          };
          persistConfig();
          renderPlan();
        },
      },
    },
    option("highest-rate", "Highest rate first", config.debtStrategy === "highest-rate"),
    option(
      "smallest-balance",
      "Smallest balance first",
      config.debtStrategy === "smallest-balance",
    ),
  );

  const adjustEditor = el(
    "div",
    { class: "tile-form plan-adjust" },
    field("Rainy-day target (months)", monthsInput),
    field("Debt payoff order", strategySelect),
  );

  const tryExample = tryExampleButton(() => {
    profile.set("liquidSavings", 2500);
    profile.set("essentialMonthlyExpenses", 3200);
    profile.set("employerMatchAnnual", 3000);
    profile.set("employerMatchCaptured", 3000);
    profile.set("retirementContributionsAnnual", 8000);
    profile.set("debts", [{ name: "Credit card", balance: 6000, ratePct: 23 }]);
    config = { ...DEFAULT_CONFIG, order: [...DEFAULT_ORDER] };
    persistConfig();
    savingsInput.value = "2500";
    essentialInput.value = "3200";
    matchInput.value = "3000";
    matchGotInput.value = "3000";
    retireInput.value = "8000";
    monthsInput.value = String(config.rainyDayMonths);
    strategySelect.value = config.debtStrategy;
    renderDebts();
    renderPlan();
  });

  const situationDetails = el(
    "details",
    { class: "plan-config" },
    el("summary", { text: "My Situation & plan settings" }),
    el("p", {
      class: "plan-config-note",
      text: "These live only in this session and are cleared when you leave. Open My Situation in the header to export a private copy.",
    }),
    situationEditor,
    el("h4", { class: "plan-subhead", text: "Debts" }),
    debtsContainer,
    el("h4", { class: "plan-subhead", text: "Adjust the plan" }),
    adjustEditor,
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(intro, planOutput, situationDetails);
  renderDebts();
  renderPlan();
}

export const yourPlanTile: TileDefinition = {
  id: "your-plan",
  title: "My Plan",
  pillar: "stand",
  description: "The deterministic next right step, with the math shown.",
  keywords: ["plan", "next step", "guidance", "guide", "baby steps", "order of operations"],
  status: "ready",
  how: "We read My Situation and walk a calm, ordered plan: a starter cushion, capturing the full employer match, clearing high-cost debt, a full rainy-day fund, tax-advantaged retirement, sinking funds for named goals, and finally building the war chest. The first step you haven't met yet is your next right step, shown with the exact dollar figure and the math.\n\nIt's opinionated by default but fully yours: reorder steps, change the rainy-day target, choose smallest-balance or highest-rate debt payoff, or turn steps off. The only statutory threshold (the retirement contribution limit) cites the IRS; the rest are clearly-labeled guidelines.",
  resources: [
    {
      label: "CFPB, financial tools & guides",
      url: "https://www.consumerfinance.gov/consumer-tools/",
    },
    { label: "Investor.gov, saving & investing basics", url: "https://www.investor.gov/" },
  ],
  mount: mountYourPlan,
};
