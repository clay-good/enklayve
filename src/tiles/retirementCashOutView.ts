/**
 * Cashing Out a 401(k), the interactive half (SPEC-5 Phase 28). Loaded on
 * first use with its shard; the definition in `retirementCashOut.ts` stays in
 * the shell. The income tax comes from the tax engine and cites the federal
 * and state jurisdictions; the clock comes from the enrollment-windows shard.
 */
import { Money } from "../engine/money";
import { compoundGrowth } from "../engine/finance";
import { earlyDistributionCost, incomeTaxOnDistribution } from "../engine/earlyDistribution";
import { enrollmentWindows } from "../engine/sequences";
import type { FilingStatus } from "../data/schemas";
import { US_STATES, stateName } from "../data/usStates";
import { el, option } from "../ui/dom";
import {
  assumptionHint,
  field,
  parseNonNegative,
  parseNumber,
  pct,
  tryExampleButton,
} from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import { renderDeadline, todayIso } from "../ui/deadline";
import type { TileContext } from "./types";

const FILING_STATUSES: { value: FilingStatus; label: string }[] = [
  { value: "single", label: "Single" },
  { value: "married_jointly", label: "Married filing jointly" },
  { value: "married_separately", label: "Married filing separately" },
  { value: "head_of_household", label: "Head of household" },
  { value: "qualifying_surviving_spouse", label: "Qualifying surviving spouse" },
];

const RETURN_BAND = { low: -15, high: 15, label: "Real return after inflation" };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The checklist, each an exception the reader ticks and the tile never infers. */
const WHOLE = [
  { key: "dis", label: "You are disabled, as the Code defines it" },
  { key: "sepp", label: "It is one of a series of substantially equal payments" },
  { key: "term", label: "A physician has certified a terminal illness" },
  { key: "qdro", label: "You receive it under a divorce order (QDRO)" },
] as const;

interface Fields {
  amount: number;
  age: number;
  fs: FilingStatus;
  st: string;
  other: number;
  sep55: boolean;
  sep50: boolean;
  whole: Set<string>;
  emergency: boolean;
  otherExcepted: number;
  received: string;
  retireAge: number;
  realReturnPct: number;
}

const EXAMPLE: Fields = {
  amount: 20000,
  age: 40,
  fs: "single",
  st: "TX",
  other: 60000,
  sep55: false,
  sep50: false,
  whole: new Set(),
  emergency: false,
  otherExcepted: 0,
  received: "",
  retireAge: 65,
  realReturnPct: 5,
};

function isFilingStatus(v: string): v is FilingStatus {
  return FILING_STATUSES.some((f) => f.value === v);
}

