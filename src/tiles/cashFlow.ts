/**
 * Cash-Flow Timeline tile (BUILD-SPEC-2 §6.1): map your income and bills across
 * the month to spot the tightest day. We walk a running balance day by day from
 * your dated amounts and surface the lowest point (and any day it would go
 * negative) — the classic "rent's due before payday" squeeze. Pure arithmetic.
 */
import { Money } from "../engine/money";
import { cashFlowTimeline, type CashFlowEvent } from "../engine/finance";
import { el, clear, option } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import type { TileContext, TileDefinition } from "./types";

interface Event {
  day: number;
  label: string;
  type: "income" | "bill";
  amount: number;
}

interface Fields {
  startingBalance: number;
  events: Event[];
}

const EXAMPLE: Fields = {
  startingBalance: 800,
  events: [
    { day: 1, label: "Rent", type: "bill", amount: 1500 },
    { day: 3, label: "Paycheck", type: "income", amount: 2400 },
    { day: 8, label: "Groceries", type: "bill", amount: 350 },
    { day: 12, label: "Utilities", type: "bill", amount: 220 },
    { day: 17, label: "Paycheck", type: "income", amount: 2400 },
    { day: 22, label: "Car payment", type: "bill", amount: 400 },
    { day: 27, label: "Credit card", type: "bill", amount: 600 },
  ],
};

function readFields(p: URLSearchParams): Fields {
  const count = Math.max(0, Math.round(parseNonNegative(p.get("k"), 0)));
  const events: Event[] = [];
  for (let i = 0; i < count; i++) {
    events.push({
      day: Math.max(1, Math.min(31, Math.round(parseNonNegative(p.get(`d${i}`), 1)))),
      label: p.get(`l${i}`) ?? "",
      type: p.get(`t${i}`) === "income" ? "income" : "bill",
      amount: parseNonNegative(p.get(`m${i}`), 0),
    });
  }
  return { startingBalance: parseNonNegative(p.get("s"), 0), events };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("s", String(f.startingBalance));
  p.set("k", String(f.events.length));
  f.events.forEach((e, i) => {
    p.set(`d${i}`, String(e.day));
    p.set(`l${i}`, e.label);
    p.set(`t${i}`, e.type);
    p.set(`m${i}`, String(e.amount));
  });
  return p;
}

function toEngineEvents(events: Event[]): CashFlowEvent[] {
  return events.map((e) => ({
    day: e.day,
    amount: e.type === "bill" ? -Math.max(0, e.amount) : Math.max(0, e.amount),
    label: e.label,
  }));
}

