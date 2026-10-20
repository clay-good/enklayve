/**
 * Child & Dependent Care: Credit or FSA?, the interactive half (SPEC-5
 * Phase 31). Loaded on first use with its shard; the definition in
 * `dependentCare.ts` stays in the shell. Both routes come from the tax engine
 * and cite their shards (SPEC-5 §4, addition 12).
 */
import { Money } from "../engine/money";
import { compareDependentCare } from "../engine/dependentCare";
import type { FilingStatus } from "../data/schemas";
import { US_STATES } from "../data/usStates";
import { el, option } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
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
  wages: number;
  lower: number;
  deemed: boolean;
  kids: number;
  care: number;
  st: string;
}

const EXAMPLE: Fields = {
  fs: "married_jointly",
  wages: 90000,
  lower: 35000,
  deemed: false,
  kids: 2,
  care: 12000,
  st: "TX",
};

function readFields(p: URLSearchParams, ctx: TileContext): Fields {
  const profile = ctx.profile;
  const fs = p.get("fs") ?? profile.get("filingStatus") ?? "married_jointly";
  const st = (p.get("st") ?? profile.get("stateCode") ?? "").toUpperCase();
  return {
    fs: STATUSES.find((s) => s.value === fs)?.value ?? "married_jointly",
    wages: p.has("w") ? parseNonNegative(p.get("w"), 0) : (profile.get("annualIncome") ?? 0),
    lower: parseNonNegative(p.get("lo"), 0),
    deemed: p.get("dm") === "1",
    kids: Math.min(
      10,
      Math.round(
        p.has("kids")
          ? parseNonNegative(p.get("kids"), 1)
          : (profile.get("qualifyingChildren") ?? 1),
      ),
    ),
    care: p.has("care")
      ? parseNonNegative(p.get("care"), 0)
      : (profile.get("dependentCareExpensesAnnual") ?? 0),
    st: US_STATES.some((s) => s.code === st) ? st : "TX",
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("fs", f.fs);
  p.set("w", String(f.wages));
  p.set("lo", String(f.lower));
  if (f.deemed) p.set("dm", "1");
  p.set("kids", String(f.kids));
  p.set("care", String(f.care));
  p.set("st", f.st);
  return p;
}

export function mountDependentCare(ctx: TileContext): void {
  const { root, data } = ctx;
  root.replaceChildren();
  const fed = data?.federal();
  const fica = data?.fica();
  const rules = data?.dependentCare();
  if (!fed || !fica || !rules) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "The tax or dependent care rules are unavailable, so no comparison is given.",
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
  const wagesInput = num("w", fields.wages, "Household wages this year", 1000);
  const lowerInput = num("lo", fields.lower, "The lower earner's wages", 1000);
  const deemedBox = el("input", {
    type: "checkbox",
    name: "dm",
    attrs: { "aria-label": "Spouse is a full-time student or cannot care for themselves" },
  });
  deemedBox.checked = fields.deemed;
  const kidsInput = num("kids", fields.kids, "Children under 13, or others who qualify", 1);
  const careInput = num("care", fields.care, "What you pay for care in a year", 500);
  const stSelect = el(
    "select",
    { name: "st", attrs: { "aria-label": "State you live in" } },
    ...US_STATES.map((s) => option(s.code, s.name, s.code === fields.st)),
  );
  stSelect.value = fields.st;
  const jointOnly = el(
    "div",
    {},
    field("The lower earner's wages", lowerInput),
    field("Spouse is a full-time student or cannot care for themselves", deemedBox),
  );

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    jointOnly.hidden = fields.fs !== "married_jointly";
    if (fields.kids < 1) {
      resultContainer.replaceChildren(
        el("p", {
          class: "dc-none",
          text: "Both routes need at least one child under 13, or a dependent or spouse who cannot care for themselves.",
        }),
      );
      return;
    }
    const state = data!.state(fields.st.toLowerCase());
    const r = compareDependentCare(
      {
        filingStatus: fields.fs,
        wages: fields.wages,
        lowerEarnerWages: fields.lower,
        spouseDeemedEarner: fields.deemed,
        qualifyingIndividuals: fields.kids,
        expenses: fields.care,
      },
      { federal: fed!, fica: fica!, ...(state ? { state } : {}) },
      rules!,
    );
    const fmt = (m: Money): string => m.format(ctx.locale);
    const cite = rules!.citation;
    const c = r.creditOnly;
    const f = r.fsa;
    const lines: BreakdownLine[] = r.creditAllowed
      ? [
          {
            label: `Credit only: ${c.percentage}% of ${fmt(c.creditable)} of care`,
            value: fmt(c.tentative),
            citation: cite,
          },
          {
            label: "Credit only, limited to your federal income tax",
            value: fmt(c.credit),
            emphasis: true,
            citation: fed!.citation,
          },
        ]
      : [
          {
            label: "Credit: not allowed on a separate return",
            value: fmt(Money.zero()),
            citation: cite,
          },
        ];
    lines.push(
      {
        label: `FSA: tax saved on ${fmt(f.excluded)} taken out of pay`,
        value: fmt(f.taxSaving),
        citation: cite,
      },
      {
        label: "of which Social Security and Medicare tax",
        value: fmt(f.ficaSaving),
        citation: fica!.citation,
      },
    );
    // Shown only when the FSA leaves some of the cap: at 2026's figures the
    // $7,500 exclusion is larger than either cap, so it never does.
    if (r.creditAllowed && f.credit.creditable.greaterThan(0))
      lines.push({
        label: `FSA, plus the credit on what the limit has left (${fmt(f.credit.creditable)})`,
        value: fmt(f.credit.credit),
        citation: cite,
      });
    lines.push({ label: "FSA route in all", value: fmt(f.total), emphasis: true });
    const best = r.better === "fsa" ? f.total : c.credit;
    resultContainer.replaceChildren(
      resultCard({
        label: r.better === "fsa" ? "The FSA route saves about" : "The credit saves about",
        value: best,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
      el("p", {
        class: "dc-note",
        text: "An FSA is use-it-or-lose-it, and you choose the amount at your employer's open enrollment. The credit can only cancel tax you owe. It is never a refund.",
      }),
    );
  }

  function recompute(): void {
    fields = {
      fs: STATUSES.find((s) => s.value === fsSelect.value)?.value ?? fields.fs,
      wages: parseNonNegative(wagesInput.value, 0),
      lower: parseNonNegative(lowerInput.value, 0),
      deemed: deemedBox.checked,
      kids: Math.min(10, Math.round(parseNonNegative(kidsInput.value, 0))),
      care: parseNonNegative(careInput.value, 0),
      st: stSelect.value || fields.st,
    };
    ctx.setParams(writeFields(fields));
    ctx.profile.set("dependentCareExpensesAnnual", fields.care);
    compute();
  }

  for (const i of [wagesInput, lowerInput, kidsInput, careInput])
    i.addEventListener("input", recompute);
  for (const c of [fsSelect, stSelect, deemedBox]) c.addEventListener("change", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    fsSelect.value = fields.fs;
    wagesInput.value = String(fields.wages);
    lowerInput.value = String(fields.lower);
    deemedBox.checked = fields.deemed;
    kidsInput.value = String(fields.kids);
    careInput.value = String(fields.care);
    stSelect.value = fields.st;
    recompute();
  });

  root.append(
    el(
      "form",
      { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
      field("Filing status", fsSelect),
      field("Household wages this year", wagesInput),
      jointOnly,
      field("Children under 13, or others who qualify", kidsInput),
      field("What you pay for care in a year", careInput),
      field("State you live in", stSelect),
      el("div", { class: "tile-form-actions" }, tryExample),
    ),
    resultContainer,
  );
  compute();
}
