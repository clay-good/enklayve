/**
 * Bill Triage (SPEC-4 §A3) — harm tier 2.
 *
 * "I have $600 and $1,400 of bills. What do I pay first?" The ranking comes from
 * `engine/triage.ts`, which sorts by consequence rather than interest rate. This
 * tile's job is the half that actually changes behavior: rendering **what
 * happens** beside every line, so the order is an argument the user can check
 * rather than an instruction they have to trust.
 *
 * Tier 2 obligations (SPEC-4 §3.2), all load-bearing here:
 *   - the consequence renders on-screen next to every ranked line, not hidden
 *     behind a disclosure;
 *   - the tool never says to skip a bill — it says what happens if one goes
 *     unpaid, and names the relief that exists for it; and
 *   - anything genuinely set by state law is a pointer, never a number.
 */
import { Money } from "../engine/money";
import { triageBills, type Bill } from "../engine/triage";
import type { BillTriageCategory } from "../data/schemas";
import { el, option } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
import type { TileContext, TileDefinition } from "./types";

/** Cap the row count so a crafted `?k=` can't allocate a runaway editor. */
const MAX_ROWS = 40;

interface Fields {
  available: number;
  bills: Bill[];
}

/** A month that does not close: rent, the lights, the car, and a card. */
const EXAMPLE: Fields = {
  available: 1600,
  bills: [
    { name: "Rent", categoryId: "housing", amount: 1450 },
    { name: "Electric", categoryId: "utilities", amount: 190 },
    { name: "Car payment", categoryId: "job-transport", amount: 340 },
    { name: "Car insurance", categoryId: "insurance", amount: 120 },
    { name: "Visa", categoryId: "credit-cards", amount: 95 },
    { name: "Hospital bill", categoryId: "medical", amount: 260 },
  ],
};