export function mountCashFlow(ctx: TileContext): void {
  const { root } = ctx;
  root.replaceChildren();
  let fields = readFields(ctx.params);
  if (fields.events.length === 0) {
    fields = { ...fields, events: [{ day: 1, label: "Paycheck", type: "income", amount: 0 }] };
  }

  const startInput = el("input", {
    type: "number",
    name: "s",
    min: 0,
    step: 100,
    value: fields.startingBalance,
    attrs: { "aria-label": "Starting balance", inputmode: "decimal" },
  });

  const eventsContainer = el("div", { class: "plan-debts" });
  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function persist(): void {
    ctx.setParams(writeFields(fields));
  }

  function compute(): void {
    const r = cashFlowTimeline(fields.startingBalance, toEngineEvents(fields.events));
    const fmt = (m: Money): string => m.format(ctx.locale);
    const dollars = (n: number): string => Money.from(n).format(ctx.locale);

    const status: BreakdownLine = r.goesNegative
      ? {
          label: "Heads up",
          value: `Your balance dips to ${fmt(r.minBalance)} on day ${r.minDay}. Consider a buffer or shifting a bill's date.`,
          emphasis: true,
        }
      : {
          label: "Looks steady",
          value:
            r.minDay === 0
              ? "Your balance never falls below where it started."
              : `Your tightest day is day ${r.minDay} at ${fmt(r.minBalance)}, still above zero.`,
          emphasis: true,
        };

    const lines: BreakdownLine[] = [
      { label: "Starting balance", value: dollars(fields.startingBalance) },
      { label: "Ending balance", value: fmt(r.endingBalance) },
      { label: "Lowest balance", value: fmt(r.minBalance) },
      status,
      ...r.days.map((d) => ({
        label: `Day ${d.day}`,
        value: `${d.net >= 0 ? "+" : "−"}${dollars(Math.abs(d.net))} → ${dollars(d.balance)}`,
      })),
    ];

    resultContainer.replaceChildren(
      resultCard({
        label: "Lowest balance this month",
        value: r.minBalance,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function renderEvents(): void {
    clear(eventsContainer);
    fields.events.forEach((ev, i) => {
      const day = el("input", {
        type: "number",
        min: 1,
        max: 31,
        step: 1,
        value: ev.day,
        attrs: { "aria-label": `Event ${i + 1} day of month`, inputmode: "numeric" },
        on: {
          input: (e) => {
            fields.events[i] = {
              ...ev,
              day: Math.max(
                1,
                Math.min(31, Math.round(parseNonNegative((e.target as HTMLInputElement).value, 1))),
              ),
            };
            persist();
            compute();
          },
        },
      });
      const label = el("input", {
        type: "text",
        value: ev.label,
        attrs: { "aria-label": `Event ${i + 1} label` },
        on: {
          input: (e) => {
            fields.events[i] = {
              ...fields.events[i]!,
              label: (e.target as HTMLInputElement).value,
            };
            persist();
            compute();
          },
        },
      });
      const type = el(
        "select",
        {
          attrs: { "aria-label": `Event ${i + 1} type` },
          on: {
            change: (e) => {
              fields.events[i] = {
                ...fields.events[i]!,
                type: (e.target as HTMLSelectElement).value === "income" ? "income" : "bill",
              };
              persist();
              compute();
            },
          },
        },
        option("bill", "Bill", ev.type === "bill"),
        option("income", "Income", ev.type === "income"),
      );
      const amount = el("input", {
        type: "number",
        min: 0,
        step: 50,
        value: ev.amount,
        attrs: { "aria-label": `Event ${i + 1} amount`, inputmode: "decimal" },
        on: {
          input: (e) => {
            fields.events[i] = {
              ...fields.events[i]!,
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
        attrs: { "aria-label": `Remove event ${i + 1}` },
        on: {
          click: () => {
            fields.events = fields.events.filter((_, j) => j !== i);
            persist();
            renderEvents();
            compute();
          },
        },
      });
      eventsContainer.append(
        el(
          "div",
          { class: "plan-debt-row" },
          field("Day", day),
          field("What", label),
          field("Type", type),
          field("Amount", amount),
          remove,
        ),
      );
    });
    eventsContainer.append(
      el("button", {
        type: "button",
        class: "btn btn--ghost plan-add-debt",
        text: "+ Add income or bill",
        on: {
          click: () => {
            fields.events = [...fields.events, { day: 1, label: "Item", type: "bill", amount: 0 }];
            persist();
            renderEvents();
            compute();
          },
        },
      }),
    );
  }

  startInput.addEventListener("input", () => {
    fields.startingBalance = parseNonNegative(startInput.value, 0);
    persist();
    compute();
  });

  const tryExample = tryExampleButton(() => {
    fields = {
      startingBalance: EXAMPLE.startingBalance,
      events: EXAMPLE.events.map((e) => ({ ...e })),
    };
    startInput.value = String(fields.startingBalance);
    persist();
    renderEvents();
    compute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Starting balance", startInput),
    el("p", { class: "field-group-label", text: "Income and bills, by day of the month" }),
    eventsContainer,
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  renderEvents();
  compute();
}

export const cashFlowTile: TileDefinition = {
  id: "cash-flow",
  title: "Cash-Flow Timeline",
  pillar: "take-home",
  description: "Map income and bills across the month to spot tight days.",
  keywords: ["cash flow", "timeline", "tight days", "paycheck timing", "bills", "calendar"],
  status: "ready",
  how: "Enter your starting balance and each income and bill with the day of the month it lands. We walk a running balance day by day and surface your lowest point, and any day it would dip below zero. That's the classic squeeze when rent is due before payday.\n\nIt's a timing tool, not a budget total: two months with the same income can feel very different depending on when money comes and goes. If a tight day shows up, a small buffer or shifting a due date often fixes it.",
  resources: [
    {
      label: "CFPB, managing your money",
      url: "https://www.consumerfinance.gov/consumer-tools/money-as-you-grow/",
    },
  ],
  mount: mountCashFlow,
};
