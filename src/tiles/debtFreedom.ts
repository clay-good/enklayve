/**
 * Debt Freedom Planner tile (BUILD-SPEC-2 §6.2): the classic debt snowball, made
 * fair and adjustable. List your debts, set the extra you can throw at them each
 * month beyond the minimums, and compare the two orders side by side: the
 * snowball (smallest balance first, for quick wins and momentum) and the
 * avalanche (highest rate first, the mathematically cheapest). Both run the same
 * monthly budget and roll each cleared debt's payment onto the next, so you see
 * the freedom date and the interest each path costs, and exactly what choosing
 * momentum over math costs you. Pure arithmetic on the golden-tested
 * {@link debtFreedomPlan} engine; debts default from My Situation.
 */
import { Money } from "../engine/money";
import { debtFreedomPlan, type DebtMethod, type PlannedDebt } from "../engine/finance";
import { el, clear } from "../ui/dom";
import { field, parseNonNegative, parseNumber, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import { donutChart, statStrip, paletteVar, type Stat } from "../ui/charts";
import type { SituationStore } from "../profile/situation";
import type { TileContext, TileDefinition } from "./types";

interface Fields {
  debts: PlannedDebt[];
  /** Extra paid each month beyond the sum of the minimums. */
  extra: number;
  /** Which order the user is leaning toward (both are always shown). */
  method: DebtMethod;
}

const EXAMPLE: Fields = {
  debts: [
    { name: "Store card", balance: 800, ratePct: 24.99, minPayment: 25 },
    { name: "Credit card", balance: 4500, ratePct: 19.99, minPayment: 90 },
    { name: "Car loan", balance: 12000, ratePct: 6.5, minPayment: 280 },
  ],
  extra: 300,
  method: "snowball",
};

/** A sensible starting minimum when we only know a balance: ~2%, never under $25. */
function defaultMin(balance: number): number {
  return Math.max(25, Math.round((balance * 0.02) / 5) * 5);
}

function readMethod(v: string | null): DebtMethod {
  return v === "avalanche" ? "avalanche" : "snowball";
}

function readFields(p: URLSearchParams, profile: SituationStore): Fields {
  const method = readMethod(p.get("meth"));
  const extra = parseNonNegative(p.get("x"), 0);
  if (p.has("k")) {
    const count = Math.max(0, Math.round(parseNonNegative(p.get("k"), 0)));
    const debts: PlannedDebt[] = [];
    for (let i = 0; i < count; i++) {
      debts.push({
        name: p.get(`c${i}`) ?? `Debt ${i + 1}`,
        balance: parseNonNegative(p.get(`b${i}`), 0),
        ratePct: parseNumber(p.get(`r${i}`), 0),
        minPayment: parseNonNegative(p.get(`m${i}`), 0),
      });
    }
    return { debts, extra, method };
  }
  // No URL state: seed from My Situation's debts, else two blank rows to fill.
  const fromProfile = (profile.get("debts") ?? []).map((d) => ({
    name: d.name,
    balance: d.balance,
    ratePct: d.ratePct,
    minPayment: defaultMin(d.balance),
  }));
  const debts =
    fromProfile.length > 0
      ? fromProfile
      : [
          { name: "Debt 1", balance: 0, ratePct: 0, minPayment: 0 },
          { name: "Debt 2", balance: 0, ratePct: 0, minPayment: 0 },
        ];
  return { debts, extra, method };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("k", String(f.debts.length));
  f.debts.forEach((d, i) => {
    p.set(`c${i}`, d.name);
    p.set(`b${i}`, String(d.balance));
    p.set(`r${i}`, String(d.ratePct));
    p.set(`m${i}`, String(d.minPayment));
  });
  p.set("x", String(f.extra));
  p.set("meth", f.method);
  return p;
}

/** A calendar label for a number of whole months ahead (e.g. "March 2027"). */
function freedomDateLabel(monthsAhead: number, locale: string): string {
  const d = new Date();
  d.setMonth(d.getMonth() + monthsAhead);
  return d.toLocaleDateString(locale, { month: "long", year: "numeric" });
}

function monthsLabel(months: number): string {
  if (months < 12) return `${months} month${months === 1 ? "" : "s"}`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  const y = `${years} year${years === 1 ? "" : "s"}`;
  return rem === 0 ? y : `${y}, ${rem} mo`;
}

export function mountDebtFreedom(ctx: TileContext): void {
  const { root, profile } = ctx;
  root.replaceChildren();
  let fields = readFields(ctx.params, profile);

  const debtsContainer = el("div", { class: "plan-debts" });
  const methodContainer = el("div", { class: "tile-form-actions" });
  const statContainer = el("div", { class: "tile-stats", attrs: { "aria-live": "polite" } });
  const compareContainer = el("div", {});
  const chartContainer = el("div", { class: "tile-charts" });
  const orderContainer = el("div", {});
  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  const extraInput = el("input", {
    type: "number",
    name: "x",
    min: 0,
    step: 25,
    value: fields.extra,
    attrs: { "aria-label": "Extra paid each month beyond the minimums", inputmode: "decimal" },
  });

  function persist(): void {
    ctx.setParams(writeFields(fields));
  }

  function compute(): void {
    const fmt = (m: Money): string => m.format(ctx.locale);
    const active = fields.debts.filter((d) => d.balance > 0);
    const totalBalance = active.reduce((s, d) => s + d.balance, 0);

    clear(statContainer);
    clear(compareContainer);
    clear(chartContainer);
    clear(orderContainer);
    resultContainer.replaceChildren();

    if (active.length === 0) {
      resultContainer.append(
        el("p", { class: "ph-empty", text: "No debt entered. You're already free here. 🎉" }),
      );
      return;
    }

    const plan = debtFreedomPlan(fields.debts, fields.extra);
    const chosen = fields.method === "avalanche" ? plan.avalanche : plan.snowball;

    // The donut of what you owe (the "look it in the eye" picture).
    chartContainer.append(
      donutChart({
        slices: active.map((d, i) => ({
          label: d.name || `Debt ${i + 1}`,
          value: d.balance,
          color: paletteVar(i),
        })),
        locale: ctx.locale,
        ariaLabel: "Your debts by balance",
        centerValue: Money.from(totalBalance).format(ctx.locale),
        centerLabel: "owed",
      }),
    );

    // Underfunded: the budget can't outrun the interest. A genuine warning (§5.3).
    if (chosen.months === null) {
      resultContainer.append(
        el("div", {
          class: "verify-banner",
          attrs: { role: "alert" },
          text: `At ${fmt(Money.from(plan.monthlyTotal))}/mo total, the interest keeps pace with the payment, so the debt never clears. Add a little to the extra each month and watch the date appear.`,
        }),
      );
      return;
    }

    // The headline stat cards.
    const stats: Stat[] = [
      {
        label: "Debt-free by",
        value: freedomDateLabel(chosen.months, ctx.locale),
        tone: "good",
        hint: monthsLabel(chosen.months),
      },
      { label: "Total interest", value: fmt(chosen.totalInterest), tone: "neutral" },
    ];
    if (plan.interestSaved !== null && plan.interestSaved.greaterThan(0)) {
      stats.push({
        label: "Avalanche saves",
        value: fmt(plan.interestSaved),
        tone: "accent",
        hint:
          plan.monthsSaved && plan.monthsSaved > 0
            ? `and ${monthsLabel(plan.monthsSaved)}`
            : "in interest",
      });
    }
    stats.push({
      label: "Every month",
      value: fmt(Money.from(plan.monthlyTotal)),
      tone: "primary",
      hint: `${fmt(Money.from(plan.totalMinimum))} min + ${fmt(Money.from(fields.extra))} extra`,
    });
    statContainer.append(statStrip(stats, "Your debt payoff at a glance"));

    // The two-method comparison, the chosen one highlighted.
    compareContainer.append(renderCompare(plan));

    // The order debts fall away under the chosen method.
    const ol = el("ol", { class: "payoff-order" });
    for (const step of chosen.payoffOrder) {
      ol.append(
        el(
          "li",
          {},
          el("span", { class: "payoff-order__name", text: step.name }),
          el("span", {
            class: "payoff-order__when",
            text: step.month === 0 ? "already clear" : freedomDateLabel(step.month, ctx.locale),
          }),
        ),
      );
    }
    orderContainer.append(
      el("p", {
        class: "field-group-label",
        text: `The order your debts fall away (${methodName(fields.method)})`,
      }),
      ol,
    );

    const breakdown: BreakdownLine[] = [
      { label: "Debts", value: String(active.length) },
      { label: "Total owed", value: fmt(Money.from(totalBalance)) },
      { label: "Minimum payments", value: fmt(Money.from(plan.totalMinimum)) },
      { label: "Extra each month", value: fmt(Money.from(fields.extra)) },
      { label: "Paid each month", value: fmt(Money.from(plan.monthlyTotal)) },
      {
        label: `Freedom date (${methodName(fields.method)})`,
        value: freedomDateLabel(chosen.months, ctx.locale),
        emphasis: true,
      },
      { label: "Total interest", value: fmt(chosen.totalInterest) },
    ];
    if (plan.interestSaved !== null) {
      breakdown.push({
        label: "Avalanche saves vs snowball",
        value:
          plan.interestSaved.isZero() && plan.monthsSaved === 0
            ? "Same either way at these rates"
            : `${fmt(plan.interestSaved)} interest, ${monthsLabel(Math.max(0, plan.monthsSaved ?? 0))}`,
      });
    }

    resultContainer.append(
      resultCard({
        label: `Time to debt-free (${methodName(fields.method)})`,
        value: Money.from(chosen.months),
        locale: ctx.locale,
        format: (n) => monthsLabel(Math.round(n)),
        copyText: `${chosen.months} months`,
        breakdown,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function renderCompare(plan: ReturnType<typeof debtFreedomPlan>): HTMLElement {
    const card = (method: DebtMethod): HTMLElement => {
      const r = method === "avalanche" ? plan.avalanche : plan.snowball;
      const chosen = fields.method === method;
      const tag = method === "snowball" ? "smallest balance first" : "highest rate first";
      const children: (HTMLElement | null)[] = [
        el(
          "div",
          { class: "compare-card__name" },
          el("span", { text: methodName(method) }),
          chosen ? el("span", { class: "compare-card__tag", text: "your pick" }) : null,
        ),
        el("p", {
          class: "compare-card__date",
          text: r.months === null ? "never at this budget" : freedomDateLabel(r.months, ctx.locale),
        }),
        el("p", {
          class: "compare-card__sub",
          text:
            r.months === null
              ? tag
              : `${monthsLabel(r.months)} · ${r.totalInterest.format(ctx.locale)} interest · ${tag}`,
        }),
      ];
      return el(
        "button",
        {
          type: "button",
          class: `compare-card${chosen ? " compare-card--chosen" : ""}`,
          attrs: {
            "aria-pressed": chosen ? "true" : "false",
            "aria-label": `Use the ${methodName(method)} method`,
          },
          on: {
            click: () => {
              fields.method = method;
              persist();
              renderMethodButtons();
              compute();
            },
          },
        },
        ...children.filter((c): c is HTMLElement => c !== null),
      );
    };
    return el("div", { class: "compare" }, card("snowball"), card("avalanche"));
  }

  function renderMethodButtons(): void {
    clear(methodContainer);
    (["snowball", "avalanche"] as DebtMethod[]).forEach((m) => {
      methodContainer.append(
        el("button", {
          type: "button",
          class: fields.method === m ? "btn btn--accent" : "btn btn--ghost",
          text: methodName(m),
          attrs: { "aria-pressed": fields.method === m ? "true" : "false" },
          on: {
            click: () => {
              fields.method = m;
              persist();
              renderMethodButtons();
              compute();
            },
          },
        }),
      );
    });
  }

  function debtRow(debt: PlannedDebt, i: number): HTMLElement {
    const onEdit = (patch: Partial<PlannedDebt>): void => {
      fields.debts[i] = { ...fields.debts[i]!, ...patch };
      persist();
      compute();
    };
    const name = el("input", {
      type: "text",
      value: debt.name,
      attrs: { "aria-label": `Debt ${i + 1} name` },
      on: { input: (e) => onEdit({ name: (e.target as HTMLInputElement).value }) },
    });
    const balance = el("input", {
      type: "number",
      min: 0,
      step: 100,
      value: debt.balance,
      attrs: { "aria-label": `Debt ${i + 1} balance`, inputmode: "decimal" },
      on: {
        input: (e) =>
          onEdit({ balance: parseNonNegative((e.target as HTMLInputElement).value, 0) }),
      },
    });
    const rate = el("input", {
      type: "number",
      min: 0,
      step: 0.25,
      value: debt.ratePct,
      attrs: { "aria-label": `Debt ${i + 1} annual interest rate (percent)`, inputmode: "decimal" },
      on: {
        input: (e) => onEdit({ ratePct: parseNumber((e.target as HTMLInputElement).value, 0) }),
      },
    });
    const min = el("input", {
      type: "number",
      min: 0,
      step: 5,
      value: debt.minPayment,
      attrs: { "aria-label": `Debt ${i + 1} minimum monthly payment`, inputmode: "decimal" },
      on: {
        input: (e) =>
          onEdit({ minPayment: parseNonNegative((e.target as HTMLInputElement).value, 0) }),
      },
    });
    const remove = el("button", {
      type: "button",
      class: "btn btn--ghost",
      text: "Remove",
      attrs: { "aria-label": `Remove debt ${i + 1}` },
      on: {
        click: () => {
          fields.debts = fields.debts.filter((_, j) => j !== i);
          persist();
          renderDebts();
          compute();
        },
      },
    });
    return el(
      "div",
      { class: "plan-debt-row" },
      field(`Debt ${i + 1}`, name),
      field("Balance", balance),
      field("APR (%)", rate),
      field("Min/mo", min),
      remove,
    );
  }

  function renderDebts(): void {
    clear(debtsContainer);
    fields.debts.forEach((d, i) => debtsContainer.append(debtRow(d, i)));
    debtsContainer.append(
      el("button", {
        type: "button",
        class: "btn btn--ghost plan-add-debt",
        text: "+ Add a debt",
        on: {
          click: () => {
            fields.debts = [
              ...fields.debts,
              { name: "Debt", balance: 0, ratePct: 0, minPayment: 0 },
            ];
            persist();
            renderDebts();
            compute();
          },
        },
      }),
    );
  }

  extraInput.addEventListener("input", () => {
    fields.extra = parseNonNegative(extraInput.value, 0);
    persist();
    compute();
  });

  const tryExample = tryExampleButton(() => {
    fields = {
      debts: EXAMPLE.debts.map((d) => ({ ...d })),
      extra: EXAMPLE.extra,
      method: EXAMPLE.method,
    };
    extraInput.value = String(fields.extra);
    persist();
    renderDebts();
    renderMethodButtons();
    compute();
  });

  const intro = el(
    "div",
    { class: "tile-intro" },
    el("p", {
      class: "tile-intro__lead",
      text: "List every debt, pay the minimum on all of them, then throw everything extra at one until it's gone. Roll that payment onto the next, and the next.",
    }),
    el("p", {
      class: "tile-intro__sub",
      text: "That rolling payment is the debt snowball. Smallest balance first gives you quick wins and the momentum to keep going; highest rate first (the avalanche) saves the most interest. We show both on your numbers so you can pick momentum or math with your eyes open.",
    }),
  );

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    el("p", {
      class: "field-group-label",
      text: "Your debts: balance, APR, and the minimum payment on each.",
    }),
    debtsContainer,
    field("Extra to pay each month (beyond the minimums)", extraInput),
    el("p", { class: "field-group-label", text: "Payoff order" }),
    methodContainer,
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(
    intro,
    form,
    statContainer,
    compareContainer,
    chartContainer,
    orderContainer,
    resultContainer,
  );
  renderDebts();
  renderMethodButtons();
  compute();
}

function methodName(method: DebtMethod): string {
  return method === "snowball" ? "Snowball" : "Avalanche";
}

export const debtFreedomTile: TileDefinition = {
  id: "debt-freedom",
  title: "Debt Freedom Planner",
  pillar: "debt",
  description: "Compare the debt snowball and avalanche, and find your debt-free date.",
  keywords: [
    "debt snowball",
    "debt avalanche",
    "debt freedom",
    "pay off debt",
    "smallest balance first",
    "highest rate first",
    "debt payoff",
    "interest saved",
  ],
  status: "ready",
  how: "List each debt with its balance, its APR, and the minimum payment, then enter the extra you can pay each month beyond those minimums. We pay every minimum, throw the extra at one target debt until it's gone, then roll that whole payment onto the next, the rolling payment that gives the method its name.\n\nWe run your numbers two ways. The snowball attacks the smallest balance first: you clear a whole debt quickly, which is a real win that keeps most people going, because getting out of debt is mostly about behavior. The avalanche attacks the highest rate first, which always costs the least interest and is sometimes faster. We show the freedom date and the total interest for each, plus exactly what the snowball's momentum costs you over the avalanche, so the choice is yours and nothing is hidden.\n\nIt's deterministic month-by-month arithmetic on your own balances, with nothing to cite. Debts default from My Situation if you've entered them. It pairs with the Budget Overview (find the extra) and the Freedom Date tool (a single balance).",
  resources: [
    {
      label: "CFPB, ways to pay down debt",
      url: "https://www.consumerfinance.gov/ask-cfpb/what-is-the-best-way-to-pay-off-my-debt-en-1849/",
    },
  ],
  mount: mountDebtFreedom,
};
