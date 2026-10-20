/**
 * Federal Student Loan Payment, the interactive half (SPEC-5 Phase 33).
 * Loaded on first use with its shard. It never names a plan as the choice.
 */
import { Money } from "../engine/money";
import {
  ibrOutcome,
  interestDeduction,
  rapOutcome,
  standardOutcome,
  type PlanOutcome,
} from "../engine/studentLoans";
import { fplRegionFor } from "../data/usStates";
import { el, option } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
import { citationLink } from "../ui/resultCard";
import { renderDeadline, todayIso } from "../ui/deadline";
import type { TileContext } from "./types";

const CURRENT_PLANS = [
  { value: "", label: "Not yet chosen, or one of the plans below" },
  { value: "save", label: "SAVE" },
  { value: "paye", label: "PAYE" },
  { value: "icr", label: "Income-contingent repayment (ICR)" },
] as const;

const PLAN_NAMES: Record<PlanOutcome["plan"], string> = {
  rap: "Repayment Assistance Plan",
  standard: "Standard (tiered)",
  ibr: "Income-based repayment",
};

interface Fields {
  balance: number;
  rate: number;
  agi: number;
  deps: number;
  size: number;
  growth: number;
  newLoan: boolean;
  new2014: boolean;
  joint: boolean;
  current: string;
}

const EXAMPLE: Fields = {
  balance: 38000,
  rate: 6.5,
  agi: 52000,
  deps: 1,
  size: 2,
  growth: 2,
  newLoan: false,
  new2014: true,
  joint: false,
  current: "",
};

