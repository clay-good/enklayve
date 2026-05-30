/**
 * Budget Overview tile (BUILD-SPEC-2 §6.1): one holistic view of a month's money.
 * It folds the two halves of budgeting into a single screen — *where* the money
 * goes (the zero-based allocation, as a donut and an income → assigned → left flow
 * bar) and *when* it moves (the cash-flow timeline, a running balance day by day).
 *
 * One list of budget lines feeds both pictures: every line's amount counts toward
 * the allocation, and a line that also carries a day-of-month lands on the timeline
 * as a dated bill. Income arrives on a payday. So a first-timer sees the big-buckets
 * shape immediately, and adds a due date to the lines that have one to spot the
 * tight days. Pure arithmetic on your own numbers; income defaults from My Situation.
 */
import { Money } from "../engine/money";
import { cashFlowTimeline, type CashFlowEvent } from "../engine/finance";
import { el, clear } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import { donutChart, flowBar, balanceTimeline, paletteVar } from "../ui/charts";
import type { SituationStore } from "../profile/situation";
import type { TileContext, TileDefinition } from "./types";

/** A budget line: a monthly amount, and an optional day it lands on the timeline. */
interface Line {
  name: string;
  amount: number;
  /** Day of the month (1–31) it's due, or 0 when it's allocation-only (undated). */
  day: number;
}

interface Fields {
  income: number;
  /** Day of the month income lands (drives the timeline's paycheck). */
  payday: number;
  startingBalance: number;
  lines: Line[];
}

/** The big buckets most budgets share — the default starting shape. */
const DEFAULT_CATEGORIES = [
  "Housing",
  "Transportation",
  "Groceries",
  "Utilities",
  "Insurance",
  "Health",
  "Debt payments",
  "Investing & savings",
  "Taxes",
  "Fun & personal",
];

/** Common buckets offered as one-tap chips (superset of the defaults). */
const COMMON_CATEGORIES = [
  ...DEFAULT_CATEGORIES,
  "Childcare",
  "Education",
  "Subscriptions",
  "Gifts & giving",
  "Pets",
  "Emergency fund",
];

const EXAMPLE: Fields = {
  income: 5000,
  payday: 1,
  startingBalance: 800,
  lines: [
    { name: "Housing", amount: 1600, day: 1 },
    { name: "Groceries", amount: 600, day: 8 },
    { name: "Transportation", amount: 300, day: 12 },
    { name: "Utilities", amount: 250, day: 12 },
    { name: "Insurance", amount: 200, day: 5 },
    { name: "Investing & savings", amount: 1000, day: 3 },
    { name: "Debt payments", amount: 350, day: 22 },
    { name: "Fun & personal", amount: 400, day: 0 },
    { name: "Taxes", amount: 300, day: 0 },
  ],
};

function clampDay(n: number): number {
  return Math.max(0, Math.min(31, Math.round(n)));
}

