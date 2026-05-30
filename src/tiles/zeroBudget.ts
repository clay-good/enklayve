/**
 * Zero-Based Budget tile (BUILD-SPEC-2 §6.1): give every dollar a job. Enter your
 * monthly income, assign it across categories, and we show what's left to assign
 * — the goal is zero (every dollar accounted for), never negative (over-assigned).
 * Pure arithmetic on your own numbers; income defaults from My Situation.
 *
 * It opens with the big budget buckets most households share (housing, transport,
 * groceries, investing, taxes…) so a first-timer starts from a shape, not a blank
 * row — then adds, renames, removes, and drags to reorder. A donut shows where the
 * money goes and a flow bar shows income → assigned → left.
 */
import { Money } from "../engine/money";
import { el, clear } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import { donutChart, flowBar, paletteVar } from "../ui/charts";
import type { SituationStore } from "../profile/situation";
import type { TileContext, TileDefinition } from "./types";

interface Category {
  name: string;
  amount: number;
}

interface Fields {
  income: number;
  categories: Category[];
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
  categories: [
    { name: "Housing", amount: 1600 },
    { name: "Groceries", amount: 600 },
    { name: "Transportation", amount: 300 },
    { name: "Utilities", amount: 250 },
    { name: "Insurance", amount: 200 },
    { name: "Investing & savings", amount: 1000 },
    { name: "Debt payments", amount: 350 },
    { name: "Fun & personal", amount: 400 },
    { name: "Taxes", amount: 300 },
  ],
};