function readFields(p: URLSearchParams, categories: BillTriageCategory[]): Fields {
  const count = Math.min(MAX_ROWS, Math.max(0, Math.round(parseNonNegative(p.get("k"), 0))));
  const valid = new Set(categories.map((c) => c.id));
  const fallback = categories[0]?.id ?? "";
  const bills: Bill[] = [];
  for (let i = 0; i < count; i++) {
    const categoryId = p.get(`c${i}`) ?? "";
    bills.push({
      name: p.get(`n${i}`) ?? "",
      categoryId: valid.has(categoryId) ? categoryId : fallback,
      amount: parseNonNegative(p.get(`a${i}`), 0),
    });
  }
  // A first visit with no params falls back to the worked example *whole*.
  // Defaulting the bills but not the money opened the tile on "$0 covers $0 of
  // $2,455" with every line reading "nothing left for this" — an alarming and
  // meaningless first impression for a tool people reach on a bad day.
  const usingExample = bills.length === 0;
  return {
    available: usingExample ? EXAMPLE.available : parseNonNegative(p.get("have"), 0),
    bills: usingExample ? EXAMPLE.bills.map((b) => ({ ...b })) : bills,
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("have", String(f.available));
  p.set("k", String(f.bills.length));
  f.bills.forEach((b, i) => {
    p.set(`n${i}`, b.name);
    p.set(`c${i}`, b.categoryId);
    p.set(`a${i}`, String(b.amount));
  });
  return p;
}

export function mountBillTriage(ctx: TileContext): void {
  const { root, data } = ctx;
  root.replaceChildren();
  const rules = data?.billTriage();
  if (!rules) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "The bill-priority rules are unavailable, so no order can be computed. Verify before relying on any figure.",
      }),
    );
    return;
  }

  let fields = readFields(ctx.params, rules.categories);
  const rowHost = el("div", { class: "triage-rows" });
  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  const haveInput = el("input", {
    type: "number",
    name: "have",
    min: 0,
    step: 10,
    value: fields.available,
    attrs: { "aria-label": "Money you have this month", inputmode: "decimal" },
  });

  function renderRows(): void {
    rowHost.replaceChildren(
      ...fields.bills.map((b, i) => {
        const name = el("input", {
          type: "text",
          value: b.name,
          attrs: { "aria-label": `Bill ${i + 1} name` },
          on: {
            input: (e) => {
              fields.bills[i]!.name = (e.target as HTMLInputElement).value;
              recompute();
            },
          },
        });
        const cat = el(
          "select",
          {
            attrs: { "aria-label": `Bill ${i + 1} type` },
            on: {
              change: (e) => {
                fields.bills[i]!.categoryId = (e.target as HTMLSelectElement).value;
                recompute();
              },
            },
          },
          ...rules!.categories.map((c) => option(c.id, c.label, c.id === b.categoryId)),
        );
        const amount = el("input", {
          type: "number",
          min: 0,
          step: 10,
          value: b.amount,
          attrs: { "aria-label": `Bill ${i + 1} amount`, inputmode: "decimal" },
          on: {
            input: (e) => {
              fields.bills[i]!.amount = parseNonNegative((e.target as HTMLInputElement).value, 0);
              recompute();
            },
          },
        });
        const remove = el("button", {
          type: "button",
          class: "row-remove",
          text: "Remove",
          attrs: { "aria-label": `Remove bill ${i + 1}` },
          on: {
            click: () => {
              fields.bills.splice(i, 1);
              renderRows();
              recompute();
            },
          },
        });
        return el("div", { class: "triage-row" }, name, cat, amount, remove);
      }),
    );
  }

  function compute(): void {
    const result = triageBills(fields.bills, fields.available, rules!);
    const fmt = (m: Money): string => m.format(ctx.locale);

    const header = result.coversEverything
      ? el("p", {
          class: "triage-lead",
          text: `Your ${fmt(result.available)} covers all ${fmt(result.total)}. No triage needed this month.`,
        })
      : el("p", {
          class: "triage-lead",
          text: `You have ${fmt(result.available)} against ${fmt(result.total)} of bills, so you are ${fmt(result.shortfall)} short. Here is the order that protects your housing, your income, and your legal standing first, and what happens to what it doesn't reach.`,
        });

    // Every line renders its consequence and its relief inline. This is the
    // tier-2 obligation: a ranking without its reasons is an instruction, and
    // this tool is not in the business of issuing instructions.
    const list = el(
      "ol",
      { class: "triage-list" },
      ...result.ordered.map((t) =>
        el(
          "li",
          { class: `triage-item triage-item--${t.coverage}` },
          el(
            "div",
            { class: "triage-item__head" },
            el("span", { class: "triage-item__name", text: t.bill.name || t.category.label }),
            el("span", {
              class: "triage-item__amount",
              text:
                t.coverage === "full"
                  ? fmt(Money.from(t.bill.amount))
                  : t.coverage === "partial"
                    ? `${fmt(t.funded)} of ${fmt(Money.from(t.bill.amount))}`
                    : `${fmt(Money.from(t.bill.amount))} — nothing left for this`,
            }),
          ),
          el("p", { class: "triage-item__consequence", text: t.category.consequence }),
          t.category.timingNote
            ? el("p", { class: "triage-item__timing", text: t.category.timingNote })
            : null,
          el(
            "ul",
            { class: "triage-item__relief" },
            ...t.category.relief.map((r) => el("li", { text: r })),
          ),
        ),
      ),
    );

    const nodes: (HTMLElement | null)[] = [header, list];

    if (!result.coversEverything) {
      nodes.push(
        el("p", {
          class: "triage-note",
          text: `${fmt(result.shortfall)} is not covered this month. Call the people you can't pay before the due date rather than after — nearly every line above has a hardship option, and they are far easier to get before an account is in collections.`,
        }),
      );
    }
    if (result.stateVariable.length > 0) {
      nodes.push(
        el("p", {
          class: "triage-note",
          text: `How much warning you get on ${result.stateVariable.map((c) => c.label.toLowerCase()).join(", ")} is set by your state, and sometimes your city. Check your state's rules rather than assuming the worst or the best.`,
        }),
      );
    }
    nodes.push(
      el(
        "p",
        { class: "triage-source" },
        "Order and consequences follow ",
        el("a", {
          href: rules!.citation.sourceUrl,
          text: rules!.citation.sourceDocument,
          attrs: { rel: "noopener noreferrer", target: "_blank" },
        }),
        ". The CFPB publishes no numeric ranking, so this default is our reading of its framing — change it to fit your situation.",
      ),
    );

    resultContainer.replaceChildren(...nodes.filter((n): n is HTMLElement => n !== null));
  }

  function recompute(): void {
    fields.available = parseNonNegative(haveInput.value, 0);
    ctx.setParams(writeFields(fields));
    compute();
  }

  haveInput.addEventListener("input", recompute);

  const addRow = el("button", {
    type: "button",
    class: "row-add",
    text: "Add a bill",
    on: {
      click: () => {
        if (fields.bills.length >= MAX_ROWS) return;
        fields.bills.push({ name: "", categoryId: rules!.categories[0]!.id, amount: 0 });
        renderRows();
        recompute();
      },
    },
  });

  const tryExample = tryExampleButton(() => {
    fields = { available: EXAMPLE.available, bills: EXAMPLE.bills.map((b) => ({ ...b })) };
    haveInput.value = String(fields.available);
    renderRows();
    recompute();
  });

  root.append(
    el(
      "form",
      { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
      field("Money you have this month", haveInput),
      el(
        "div",
        { class: "triage-editor" },
        rowHost,
        el("div", { class: "triage-actions" }, addRow),
      ),
      el("div", { class: "tile-form-actions" }, tryExample),
    ),
    resultContainer,
  );
  renderRows();
  compute();
}