function readFields(p: URLSearchParams, ctx: TileContext): Fields {
  const num = (k: string, d: number) => (p.has(k) ? parseNonNegative(p.get(k), d) : d);
  const current = p.get("cur") ?? "";
  return {
    balance: num("bal", 0),
    rate: num("rate", 6.5),
    agi: num("agi", ctx.profile.get("annualIncome") ?? 0),
    deps: Math.min(12, Math.round(num("deps", ctx.profile.get("qualifyingChildren") ?? 0))),
    size: Math.max(1, Math.min(20, Math.round(num("size", ctx.profile.get("householdSize") ?? 1)))),
    growth: Math.min(10, num("g", 0)),
    newLoan: p.get("new") === "1",
    new2014: p.get("n14") === "1",
    joint: p.get("mfj") === "1",
    current: CURRENT_PLANS.some((c) => c.value === current) ? current : "",
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("bal", String(f.balance));
  p.set("rate", String(f.rate));
  p.set("agi", String(f.agi));
  p.set("deps", String(f.deps));
  p.set("size", String(f.size));
  p.set("g", String(f.growth));
  if (f.newLoan) p.set("new", "1");
  if (f.new2014) p.set("n14", "1");
  if (f.joint) p.set("mfj", "1");
  if (f.current) p.set("cur", f.current);
  return p;
}

export function mountStudentLoanPayment(ctx: TileContext): void {
  const { root, data } = ctx;
  root.replaceChildren();
  const rules = data?.studentLoans();
  if (!rules) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "The repayment rules are unavailable, so no payment is given. The Department of Education's Loan Simulator can show yours.",
      }),
    );
    return;
  }
  let fields = readFields(ctx.params, ctx);

  const num = (name: string, value: number, label: string, step: number) =>
    el("input", {
      type: "number",
      name,
      min: 0,
      step,
      value,
      attrs: { "aria-label": label, inputmode: "decimal" },
    });
  const box = (name: string, label: string, checked: boolean): HTMLInputElement => {
    const b = el("input", { type: "checkbox", name, attrs: { "aria-label": label } });
    b.checked = checked;
    return b;
  };
  const balInput = num("bal", fields.balance, "Total federal loan balance", 1000);
  const rateInput = num("rate", fields.rate, "Average interest rate (%)", 0.125);
  const agiInput = num("agi", fields.agi, "Adjusted gross income", 1000);
  const depsInput = num("deps", fields.deps, "Dependents you claim", 1);
  const sizeInput = num("size", fields.size, "Family size", 1);
  const growthInput = num("g", fields.growth, "Yearly income growth (%)", 0.5);
  const newBox = box("new", "Any federal loan made on or after July 1, 2026", fields.newLoan);
  const n14Box = box("n14", "First borrowed on or after July 1, 2014", fields.new2014);
  const jointBox = box("mfj", "Married filing jointly", fields.joint);
  const curSelect = el(
    "select",
    { name: "cur", attrs: { "aria-label": "The plan you repay under now" } },
    ...CURRENT_PLANS.map((c) => option(c.value, c.label, c.value === fields.current)),
  );
  curSelect.value = fields.current;

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const fmt = (n: number): string => Money.from(n).format(ctx.locale);
    const nodes: HTMLElement[] = [];
    if (fields.current) {
      const window = data!.enrollmentWindows()?.windows.find((w) => w.id === "idr-transition-2028");
      nodes.push(
        el("p", {
          class: "slp-ending",
          text: `${CURRENT_PLANS.find((c) => c.value === fields.current)!.label} closes, so no payment is shown for it. These are the plans you can move to.`,
        }),
      );
      if (window)
        nodes.push(
          renderDeadline(
            {
              label: window.label,
              due: { on: "on" in window.due ? window.due.on : "" },
              citation: window.citation,
            },
            { asOf: todayIso(), locale: ctx.locale },
          ),
        );
    }
    if (fields.balance <= 0) {
      nodes.push(
        el("p", { class: "slp-none", text: "Enter your federal loan balance to compare plans." }),
      );
      resultContainer.replaceChildren(...nodes);
      return;
    }
    const s = {
      balance: fields.balance,
      ratePct: fields.rate,
      agi: fields.agi,
      dependents: fields.deps,
      familySize: fields.size,
      incomeGrowth: fields.growth / 100,
      newBorrower2014: fields.new2014,
    };
    const outcomes: PlanOutcome[] = [rapOutcome(s, rules!)];
    // A borrower with a loan from July 1, 2026 on chooses between RAP and the
    // tiered Standard plan; one without may still choose income-based
    // repayment (§1087e(d)(7), §1098e).
    if (fields.newLoan) outcomes.push(standardOutcome(s, rules!));
    else {
      const fpl = data!.fpl(fplRegionFor(ctx.profile.get("stateCode") ?? ""));
      if (fpl) outcomes.push(ibrOutcome(s, rules!, fpl));
    }
    const rows = outcomes.map((o) =>
      el(
        "tr",
        { class: "slp-row" },
        el("th", { attrs: { scope: "row" }, text: PLAN_NAMES[o.plan] }),
        el("td", { text: `${fmt(o.monthlyNow)}/mo` }),
        el("td", { text: fmt(o.totalPaid) }),
        el("td", { text: `${Math.ceil(o.months / 12)} years` }),
        el("td", { text: o.forgiven > 0 ? fmt(o.forgiven) : "None" }),
      ),
    );
    const firstYearInterest = Math.min(
      fields.balance * (fields.rate / 100),
      rules!.interestDeduction.max,
    );
    const deduction = interestDeduction(firstYearInterest, fields.agi, fields.joint, rules!);
    nodes.push(
      el(
        "table",
        { class: "breakdown-table slp-table" },
        el(
          "thead",
          {},
          el(
            "tr",
            {},
            ...["Plan", "Payment now", "Total paid", "Ends after", "Forgiven at the end"].map((h) =>
              el("th", { attrs: { scope: "col" }, text: h }),
            ),
          ),
        ),
        el("tbody", {}, ...rows),
      ),
      el(
        "p",
        { class: "slp-note" },
        `With income growing ${fields.growth}% a year and no change in family size. A forgiven balance is taxable income under current law, in a year decades away. `,
        citationLink(rules!.citation),
      ),
      el("p", {
        class: "slp-note",
        text: `Student loan interest is deductible up to ${fmt(rules!.interestDeduction.max)} a year. At this income and a first year's interest, that comes to ${fmt(deduction)} of deduction. An employer can also pay up to ${fmt(rules!.employerAssistanceMax)} a year toward your loans tax-free, if it offers to.`,
      }),
    );
    resultContainer.replaceChildren(...nodes);
  }

  function recompute(): void {
    fields = {
      balance: parseNonNegative(balInput.value, 0),
      rate: parseNonNegative(rateInput.value, 0),
      agi: parseNonNegative(agiInput.value, 0),
      deps: Math.min(12, Math.round(parseNonNegative(depsInput.value, 0))),
      size: Math.max(1, Math.min(20, Math.round(parseNonNegative(sizeInput.value, 1)))),
      growth: Math.min(10, parseNonNegative(growthInput.value, 0)),
      newLoan: newBox.checked,
      new2014: n14Box.checked,
      joint: jointBox.checked,
      current: curSelect.value,
    };
    ctx.setParams(writeFields(fields));
    compute();
  }

  for (const i of [balInput, rateInput, agiInput, depsInput, sizeInput, growthInput])
    i.addEventListener("input", recompute);
  for (const c of [newBox, n14Box, jointBox, curSelect]) c.addEventListener("change", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    balInput.value = String(fields.balance);
    rateInput.value = String(fields.rate);
    agiInput.value = String(fields.agi);
    depsInput.value = String(fields.deps);
    sizeInput.value = String(fields.size);
    growthInput.value = String(fields.growth);
    newBox.checked = fields.newLoan;
    n14Box.checked = fields.new2014;
    jointBox.checked = fields.joint;
    curSelect.value = fields.current;
    recompute();
  });

  root.append(
    el(
      "form",
      { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
      field("Total federal loan balance", balInput),
      field("Average interest rate (%)", rateInput),
      field("Adjusted gross income", agiInput),
      field("Dependents you claim", depsInput),
      field("Family size", sizeInput),
      field("Yearly income growth (%)", growthInput),
      field("Any federal loan made on or after July 1, 2026", newBox),
      field("First borrowed on or after July 1, 2014", n14Box),
      field("Married filing jointly", jointBox),
      field("The plan you repay under now", curSelect),
      el("div", { class: "tile-form-actions" }, tryExample),
    ),
    resultContainer,
  );
  compute();
}