function readFields(p: URLSearchParams, profile: SituationStore): Fields {
  const annual = profile.get("annualIncome");
  const incomeDefault = annual !== undefined ? Math.round(annual / 12) : 0;
  const count = Math.max(0, Math.round(parseNonNegative(p.get("k"), 0)));
  const categories: Category[] = [];
  for (let i = 0; i < count; i++) {
    categories.push({
      name: p.get(`c${i}`) ?? `Category ${i + 1}`,
      amount: parseNonNegative(p.get(`a${i}`), 0),
    });
  }
  return {
    income: p.has("inc") ? parseNonNegative(p.get("inc"), 0) : incomeDefault,
    categories,
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("inc", String(f.income));
  p.set("k", String(f.categories.length));
  f.categories.forEach((c, i) => {
    p.set(`c${i}`, c.name);
    p.set(`a${i}`, String(c.amount));
  });
  return p;
}

export function mountZeroBudget(ctx: TileContext): void {
  const { root, profile } = ctx;
  root.replaceChildren();
  let fields = readFields(ctx.params, profile);
  // No saved categories → open with the big default buckets (amounts at zero),
  // so a first-time user starts from a recognizable shape and fills it in.
  if (fields.categories.length === 0) {
    fields = { ...fields, categories: DEFAULT_CATEGORIES.map((name) => ({ name, amount: 0 })) };
  }

  const incomeInput = el("input", {
    type: "number",
    name: "inc",
    min: 0,
    step: 100,
    value: fields.income,
    attrs: { "aria-label": "Monthly income to assign", inputmode: "decimal" },
  });

  const chipsContainer = el("div", { class: "cat-chips" });
  const categoriesContainer = el("div", { class: "plan-debts" });
  const chartContainer = el("div", { class: "tile-charts" });
  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  /** Reorder the categories array and re-render (shared by drag and ▲/▼). */
  function move(from: number, to: number): void {
    if (to < 0 || to >= fields.categories.length || from === to) return;
    const next = [...fields.categories];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    fields.categories = next;
    persist();
    renderCategories();
    compute();
  }

  function persist(): void {
    ctx.setParams(writeFields(fields));
  }

  function compute(): void {
    const income = Money.from(fields.income);
    const assigned = fields.categories.reduce(
      (sum, c) => sum.add(Math.max(0, c.amount)),
      Money.zero(),
    );
    const remaining = income.subtract(assigned);
    const fmt = (m: Money): string => m.format(ctx.locale);

    const status: BreakdownLine = remaining.isZero()
      ? {
          label: "Status",
          value: "Balanced. Every dollar has a job, and that is the whole game. 🎉",
          emphasis: true,
        }
      : remaining.isNegative()
        ? {
            label: "Status",
            value: `Over-assigned by ${fmt(remaining.abs())}. Trim a category until you are back to zero.`,
            emphasis: true,
          }
        : {
            label: "Status",
            value: `${fmt(remaining)} still needs a job. Saving and debt payoff count, so do not leave it floating.`,
            emphasis: true,
          };

    const lines: BreakdownLine[] = [
      { label: "Monthly income", value: fmt(income) },
      { label: "Total assigned", value: fmt(assigned) },
      { label: "Left to assign", value: fmt(remaining) },
      status,
    ];

    renderCharts(income, remaining);

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

  function renderCharts(income: Money, remaining: Money): void {
    clear(chartContainer);
    const funded = fields.categories
      .map((c, i) => ({ label: c.name || `Category ${i + 1}`, value: Math.max(0, c.amount) }))
      .filter((s) => s.value > 0);
    // Nothing assigned yet → skip the picture (the form already invites input).
    if (funded.length === 0 && remaining.isZero()) return;

    const leftover = remaining.isNegative() ? 0 : remaining.toNumber();
    const donutSlices = [...funded];
    if (leftover > 0) {
      donutSlices.push({ label: "Left to assign", value: leftover });
    }
    chartContainer.append(
      donutChart({
        slices: donutSlices.map((s, i) =>
          s.label === "Left to assign"
            ? { ...s, color: "var(--enk-accent)" }
            : { ...s, color: paletteVar(i) },
        ),
        locale: ctx.locale,
        ariaLabel: "How your monthly income is assigned across categories",
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

  function categoryRow(cat: Category, i: number): HTMLElement {
    const name = el("input", {
      type: "text",
      value: cat.name,
      attrs: { "aria-label": `Category ${i + 1} name` },
      on: {
        input: (e) => {
          fields.categories[i] = { ...cat, name: (e.target as HTMLInputElement).value };
          persist();
          compute();
        },
      },
    });
    const amount = el("input", {
      type: "number",
      min: 0,
      step: 50,
      value: cat.amount,
      attrs: { "aria-label": `Category ${i + 1} amount`, inputmode: "decimal" },
      on: {
        input: (e) => {
          fields.categories[i] = {
            ...fields.categories[i]!,
            amount: parseNonNegative((e.target as HTMLInputElement).value, 0),
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
      attrs: { "aria-label": `Remove category ${i + 1}` },
      on: {
        click: () => {
          fields.categories = fields.categories.filter((_, j) => j !== i);
          persist();
          renderCategories();
          compute();
        },
      },
    });
    // Keyboard-accessible reorder (the screen-reader/keyboard path; native drag
    // below is the pointer path and isn't reachable without a mouse).
    const moves = el(
      "span",
      { class: "row-moves" },
      el("button", {
        type: "button",
        class: "row-move",
        text: "▲",
        attrs: { "aria-label": `Move ${cat.name || `category ${i + 1}`} up` },
        disabled: i === 0,
        on: { click: () => move(i, i - 1) },
      }),
      el("button", {
        type: "button",
        class: "row-move",
        text: "▼",
        attrs: { "aria-label": `Move ${cat.name || `category ${i + 1}`} down` },
        disabled: i === fields.categories.length - 1,
        on: { click: () => move(i, i + 1) },
      }),
    );
    const handle = el("button", {
      type: "button",
      class: "drag-handle",
      text: "⠿",
      attrs: { "aria-hidden": "true", tabindex: "-1", title: "Drag to reorder" },
    });

    const row = el(
      "div",
      {
        class: "plan-debt-row",
        attrs: { draggable: "true" },
        on: {
          dragstart: (e) => {
            (e as DragEvent).dataTransfer?.setData("text/plain", String(i));
            if ((e as DragEvent).dataTransfer)
              (e as DragEvent).dataTransfer!.effectAllowed = "move";
            row.classList.add("is-dragging");
          },
          dragend: () => {
            row.classList.remove("is-dragging");
            categoriesContainer
              .querySelectorAll(".drop-target")
              .forEach((n) => n.classList.remove("drop-target"));
          },
          dragover: (e) => {
            e.preventDefault();
            if ((e as DragEvent).dataTransfer) (e as DragEvent).dataTransfer!.dropEffect = "move";
            row.classList.add("drop-target");
          },
          dragleave: () => row.classList.remove("drop-target"),
          drop: (e) => {
            e.preventDefault();
            row.classList.remove("drop-target");
            const from = Number((e as DragEvent).dataTransfer?.getData("text/plain"));
            if (Number.isInteger(from)) move(from, i);
          },
        },
      },
      handle,
      moves,
      field(`Category ${i + 1}`, name),
      field("Amount", amount),
      remove,
    );
    return row;
  }

  function renderChips(): void {
    clear(chipsContainer);
    const present = new Set(fields.categories.map((c) => c.name.trim().toLowerCase()));
    const available = COMMON_CATEGORIES.filter((c) => !present.has(c.toLowerCase()));
    for (const name of available) {
      chipsContainer.append(
        el("button", {
          type: "button",
          class: "cat-chip",
          text: `+ ${name}`,
          attrs: { "aria-label": `Add ${name} category` },
          on: {
            click: () => {
              fields.categories = [...fields.categories, { name, amount: 0 }];
              persist();
              renderCategories();
              compute();
            },
          },
        }),
      );
    }
  }

  function renderCategories(): void {
    clear(categoriesContainer);
    fields.categories.forEach((cat, i) => categoriesContainer.append(categoryRow(cat, i)));
    categoriesContainer.append(
      el("button", {
        type: "button",
        class: "btn btn--ghost plan-add-debt",
        text: "+ Add a custom category",
        on: {
          click: () => {
            fields.categories = [...fields.categories, { name: "Category", amount: 0 }];
            persist();
            renderCategories();
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

  const tryExample = tryExampleButton(() => {
    fields = { income: EXAMPLE.income, categories: EXAMPLE.categories.map((c) => ({ ...c })) };
    incomeInput.value = String(fields.income);
    persist();
    renderCategories();
    compute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Monthly income to assign", incomeInput),
    el("p", {
      class: "field-group-label",
      text: "Categories: drag to reorder, or tap a chip to add one.",
    }),
    categoriesContainer,
    chipsContainer,
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, chartContainer, resultContainer);
  renderCategories();
  compute();
}

export const zeroBudgetTile: TileDefinition = {
  id: "zero-budget",
  title: "Zero-Based Budget",
  pillar: "budget",
  description: "Give every dollar a job until nothing's left to assign.",
  keywords: ["zero based budget", "budget", "every dollar", "envelope", "cash flow", "categories"],
  status: "ready",
  how: "A zero-based budget gives every dollar of your monthly income a job, savings and debt payoff included, until what's left to assign is exactly zero. That is the whole idea: tell your money where to go instead of wondering where it went. We open with the big buckets most budgets share, housing, transport, groceries, investing, taxes, and the rest, so you start from a shape, not a blank page. Adjust the amounts, add or remove categories, drag to reorder, and watch the donut and the income-to-spent flow bar update live.\n\nWe add up your categories and show the remainder: assign it, because a dollar without a job tends to disappear, and never go below zero, which would mean you have assigned money you don't have. It pairs with the 50/30/20 plan: use that for the big-picture split, and this to name the actual jobs. Income defaults from My Situation if you've entered it.",
  resources: [
    {
      label: "CFPB, making a budget",
      url: "https://www.consumerfinance.gov/about-us/blog/budgeting-how-to-create-a-budget-and-stick-with-it/",
    },
  ],
  mount: mountZeroBudget,
};
