/**
 * Marginal Rate Explorer (BUILD-SPEC.md §3.2): answers "what does my next
 * $1,000 of income actually cost me?" across federal income tax, FICA, and
 * state. It evaluates the engine at the current income and at income + the
 * step, then attributes the difference to each layer — every line cited.
 */
import { Money } from "../engine/money";
import { evaluateTaxes, type TaxInput, type TaxResult } from "../engine/tax";
import type { FilingStatus } from "../data/schemas";
import { el, option } from "../ui/dom";
import { field, parseNonNegative, pct, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import { rememberShared } from "./profileSync";
import type { SituationStore } from "../profile/situation";
import type { TileContext, TileDefinition } from "./types";

const FILING_STATUSES: { value: FilingStatus; label: string }[] = [
  { value: "single", label: "Single" },
  { value: "married_jointly", label: "Married filing jointly" },
  { value: "married_separately", label: "Married filing separately" },
  { value: "head_of_household", label: "Head of household" },
  { value: "qualifying_surviving_spouse", label: "Qualifying surviving spouse" },
];

interface Fields {
  fs: FilingStatus;
  st: string;
  income: number;
  step: number;
}

const EXAMPLE: Fields = { fs: "single", st: "ca", income: 120000, step: 1000 };

function isFilingStatus(v: string): v is FilingStatus {
  return FILING_STATUSES.some((f) => f.value === v);
}

function readFields(p: URLSearchParams, defaultState: string, profile: SituationStore): Fields {
  const fs = p.get("fs");
  const st = p.get("st");
  return {
    // Precedence: URL fragment > session profile > built-in default.
    fs: fs && isFilingStatus(fs) ? fs : (profile.get("filingStatus") ?? "single"),
    st: st !== null ? st : (profile.get("stateCode") ?? defaultState),
    income: p.has("inc") ? parseNonNegative(p.get("inc"), 0) : (profile.get("annualIncome") ?? 0),
    step: Math.max(1, parseNonNegative(p.get("step"), 1000)),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("fs", f.fs);
  p.set("st", f.st);
  p.set("inc", String(f.income));
  p.set("step", String(f.step));
  return p;
}

export function mountMarginalExplorer(ctx: TileContext): void {
  const { root, data } = ctx;
  root.replaceChildren();
  const fed = data?.federal();
  const fica = data?.fica();
  if (!fed || !fica) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "Federal tax data is unavailable — verify before relying on any figure.",
      }),
    );
    return;
  }

  const codes = data!.stateCodes();
  const defaultState = codes.includes("ca") ? "ca" : (codes[0] ?? "");
  let fields = readFields(ctx.params, defaultState, ctx.profile);

  const fsSelect = el(
    "select",
    { name: "fs", attrs: { "aria-label": "Filing status" } },
    ...FILING_STATUSES.map((s) => option(s.value, s.label, s.value === fields.fs)),
  );
  const stSelect = el(
    "select",
    { name: "st", attrs: { "aria-label": "State" } },
    option("", "No state tax modeled", fields.st === ""),
    ...codes.map((code) => {
      const j = data!.state(code);
      return option(code, j ? j.name : code.toUpperCase(), code === fields.st);
    }),
  );
  const incInput = el("input", {
    type: "number",
    name: "inc",
    min: 0,
    step: 1000,
    value: fields.income,
    attrs: { "aria-label": "Current income", inputmode: "decimal" },
  });
  const stepInput = el("input", {
    type: "number",
    name: "step",
    min: 1,
    step: 500,
    value: fields.step,
    attrs: { "aria-label": "Next amount", inputmode: "decimal" },
  });

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function evalAt(income: number): TaxResult {
    const input: TaxInput = { filingStatus: fields.fs, wages: income };
    const state = fields.st ? (data!.state(fields.st) ?? undefined) : undefined;
    return evaluateTaxes(input, { federal: fed!, fica: fica!, state });
  }

  function compute(): void {
    const base = evalAt(fields.income);
    const bumped = evalAt(fields.income + fields.step);
    const fmt = (m: Money): string => m.format(ctx.locale);

    const fedDelta = bumped.federal.incomeTax.subtract(base.federal.incomeTax);
    const ficaDelta = bumped.fica.total.subtract(base.fica.total);
    const stateDelta = (bumped.state?.incomeTax ?? Money.zero()).subtract(
      base.state?.incomeTax ?? Money.zero(),
    );
    const localDelta = bumped.local.total.subtract(base.local.total);
    const totalDelta = bumped.totals.totalTax.subtract(base.totals.totalTax);
    const kept = Money.from(fields.step).subtract(totalDelta);
    const marginalRate = fields.step === 0 ? 0 : totalDelta.divide(fields.step).toNumber();

    const lines: BreakdownLine[] = [
      { label: "Federal income tax", value: fmt(fedDelta), citation: base.federal.citation },
      { label: "FICA", value: fmt(ficaDelta), citation: base.fica.citation },
    ];
    if (base.state) {
      lines.push({
        label: `${base.state.jurisdictionName} income tax`,
        value: fmt(stateDelta),
        citation: base.state.citation,
      });
    }
    if (base.local.lines.length > 0 && base.local.citation) {
      lines.push({ label: "Local tax", value: fmt(localDelta), citation: base.local.citation });
    }
    lines.push({ label: "Total cost of the next dollars", value: fmt(totalDelta), emphasis: true });
    lines.push({ label: "You keep", value: fmt(kept) });
    lines.push({ label: "Combined marginal rate", value: pct(Math.max(0, marginalRate)) });

    resultContainer.replaceChildren(
      resultCard({
        label: `What your next ${Money.from(fields.step).format(ctx.locale)} costs`,
        value: totalDelta,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function collect(): void {
    fields = {
      fs: isFilingStatus(fsSelect.value) ? fsSelect.value : "single",
      st: stSelect.value,
      income: parseNonNegative(incInput.value, 0),
      step: Math.max(1, parseNonNegative(stepInput.value, 1000)),
    };
  }

  function recompute(): void {
    collect();
    ctx.setParams(writeFields(fields));
    rememberShared(ctx.profile, {
      filingStatus: fields.fs,
      stateCode: fields.st,
      annualIncome: fields.income,
    });
    compute();
  }

  for (const c of [fsSelect, stSelect]) c.addEventListener("change", recompute);
  for (const i of [incInput, stepInput]) i.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    fsSelect.value = fields.fs;
    stSelect.value = fields.st;
    incInput.value = String(fields.income);
    stepInput.value = String(fields.step);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Filing status", fsSelect),
    field("State", stSelect),
    field("Current income", incInput),
    field("Next amount", stepInput),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const marginalExplorerTile: TileDefinition = {
  id: "marginal-explorer",
  title: "Marginal Rate Explorer",
  pillar: "take-home",
  description: "What does my next $1,000 of income actually cost?",
  keywords: ["marginal", "next dollar", "bracket", "raise", "rate"],
  status: "ready",
  how: "We run the tax engine twice — at your current income, and again at your income plus the step you choose — then attribute the extra tax to each layer: federal income tax, FICA, and your state. That difference is what your next dollars actually cost you, which is often higher than your bracket alone because several taxes stack.",
  resources: [
    {
      label: "IRS — tax brackets & rates",
      url: "https://www.irs.gov/filing/federal-income-tax-rates-and-brackets",
    },
    {
      label: "SSA — Social Security & Medicare tax rates",
      url: "https://www.ssa.gov/oact/progdata/taxRates.html",
    },
  ],
  mount: mountMarginalExplorer,
};
