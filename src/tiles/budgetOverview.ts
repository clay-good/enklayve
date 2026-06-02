/**
 * Budget tile (BUILD-SPEC-2 §6.1): one simple screen for the whole idea of a
 * budget — give every dollar a job until nothing is left to assign. Enter your
 * monthly income, split it across the big buckets, and watch a donut and an
 * income → assigned → left flow bar update live. The goal is zero left to
 * assign (every dollar accounted for), never negative (over-assigned).
 *
 * It opens with the big buckets most households share so a first-timer starts
 * from a shape, not a blank page — then adds, renames, removes, and drags to
 * reorder. A short "why this sticks" note at the bottom spells out the anti-
 * budget idea: change the structure once, up front, instead of spending the
 * month fighting your own willpower. The day-by-day timing of bills lives in
 * its own Cash-Flow Timeline tile, so this one stays a single calm page.
 * Pure arithmetic on your own numbers; income defaults from My Situation.
 */
import { Money } from "../engine/money";
import { el, clear } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import { donutChart, flowBar, paletteVar } from "../ui/charts";
import type { SituationStore } from "../profile/situation";
import type { TileContext, TileDefinition } from "./types";

/** A budget line: a name and the monthly dollars given to it. */
interface Category {
  name: string;
  amount: number;
}

interface Fields {
  income: number;
  categories: Category[];
}

/** The big buckets most budgets share — the default starting shape (kept short
 *  so the page stays simple; the chips below add the rest in one tap). */
const DEFAULT_CATEGORIES = [
  "Housing",
  "Food & groceries",
  "Transportation",
  "Bills & insurance",
  "Saving & debt payoff",
  "Fun & personal",
];

/** Common buckets offered as one-tap chips (superset of the defaults). */
const COMMON_CATEGORIES = [
  ...DEFAULT_CATEGORIES,
  "Utilities",
  "Health",
  "Childcare",
  "Education",
  "Subscriptions",
  "Gifts & giving",
  "Pets",
  "Emergency fund",
  "Taxes",
];

/** A balanced worked example — every dollar of $5,000 has a job. */
const EXAMPLE: Fields = {
  income: 5000,
  categories: [
    { name: "Housing", amount: 1500 },
    { name: "Food & groceries", amount: 600 },
    { name: "Transportation", amount: 350 },
    { name: "Bills & insurance", amount: 450 },
    { name: "Saving & debt payoff", amount: 1500 },
    { name: "Fun & personal", amount: 600 },
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

/**
 * The anti-budget note: why assigning every dollar up front beats a month of
 * willpower. Lives at the bottom of the tile so the tool comes first and the
 * "why it works" is there for anyone who scrolls to it.
 */
function whyItSticks(): HTMLElement {
  const para = (text: string): HTMLElement => el("p", { class: "budget-why__p", text });
  return el(
    "section",
    { class: "budget-why" },
    el("h2", { class: "budget-why__title", text: "Why budgeting every dollar actually sticks" }),
    para(
      "This is the anti-budget. Most budgets fail because they run on willpower: you try to spend a little less in the moment, hundreds of moments a month, and willpower always runs out. Giving every dollar a job flips that. You make the decisions once, before the month starts, so by the time you are standing in the store the choice is already made and there is nothing left to resist.",
    ),
    para(
      "That is a change at the structural layer, not a motivational one. When the money is assigned up front — rent here, groceries here, savings moved the day you are paid — the default quietly does the work. You are not fighting yourself; you have changed the shape of the choice. Habits that live in the structure stay. Habits that lean on willpower fade by the third week.",
    ),
    para(
      "So give every dollar a job, saving and debt payoff included, until what is left to assign reaches exactly zero. A dollar without a job drifts away. A dollar with one tends to stay.",
    ),
  );
}

export function mountBudgetOverview(ctx: TileContext): void {
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
    const balanced = remaining.isZero() && !income.isZero();

    const status: BreakdownLine = balanced
      ? {
          label: "Status",
          value: "Every dollar has a job. That is the whole game, and you just nailed it. 🎉",
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
            value: `${fmt(remaining)} still needs a job. Send it to saving or your smallest debt before it wanders off.`,
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
    // A calm cue when the budget balances — the donut and status read as "done".
    chartContainer.classList.toggle("is-balanced", balanced);
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

  const intro = el("p", {
    class: "tile-intro__lead budget-lead",
    text: "A budget is just you telling every dollar where to go, instead of wondering where it went. Keep assigning until what is left to assign reaches zero.",
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Monthly income to assign", incomeInput),
    el("p", {
      class: "field-group-label",
      text: "Categories: set an amount, drag to reorder, or tap a chip to add one.",
    }),
    categoriesContainer,
    chipsContainer,
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(intro, form, chartContainer, resultContainer, whyItSticks());
  renderCategories();
  compute();
}

export const budgetOverviewTile: TileDefinition = {
  id: "budget-overview",
  title: "Budget Overview",
  pillar: "budget",
  description: "Give every dollar a job until nothing's left to assign.",
  keywords: [
    "budget",
    "budget overview",
    "zero based budget",
    "zero-based budget",
    "every dollar",
    "give every dollar a job",
    "you need a budget",
    "anti-budget",
    "envelope",
    "categories",
    "donut",
    "cash flow",
  ],
  status: "ready",
  how: "A budget is just you telling your money where to go instead of wondering where it went. Enter your monthly income and split it across categories: housing, food, investing, paying off debt, and the rest. Every category is a job for some of your income. We open with the big buckets most budgets share so you start from a shape, not a blank page. Adjust the amounts, add or remove categories, drag to reorder, and watch the donut and the income-to-assigned flow bar update live.\n\nThe goal is a zero-based budget: keep assigning until what is left to assign reaches exactly zero, because every dollar without a job tends to disappear. Saving and debt payoff are jobs too, so an emergency fund and your smallest debt belong right there in the list. This is the anti-budget — you make the decisions once, up front, instead of spending the whole month resisting in the moment. Change the structure and the habit stays; lean on willpower and it fades.\n\nIt pairs with the 50/30/20 plan for the big-picture split, the Cash-Flow Timeline to see when bills land across the month, and the Debt Freedom planner to aim your payoff. Income defaults from My Situation if you've entered it.",
  resources: [
    {
      label: "CFPB, making a budget",
      url: "https://www.consumerfinance.gov/about-us/blog/budgeting-how-to-create-a-budget-and-stick-with-it/",
    },
  ],
  mount: mountBudgetOverview,
};