function readFields(p: URLSearchParams, ctx: TileContext): Fields {
  const fs = p.get("fs");
  const st = (p.get("st") ?? ctx.profile.get("stateCode") ?? "").toUpperCase();
  const rec = p.get("rec") ?? "";
  return {
    amount: parseNonNegative(p.get("amt"), 0),
    age: Math.min(120, parseNonNegative(p.get("age"), 40)),
    fs: fs && isFilingStatus(fs) ? fs : (ctx.profile.get("filingStatus") ?? "single"),
    st: US_STATES.some((s) => s.code === st) ? st : "TX",
    other: p.has("oth")
      ? parseNonNegative(p.get("oth"), 0)
      : (ctx.profile.get("annualIncome") ?? 0),
    sep55: p.get("s55") === "1",
    sep50: p.get("s50") === "1",
    whole: new Set(WHOLE.map((w) => w.key).filter((k) => p.get(k) === "1")),
    emergency: p.get("em") === "1",
    otherExcepted: parseNonNegative(p.get("ex"), 0),
    received: DATE.test(rec) ? rec : "",
    retireAge: Math.min(100, parseNonNegative(p.get("ra"), 65)),
    realReturnPct: parseNumber(p.get("rr"), 5),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("amt", String(f.amount));
  p.set("age", String(f.age));
  p.set("fs", f.fs);
  p.set("st", f.st);
  p.set("oth", String(f.other));
  if (f.sep55) p.set("s55", "1");
  if (f.sep50) p.set("s50", "1");
  for (const k of f.whole) p.set(k, "1");
  if (f.emergency) p.set("em", "1");
  if (f.otherExcepted > 0) p.set("ex", String(f.otherExcepted));
  if (f.received) p.set("rec", f.received);
  p.set("ra", String(f.retireAge));
  p.set("rr", String(f.realReturnPct));
  return p;
}

export function mountRetirementCashOut(ctx: TileContext): void {
  const { root, data } = ctx;
  root.replaceChildren();
  const rules = data?.earlyDistribution();
  const fed = data?.federal();
  const fica = data?.fica();
  const windows = data?.enrollmentWindows();
  if (!rules || !fed || !fica || !windows) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "The rules for an early distribution are unavailable, so no figure is given. Your plan's rollover notice states the withholding.",
      }),
    );
    return;
  }
  const rollover = enrollmentWindows(windows).find((w) => w.id === "rollover-60-day");
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
  const amountInput = num("amt", fields.amount, "Amount you would take out", 1000);
  const ageInput = num("age", fields.age, "Your age when you take it", 1);
  const fsSelect = el(
    "select",
    { name: "fs", attrs: { "aria-label": "Filing status" } },
    ...FILING_STATUSES.map((s) => option(s.value, s.label, s.value === fields.fs)),
  );
  const stSelect = el(
    "select",
    { name: "st", attrs: { "aria-label": "State you live in" } },
    ...US_STATES.map((s) => option(s.code, s.name, s.code === fields.st)),
  );
  const otherInput = num("oth", fields.other, "Other income this year", 1000);
  const sep55Box = box(
    "s55",
    "You left this employer in or after the year you turned 55",
    fields.sep55,
  );
  const sep50Box = box(
    "s50",
    "A public-safety worker who left in or after the year you turned 50",
    fields.sep50,
  );
  const wholeBoxes = WHOLE.map((w) => box(w.key, w.label, fields.whole.has(w.key)));
  const emergencyBox = box(
    "em",
    "Your one emergency personal expense withdrawal this year",
    fields.emergency,
  );
  const exceptedInput = num(
    "ex",
    fields.otherExcepted,
    "Amount another exception covers (medical, domestic abuse, birth or adoption)",
    100,
  );
  const receivedInput = el("input", {
    type: "date",
    name: "rec",
    value: fields.received,
    attrs: { "aria-label": "Date you received it, for the rollover clock" },
  });
  const retireInput = num("ra", fields.retireAge, "Age you would otherwise leave it until", 1);
  const returnInput = el("input", {
    type: "number",
    name: "rr",
    step: 0.5,
    value: fields.realReturnPct,
    attrs: { "aria-label": "Real return after inflation (percent)", inputmode: "decimal" },
  });

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const state = data!.state(fields.st.toLowerCase());
    const tax = incomeTaxOnDistribution(
      fields.amount,
      { filingStatus: fields.fs, wages: fields.other },
      { federal: fed!, fica: fica!, ...(state ? { state } : {}) },
    );
    const r = earlyDistributionCost(
      {
        amount: fields.amount,
        age: fields.age,
        separatedAtSeparationAge: fields.sep55,
        publicSafetySeparation: fields.sep50,
        wholeException: fields.whole.size > 0,
        emergency: fields.emergency,
        otherExcepted: fields.otherExcepted,
        federalTax: tax.federal,
        stateTax: tax.state,
      },
      rules!,
    );
    const fmt = (m: Money): string => m.format(ctx.locale);
    const cite = rules!.citation;
    const due = r.federalDueAtFiling;
    const lines: BreakdownLine[] = [
      { label: "Withheld for federal tax when it is paid", value: fmt(r.withheld), citation: cite },
      { label: "The check you receive", value: fmt(r.check) },
      {
        label: "Federal income tax it adds, on top of your other income",
        value: fmt(r.federalTax),
        citation: fed!.citation,
      },
      {
        label: `${stateName(fields.st)} income tax it adds`,
        value: fmt(r.stateTax),
        ...(state ? { citation: state.citation } : {}),
      },
      {
        label:
          r.noAdditionalTaxBecause === "age"
            ? "Additional tax: none at your age"
            : r.noAdditionalTaxBecause === "separation"
              ? "Additional tax: none, because you left this employer at the age the Code names"
              : r.noAdditionalTaxBecause === "exception"
                ? "Additional tax: none, under the exception you ticked"
                : "Additional tax on an early distribution",
        value: fmt(r.additionalTax),
        citation: cite,
      },
      { label: "Every tax it costs", value: fmt(r.totalCost), emphasis: true },
      {
        label: due.isNegative()
          ? "Federal refund at filing, since more was withheld than it costs"
          : "Federal balance due at filing, after the withholding",
        value: fmt(due.isNegative() ? due.multiply(-1) : due),
        emphasis: !due.isNegative(),
      },
    ];
    const years = Math.max(0, fields.retireAge - fields.age);
    const grown = compoundGrowth({
      principal: fields.amount,
      contribution: 0,
      annualRate: fields.realReturnPct / 100,
      years,
      periodsPerYear: 12,
    });
    if (years > 0)
      lines.push({
        label: `Left invested to age ${fields.retireAge} at ${pct(fields.realReturnPct / 100, 1)} a year after inflation, it would be (an assumption you set)`,
        value: fmt(grown.futureValue),
      });

    const after: HTMLElement[] = [];
    const hint = years > 0 ? assumptionHint(fields.realReturnPct, RETURN_BAND) : null;
    if (hint) after.push(hint);
    after.push(
      el("p", {
        class: "rco-rollover",
        text: `To undo it, roll the whole amount into an IRA or a new plan within the window below. You must make up the ${fmt(r.withheld)} withheld from other money to roll over all of it; any part not rolled over is taxed, and before 59½ costs the additional tax too. A direct rollover, which your plan's rollover notice describes, skips both the withholding and the clock.`,
      }),
    );
    if (rollover)
      after.push(
        renderDeadline(rollover.deadline, {
          asOf: todayIso(),
          locale: ctx.locale,
          ...(fields.received ? { triggerDate: fields.received } : {}),
        }),
      );
    resultContainer.replaceChildren(
      resultCard({
        label: "What you keep after every tax",
        value: r.kept,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
      ...after,
    );
  }

  function recompute(): void {
    const rec = receivedInput.value;
    fields = {
      amount: parseNonNegative(amountInput.value, 0),
      age: Math.min(120, parseNonNegative(ageInput.value, 40)),
      fs: isFilingStatus(fsSelect.value) ? fsSelect.value : fields.fs,
      st: stSelect.value || fields.st,
      other: parseNonNegative(otherInput.value, 0),
      sep55: sep55Box.checked,
      sep50: sep50Box.checked,
      whole: new Set(WHOLE.filter((_, i) => wholeBoxes[i]!.checked).map((w) => w.key)),
      emergency: emergencyBox.checked,
      otherExcepted: parseNonNegative(exceptedInput.value, 0),
      received: DATE.test(rec) ? rec : "",
      retireAge: Math.min(100, parseNonNegative(retireInput.value, 65)),
      realReturnPct: parseNumber(returnInput.value, 5),
    };
    ctx.setParams(writeFields(fields));
    compute();
  }

  for (const i of [amountInput, ageInput, otherInput, exceptedInput, retireInput, returnInput])
    i.addEventListener("input", recompute);
  for (const c of [
    fsSelect,
    stSelect,
    sep55Box,
    sep50Box,
    ...wholeBoxes,
    emergencyBox,
    receivedInput,
  ])
    c.addEventListener("change", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE, whole: new Set() };
    amountInput.value = String(fields.amount);
    ageInput.value = String(fields.age);
    fsSelect.value = fields.fs;
    stSelect.value = fields.st;
    otherInput.value = String(fields.other);
    for (const b of [sep55Box, sep50Box, ...wholeBoxes, emergencyBox]) b.checked = false;
    exceptedInput.value = "0";
    receivedInput.value = "";
    retireInput.value = String(fields.retireAge);
    returnInput.value = String(fields.realReturnPct);
    recompute();
  });

  root.append(
    el(
      "form",
      { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
      field("Amount you would take out", amountInput),
      field("Your age when you take it", ageInput),
      field("Filing status", fsSelect),
      field("State you live in", stSelect),
      field("Other income this year", otherInput),
      el("p", { class: "rco-hint", text: "Tick any exception that applies to you:" }),
      field("You left this employer in or after the year you turned 55", sep55Box),
      field("A public-safety worker who left in or after the year you turned 50", sep50Box),
      ...WHOLE.map((w, i) => field(w.label, wholeBoxes[i]!)),
      field("Your one emergency personal expense withdrawal this year", emergencyBox),
      field(
        "Amount another exception covers (medical, domestic abuse, birth or adoption)",
        exceptedInput,
      ),
      field("Date you received it (optional, for the rollover clock)", receivedInput),
      field("Age you would otherwise leave it until", retireInput),
      field("Real return after inflation (%)", returnInput),
      el("div", { class: "tile-form-actions" }, tryExample),
    ),
    resultContainer,
  );
  compute();
}