function readFields(p: URLSearchParams, profile: SituationStore): Fields {
  const annual = profile.get("annualIncome");
  const incomeDefault = annual !== undefined ? Math.round(annual / 12) : 0;
  const count = Math.max(0, Math.round(parseNonNegative(p.get("k"), 0)));
  const lines: Line[] = [];
  for (let i = 0; i < count; i++) {
    lines.push({
      name: p.get(`c${i}`) ?? `Line ${i + 1}`,
      amount: parseNonNegative(p.get(`a${i}`), 0),
      day: clampDay(parseNonNegative(p.get(`d${i}`), 0)),
    });
  }
  return {
    income: p.has("inc") ? parseNonNegative(p.get("inc"), 0) : incomeDefault,
    payday: Math.max(1, clampDay(parseNonNegative(p.get("pay"), 1))),
    startingBalance: parseNonNegative(p.get("sb"), 0),
    lines,
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("inc", String(f.income));
  p.set("pay", String(f.payday));
  p.set("sb", String(f.startingBalance));
  p.set("k", String(f.lines.length));
  f.lines.forEach((l, i) => {
    p.set(`c${i}`, l.name);
    p.set(`a${i}`, String(l.amount));
    p.set(`d${i}`, String(l.day));
  });
  return p;
}

/** Dated lines become bills; income lands as a paycheck on payday. */
function toEngineEvents(f: Fields): CashFlowEvent[] {
  const events: CashFlowEvent[] = [];
  if (f.income > 0) events.push({ day: f.payday, amount: f.income, label: "Income" });
  for (const l of f.lines) {
    if (l.day >= 1 && l.amount > 0) {
      events.push({ day: l.day, amount: -Math.max(0, l.amount), label: l.name });
    }
  }
  return events;
}

export function mountBudgetOverview(ctx: TileContext): void {
  const { root, profile } = ctx;
  root.replaceChildren();
  let fields = readFields(ctx.params, profile);
  // No saved lines → open with the big default buckets (amounts at zero, undated),
  // so a first-time user starts from a recognizable shape and fills it in.
  if (fields.lines.length === 0) {
    fields = {
      ...fields,
      lines: DEFAULT_CATEGORIES.map((name) => ({ name, amount: 0, day: 0 })),
    };
  }

  const incomeInput = el("input", {
    type: "number",
    name: "inc",
    min: 0,
    step: 100,
    value: fields.income,
    attrs: { "aria-label": "Monthly income to assign", inputmode: "decimal" },
  });
  const paydayInput = el("input", {
    type: "number",
    name: "pay",
    min: 1,
    max: 31,
    step: 1,
    value: fields.payday,
    attrs: { "aria-label": "Day of the month income lands", inputmode: "numeric" },
  });
  const startInput = el("input", {
    type: "number",
    name: "sb",
    min: 0,
    step: 100,
    value: fields.startingBalance,
    attrs: { "aria-label": "Starting balance", inputmode: "decimal" },
  });

  const chipsContainer = el("div", { class: "cat-chips" });
  const linesContainer = el("div", { class: "plan-debts" });
  const chartContainer = el("div", { class: "tile-charts" });
  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function persist(): void {
    ctx.setParams(writeFields(fields));
  }

  function compute(): void {
    const income = Money.from(fields.income);
    const assigned = fields.lines.reduce((sum, l) => sum.add(Math.max(0, l.amount)), Money.zero());
    const remaining = income.subtract(assigned);
    const fmt = (m: Money): string => m.format(ctx.locale);

    const status: BreakdownLine = remaining.isZero()
      ? { label: "Status", value: "Balanced — every dollar has a job. 🎉", emphasis: true }
      : remaining.isNegative()
        ? {
            label: "Status",
            value: `Over-assigned by ${fmt(remaining.abs())}. Trim a line to balance.`,
            emphasis: true,
          }
        : {
            label: "Status",
            value: `${fmt(remaining)} still to assign. Give it a job, even saving counts.`,
            emphasis: true,
          };

    const lines: BreakdownLine[] = [
      { label: "Monthly income", value: fmt(income) },
      { label: "Total assigned", value: fmt(assigned) },
      { label: "Left to assign", value: fmt(remaining) },
      status,
    ];

    // The cash-flow layer: walk the month if any line carries a due date.
    const flow = cashFlowTimeline(fields.startingBalance, toEngineEvents(fields));
    const dated = fields.lines.some((l) => l.day >= 1 && l.amount > 0);
    if (dated) {
      lines.push(
        { label: "Lowest balance this month", value: fmt(flow.minBalance) },
        flow.goesNegative
          ? {
              label: "Heads up",
              value: `Your balance dips below zero on day ${flow.minDay}. A buffer or a shifted due date helps.`,
              emphasis: true,
            }
          : {
              label: "Tightest day",
              value:
                flow.minDay === 0
                  ? "Your balance never falls below where it started."
                  : `Day ${flow.minDay}, at ${fmt(flow.minBalance)} — still above zero.`,
            },
      );
    }

    renderCharts(income, remaining, flow, dated);

    resultContainer.replaceChildren(
      resultCard({
        label: "Left to assign",
        value: remaining,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function renderCharts(
    income: Money,
    remaining: Money,
    flow: ReturnType<typeof cashFlowTimeline>,
    dated: boolean,
  ): void {
    clear(chartContainer);
    const funded = fields.lines
      .map((l, i) => ({ label: l.name || `Line ${i + 1}`, value: Math.max(0, l.amount) }))
      .filter((s) => s.value > 0);

    // Allocation pictures: donut (where it goes) + flow bar (income → assigned → left).
    if (funded.length > 0 || !remaining.isZero()) {
      const leftover = remaining.isNegative() ? 0 : remaining.toNumber();
      const donutSlices = [...funded];
      if (leftover > 0) donutSlices.push({ label: "Left to assign", value: leftover });
      chartContainer.append(
        donutChart({
          slices: donutSlices.map((s, i) =>
            s.label === "Left to assign"
              ? { ...s, color: "var(--enk-accent)" }
              : { ...s, color: paletteVar(i) },
          ),
          locale: ctx.locale,
          ariaLabel: "How your monthly income is assigned across budget lines",
          centerValue: income.format(ctx.locale),
          centerLabel: "income",
        }),
        flowBar({
          segments: funded.map((s, i) => ({ ...s, color: paletteVar(i) })),
          total: income.toNumber(),
          remainder:
            leftover > 0
              ? { label: "Left to assign", value: leftover, color: "var(--enk-accent)" }
              : undefined,
          locale: ctx.locale,
          showLegend: false,
          ariaLabel: "Your monthly cash flow: income, what you have assigned, and what is left",
        }),
      );
    }

    // Timeline picture: only when at least one line is dated, else it's just a bump.
    if (dated && flow.days.length > 0) {
      chartContainer.append(
        balanceTimeline({
          points: flow.days.map((d) => ({ day: d.day, balance: d.balance })),
          minDay: flow.minDay,
          goesNegative: flow.goesNegative,
          locale: ctx.locale,
          ariaLabel: flow.goesNegative
            ? `Running balance through the month, dipping to its lowest on day ${flow.minDay}`
            : "Running balance through the month",
        }),
      );
    } else if (!dated && funded.length > 0) {
      chartContainer.append(
        el("p", {
          class: "field-group-label",
          text: "Add a due day to any line to see your month's cash-flow timeline.",
        }),
      );
    }
  }

  function lineRow(line: Line, i: number): HTMLElement {
    const name = el("input", {
      type: "text",
      value: line.name,
      attrs: { "aria-label": `Line ${i + 1} name` },
      on: {
        input: (e) => {
          fields.lines[i] = { ...line, name: (e.target as HTMLInputElement).value };
          persist();
          compute();
        },
      },
    });
    const amount = el("input", {
      type: "number",
      min: 0,
      step: 50,
      value: line.amount,
      attrs: { "aria-label": `Line ${i + 1} amount`, inputmode: "decimal" },
      on: {
        input: (e) => {
          fields.lines[i] = {
            ...fields.lines[i]!,
            amount: parseNonNegative((e.target as HTMLInputElement).value, 0),
          };
          persist();
          compute();
        },
      },
    });
    const day = el("input", {
      type: "number",
      min: 0,
      max: 31,
      step: 1,
      value: line.day || "",
      placeholder: "—",
      attrs: { "aria-label": `Line ${i + 1} due day of month (optional)`, inputmode: "numeric" },
      on: {
        input: (e) => {
          fields.lines[i] = {
            ...fields.lines[i]!,
            day: clampDay(parseNonNegative((e.target as HTMLInputElement).value, 0)),
          };
          persist();
          compute();
        },
      },
    });
    const remove = el("button", {
      type: "button",
      class: "btn btn--ghost",
      text: "Remove",
      attrs: { "aria-label": `Remove line ${i + 1}` },
      on: {
        click: () => {
          fields.lines = fields.lines.filter((_, j) => j !== i);
          persist();
          renderLines();
          compute();
        },
      },
    });
    return el(
      "div",
      { class: "plan-debt-row" },
      field(`Line ${i + 1}`, name),
      field("Amount", amount),
      field("Due day", day),
      remove,
    );
  }

  function renderChips(): void {
    clear(chipsContainer);
    const present = new Set(fields.lines.map((l) => l.name.trim().toLowerCase()));
    const available = COMMON_CATEGORIES.filter((c) => !present.has(c.toLowerCase()));
    for (const name of available) {
      chipsContainer.append(
        el("button", {
          type: "button",
          class: "cat-chip",
          text: `+ ${name}`,
          attrs: { "aria-label": `Add ${name} line` },
          on: {
            click: () => {
              fields.lines = [...fields.lines, { name, amount: 0, day: 0 }];
              persist();
              renderLines();
              compute();
            },
          },
        }),
      );
    }
  }

  function renderLines(): void {
    clear(linesContainer);
    fields.lines.forEach((line, i) => linesContainer.append(lineRow(line, i)));
    linesContainer.append(
      el("button", {
        type: "button",
        class: "btn btn--ghost plan-add-debt",
        text: "+ Add a custom line",
        on: {
          click: () => {
            fields.lines = [...fields.lines, { name: "Line", amount: 0, day: 0 }];
            persist();
            renderLines();
            compute();
          },
        },
      }),
    );
    renderChips();
  }

  incomeInput.addEventListener("input", () => {
    fields.income = parseNonNegative(incomeInput.value, 0);
    persist();
    compute();
  });
  paydayInput.addEventListener("input", () => {
    fields.payday = Math.max(1, clampDay(parseNonNegative(paydayInput.value, 1)));
    persist();
    compute();
  });
  startInput.addEventListener("input", () => {
    fields.startingBalance = parseNonNegative(startInput.value, 0);
    persist();
    compute();
  });

  const tryExample = tryExampleButton(() => {
    fields = {
      income: EXAMPLE.income,
      payday: EXAMPLE.payday,
      startingBalance: EXAMPLE.startingBalance,
      lines: EXAMPLE.lines.map((l) => ({ ...l })),
    };
    incomeInput.value = String(fields.income);
    paydayInput.value = String(fields.payday);
    startInput.value = String(fields.startingBalance);
    persist();
    renderLines();
    compute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Monthly income to assign", incomeInput),
    field("Income lands on day", paydayInput),
    field("Starting balance", startInput),
    el("p", {
      class: "field-group-label",
      text: "Budget lines — set an amount, add a due day to put it on the month timeline, tap a chip to add",
    }),
    linesContainer,
    chipsContainer,
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, chartContainer, resultContainer);
  renderLines();
  compute();
}

export const budgetOverviewTile: TileDefinition = {
  id: "budget-overview",
  title: "Budget Overview",
  pillar: "budget",
  description: "One view of where your money goes and how the month flows.",
  keywords: [
    "budget overview",
    "holistic budget",
    "dashboard",
    "cash flow",
    "zero based budget",
    "donut",
    "every dollar",
    "income",
  ],
  status: "ready",
  how: "This is the whole month on one screen. Enter your monthly income and the day it lands, your starting balance, and your budget lines. Each line is a job for some of your income — housing, groceries, investing, and the rest — and we open with the big buckets most budgets share so you start from a shape, not a blank page.\n\nThe donut and the income-to-assigned flow bar show where the money goes and how much is still left to assign (the goal is zero — every dollar accounted for). Add a due day to any line and it also lands on the cash-flow timeline, which walks your balance day by day to surface the tightest point, the classic squeeze when a big bill is due before payday. So you get both halves of budgeting at once: the allocation and the timing. It pairs with the 50/30/20 plan for the big-picture split. Income defaults from My Situation if you've entered it.",
  resources: [
    {
      label: "CFPB, making a budget",
      url: "https://www.consumerfinance.gov/about-us/blog/budgeting-how-to-create-a-budget-and-stick-with-it/",
    },
  ],
  mount: mountBudgetOverview,
};
