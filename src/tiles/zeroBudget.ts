/**
 * Zero-Based Budget tile (BUILD-SPEC-2 §6.1): give every dollar a job. Enter your
 * monthly income, assign it across categories, and we show what's left to assign
 * — the goal is zero (every dollar accounted for), never negative (over-assigned).
 * Pure arithmetic on your own numbers; income defaults from My Situation.
 */
import { Money } from "../engine/money";
import { el, clear } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
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

const EXAMPLE: Fields = {
  income: 5000,
  categories: [
    { name: "Rent", amount: 1600 },
    { name: "Groceries", amount: 600 },
    { name: "Transport", amount: 300 },
    { name: "Utilities", amount: 250 },
    { name: "Insurance", amount: 200 },
    { name: "Savings", amount: 1000 },
    { name: "Debt payoff", amount: 350 },
    { name: "Fun", amount: 400 },
    { name: "Misc", amount: 300 },
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
  if (fields.categories.length === 0)
    fields = { ...fields, categories: [{ name: "Rent", amount: 0 }] };

  const incomeInput = el("input", {
    type: "number",
    name: "inc",
    min: 0,
    step: 100,
    value: fields.income,
    attrs: { "aria-label": "Monthly income to assign", inputmode: "decimal" },
  });

  const categoriesContainer = el("div", { class: "plan-debts" });
  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

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
      ? { label: "Status", value: "Balanced — every dollar has a job. 🎉", emphasis: true }
      : remaining.isNegative()
        ? {
            label: "Status",
            value: `Over-assigned by ${fmt(remaining.abs())}. Trim a category to balance.`,
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

  function renderCategories(): void {
    clear(categoriesContainer);
    fields.categories.forEach((cat, i) => {
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
      categoriesContainer.append(
        el(
          "div",
          { class: "plan-debt-row" },
          field(`Category ${i + 1}`, name),
          field("Amount", amount),
          remove,
        ),
      );
    });
    categoriesContainer.append(
      el("button", {
        type: "button",
        class: "btn btn--ghost plan-add-debt",
        text: "+ Add a category",
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
    el("p", { class: "field-group-label", text: "Categories" }),
    categoriesContainer,
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  renderCategories();
  compute();
}

export const zeroBudgetTile: TileDefinition = {
  id: "zero-budget",
  title: "Zero-Based Budget",
  pillar: "take-home",
  description: "Give every dollar a job until nothing's left to assign.",
  keywords: ["zero based budget", "budget", "every dollar", "envelope", "cash flow", "categories"],
  status: "ready",
  how: "A zero-based budget assigns every dollar of your monthly income to a category, savings and debt payoff included, until what's left to assign is exactly zero. We add up your categories and show the remainder: assign it (don't leave it floating), and never go below zero (that means you've assigned money you don't have).\n\nIt pairs with the 50/30/20 plan: use that for the big-picture split, this to name the actual jobs. Income defaults from My Situation if you've entered it.",
  resources: [
    {
      label: "CFPB, making a budget",
      url: "https://www.consumerfinance.gov/about-us/blog/budgeting-how-to-create-a-budget-and-stick-with-it/",
    },
  ],
  mount: mountZeroBudget,
};