export const billTriageTile: TileDefinition = {
  id: "bill-triage",
  title: "Bill Triage",
  pillar: "rough",
  harmTier: 2,
  description: "When you can't pay everything, what comes first, and what happens to the rest.",
  keywords: [
    "triage",
    "which bill first",
    "can't pay",
    "behind on bills",
    "priority",
    "shutoff",
    "eviction",
    "short month",
  ],
  status: "ready",
  mount: mountBillTriage,
  how: "Every debt calculator sorts by interest rate. In a month you can't cover, that's backwards.\n\nThe 24% credit card is the expensive debt on a spreadsheet and the cheap one in a bad month: missing it costs a late fee, a mark on your credit, and a higher rate. Missing rent can cost you the home. Missing the electric bill can cost you heat, and a reconnection fee on top of what you already owed. Missing the car payment can cost you the way you get to work, and then the work.\n\nSo this orders your bills by what happens if each one goes unpaid, following the CFPB's own framing: protect your housing and your income, keep your insurance, meet court-ordered obligations. Then it applies the money you have down that list and tells you, plainly, what happens to everything it doesn't reach.\n\nIt never tells you to skip a bill. Every line shows the consequence and the help that exists for it, because nearly all of these have a hardship option and almost all of them are easier to get before the due date than after. Anything your state sets — how much notice before a shutoff, how long an eviction takes, when a car can be repossessed — is flagged as your state's rule rather than given as a number, because those vary enormously and a wrong number here would be worse than none.\n\nThis is information about published guidance applied to the bills you entered. It is not legal or financial advice, and it is not a substitute for talking to the people you owe.",
  resources: [
    {
      label: "CFPB, Prioritizing bills",
      url: "https://files.consumerfinance.gov/f/documents/cfpb_your-money-your-goals_prioritizing-bills_tool.pdf",
    },
    {
      label: "Find a HUD-approved housing counselor",
      url: "https://www.hud.gov/housing_counseling",
    },
    { label: "LIHEAP, help with energy bills", url: "https://www.acf.hhs.gov/ocs/programs/liheap" },
  ],
  related: [
    {
      hubId: "debt",
      tool: "debt-freedom",
      label: "Debt Freedom Planner",
      note: "Once the month is stable, plan the payoff",
    },
    {
      hubId: "benefits",
      tool: "screener",
      label: "What am I owed?",
      note: "Programs that could close the gap",
    },
  ],
};
