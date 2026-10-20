/**
 * Is the Second Income Worth It?, the interactive half (SPEC-5 Phase 31).
 * Loaded on first use with the dependent care shard; the definition in
 * `secondIncome.ts` stays in the shell. Every figure comes through the engine
 * it came from and cites that engine's shard (SPEC-5 §4, addition 12).
 */
import { Money, allocateRounded } from "../engine/money";
import type { CliffData } from "../engine/cliffs";
import { secondIncome } from "../engine/secondIncome";
import type { FilingStatus } from "../data/schemas";
import { fplRegionFor } from "../data/usStates";
import { el, option } from "../ui/dom";
import { NO_STATE_OPTION_LABEL, field, parseNonNegative, pct, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import { unmodeledBlock } from "./benefitCliffs";
import type { TileContext } from "./types";

const STATUSES: { value: FilingStatus; label: string }[] = [
  { value: "married_jointly", label: "Married filing jointly" },
  { value: "head_of_household", label: "Head of household" },
  { value: "single", label: "Single" },
  { value: "married_separately", label: "Married filing separately" },
  { value: "qualifying_surviving_spouse", label: "Qualifying surviving spouse" },
];

interface Fields {
  fs: FilingStatus;
  st: string;
  size: number;
  kids: number;
  prem: number;
  first: number;
  second: number;
  care: number;
  cost: number;
}

const EXAMPLE: Fields = {
  fs: "married_jointly",
  st: "ca",
  size: 4,
  kids: 2,
  prem: 0,
  first: 42000,
  second: 24000,
  care: 14000,
  cost: 150,
};

function readFields(p: URLSearchParams, ctx: TileContext): Fields {
  const profile = ctx.profile;
  const fs = p.get("fs") ?? profile.get("filingStatus") ?? "married_jointly";
  const num = (key: string, fallback: number) =>
    p.has(key) ? parseNonNegative(p.get(key), fallback) : fallback;
  return {
    fs: STATUSES.find((s) => s.value === fs)?.value ?? "married_jointly",
    st: p.get("st") ?? profile.get("stateCode") ?? "",
    size: Math.max(1, Math.round(num("size", profile.get("householdSize") ?? 4))),
    kids: Math.min(10, Math.round(num("kids", profile.get("qualifyingChildren") ?? 2))),
    prem: num("prem", 0),
    first: num("inc", profile.get("annualIncome") ?? 0),
    second: num("sec", 0),
    care: num("care", profile.get("dependentCareExpensesAnnual") ?? 0),
    cost: num("cost", 0),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("fs", f.fs);
  p.set("st", f.st);
  p.set("size", String(f.size));
  p.set("kids", String(f.kids));
  p.set("prem", String(f.prem));
  p.set("inc", String(f.first));
  p.set("sec", String(f.second));
  p.set("care", String(f.care));
  p.set("cost", String(f.cost));
  return p;
}

export function mountSecondIncome(ctx: TileContext): void {
  const { root, data } = ctx;
  root.replaceChildren();
  const federal = data?.federal();
  const fica = data?.fica();
  if (!data || !federal || !fica) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "Federal tax data is unavailable, so nothing is computed. Verify before relying on any figure.",
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
  const fsSelect = el(
    "select",
    { name: "fs", attrs: { "aria-label": "Filing status" } },
    ...STATUSES.map((s) => option(s.value, s.label, s.value === fields.fs)),
  );
  fsSelect.value = fields.fs;
  const stSelect = el(
    "select",
    { name: "st", attrs: { "aria-label": "State" } },
    option("", NO_STATE_OPTION_LABEL, fields.st === ""),
    ...data.stateCodes().map((code) => {
      const j = data.state(code);
      return option(code, j ? j.name : code.toUpperCase(), code === fields.st);
    }),
  );
  stSelect.value = fields.st;
  const sizeInput = num("size", fields.size, "Household size", 1);
  const kidsInput = num("kids", fields.kids, "Children who qualify for credits", 1);
  const firstInput = num("inc", fields.first, "Household wages now", 1000);
  const secondInput = num("sec", fields.second, "The second job's yearly pay", 1000);
  const careInput = num("care", fields.care, "Childcare the job needs, a year", 500);
  const costInput = num("cost", fields.cost, "Other costs of working, a month", 25);
  const premInput = num("prem", fields.prem, "Benchmark silver monthly premium", 25);

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    if (fields.second <= 0) {
      resultContainer.replaceChildren(
        el("p", { class: "si-none", text: "Enter the second job's yearly pay to compare." }),
      );
      return;
    }
    const region = fields.st ? fplRegionFor(fields.st) : "contiguous";
    const state = fields.st ? (data!.state(fields.st) ?? undefined) : undefined;
    const cliffData: CliffData = {
      tax: { federal: federal!, fica: fica!, ...(state ? { state } : {}) },
      fpl: data!.fpl(region),
      eitcCtc: data!.eitcCtc(),
      aca: data!.aca(),
      snap: data!.snap(),
      medicaid: data!.medicaid(),
      snapRegionSupported: region === "contiguous",
    };
    const careRules = data!.dependentCare();
    const r = secondIncome(
      {
        firstIncome: fields.first,
        secondIncome: fields.second,
        careAnnual: fields.care,
        workCostsMonthly: fields.cost,
      },
      {
        filingStatus: fields.fs,
        householdSize: fields.size,
        qualifyingChildren: fields.kids,
        stateCode: fields.st,
        benchmarkMonthlyPremium: fields.prem,
      },
      cliffData,
      careRules,
    );
    const fmt = (n: number): string => Money.from(n).format(ctx.locale);
    // The amounts the reader typed are printed exactly; the three derived rows
    // share what is left of the rounded total by largest remainder, so the
    // column adds up to the cent, as the Marginal Reality Rate's does.
    const typed = fields.second - fields.care - 12 * fields.cost;
    const [lostToTax, benefits, relief] = allocateRounded(
      [
        Money.from(r.reality.taxDelta - fields.second),
        Money.from(r.reality.benefitDelta),
        // A row that is not shown takes no cent.
        ...(r.careRoute ? [Money.from(r.careRelief)] : []),
      ],
      Money.from(r.netGain).subtract(Money.from(typed).roundToCents()),
    );
    const lines: BreakdownLine[] = [
      { label: "The second paycheck", value: fmt(fields.second) },
      {
        label: "Lost to tax, Social Security and Medicare",
        value: fmt(lostToTax!.toNumber()),
        citation: federal!.citation,
      },
      {
        label: "Change in credits, ACA help and SNAP",
        value: fmt(benefits!.toNumber()),
        citation: data!.eitcCtc()?.citation ?? null,
      },
      { label: "Childcare the job needs", value: fmt(-fields.care) },
    ];
    if (r.careRoute)
      lines.push({
        label:
          r.careRoute === "fsa"
            ? "Back through a dependent care FSA"
            : "Back through the dependent care credit",
        value: fmt(relief!.toNumber()),
        citation: careRules?.citation ?? null,
      });
    lines.push(
      { label: "Other costs of working", value: fmt(-12 * fields.cost) },
      { label: "What the job adds, a year", value: fmt(r.netGain), emphasis: true },
      { label: "Share of the paycheck that does not reach you", value: pct(r.effectiveRate) },
    );
    if (r.reality.medicaidFlip)
      lines.push({
        label: "Medicaid eligibility",
        value: "Ends with the second income — coverage change, not priced",
        citation: data!.medicaid()?.citation ?? null,
      });
    const nodes: HTMLElement[] = [];
    if (r.netGain < 0)
      nodes.push(
        el("div", {
          class: "verify-banner",
          attrs: { role: "status" },
          text: `At these figures the job leaves the household ${fmt(Math.abs(r.netGain))} a year worse off. That is not a mistake in the math. It is how childcare and the phase-outs stack at this income.`,
        }),
      );
    nodes.push(
      resultCard({
        label: "What the second income adds, a month",
        value: Money.from(r.netGain / 12).roundToCents(),
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
      unmodeledBlock(r.unmodeled),
    );
    resultContainer.replaceChildren(...nodes);
  }

  function recompute(): void {
    fields = {
      fs: STATUSES.find((s) => s.value === fsSelect.value)?.value ?? fields.fs,
      st: stSelect.value,
      size: Math.max(1, Math.round(parseNonNegative(sizeInput.value, 1))),
      kids: Math.min(10, Math.round(parseNonNegative(kidsInput.value, 0))),
      prem: parseNonNegative(premInput.value, 0),
      first: parseNonNegative(firstInput.value, 0),
      second: parseNonNegative(secondInput.value, 0),
      care: parseNonNegative(careInput.value, 0),
      cost: parseNonNegative(costInput.value, 0),
    };
    ctx.setParams(writeFields(fields));
    ctx.profile.set("dependentCareExpensesAnnual", fields.care);
    compute();
  }

  for (const i of [sizeInput, kidsInput, firstInput, secondInput, careInput, costInput, premInput])
    i.addEventListener("input", recompute);
  for (const c of [fsSelect, stSelect]) c.addEventListener("change", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    fsSelect.value = fields.fs;
    stSelect.value = fields.st;
    sizeInput.value = String(fields.size);
    kidsInput.value = String(fields.kids);
    premInput.value = String(fields.prem);
    firstInput.value = String(fields.first);
    secondInput.value = String(fields.second);
    careInput.value = String(fields.care);
    costInput.value = String(fields.cost);
    recompute();
  });

  root.append(
    el(
      "form",
      { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
      field("Filing status", fsSelect),
      field("State", stSelect),
      field("Household size", sizeInput),
      field("Children who qualify for credits", kidsInput),
      field("Household wages now", firstInput),
      field("The second job's yearly pay", secondInput),
      field("Childcare the job needs, a year", careInput),
      field("Other costs of working, a month", costInput),
      field("Benchmark silver monthly premium (optional)", premInput),
      el("div", { class: "tile-form-actions" }, tryExample),
    ),
    resultContainer,
  );
  compute();
}
