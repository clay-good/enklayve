/**
 * Take-Home Pay tile (BUILD-SPEC.md §3.1) — the first tile, built to exercise
 * the whole shell: it reads its state from the URL fragment, computes through
 * the deterministic tax engine, shows every line with its citation, and offers
 * a worked example (§2 principle 6). The other Pillar 1 tiles in Phase 5 follow
 * this exact pattern.
 */
import { Money } from "../engine/money";
import { evaluateTaxes, type TaxInput, type TaxResult } from "../engine/tax";
import type { DeductionMode } from "../engine/tax/types";
import type { FilingStatus } from "../data/schemas";
import { el, option } from "../ui/dom";
import { field, parseNonNegative, pct, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import type { TileContext, TileDefinition } from "./types";

const FILING_STATUSES: { value: FilingStatus; label: string }[] = [
  { value: "single", label: "Single" },
  { value: "married_jointly", label: "Married filing jointly" },
  { value: "married_separately", label: "Married filing separately" },
  { value: "head_of_household", label: "Head of household" },
  { value: "qualifying_surviving_spouse", label: "Qualifying surviving spouse" },
];

const DEDUCTION_MODES: { value: DeductionMode; label: string }[] = [
  { value: "auto", label: "Larger of standard / itemized" },
  { value: "standard", label: "Standard deduction" },
  { value: "itemized", label: "Itemized (big four)" },
];

interface Fields {
  fs: FilingStatus;
  st: string; // state code, or "" for federal-only
  wages: number;
  other: number;
  adjustments: number;
  dm: DeductionMode;
  local: string[]; // selected local add-on ids
}

const EXAMPLE: Fields = {
  fs: "single",
  st: "ca",
  wages: 85000,
  other: 0,
  adjustments: 0,
  dm: "auto",
  local: [],
};

function isFilingStatus(v: string): v is FilingStatus {
  return FILING_STATUSES.some((f) => f.value === v);
}
function isDeductionMode(v: string): v is DeductionMode {
  return DEDUCTION_MODES.some((d) => d.value === v);
}

function readFields(params: URLSearchParams, defaultState: string): Fields {
  const fsRaw = params.get("fs");
  const dmRaw = params.get("dm");
  const stRaw = params.get("st");
  return {
    fs: fsRaw && isFilingStatus(fsRaw) ? fsRaw : "single",
    st: stRaw === null ? defaultState : stRaw,
    wages: parseNonNegative(params.get("w"), 0),
    other: parseNonNegative(params.get("oi"), 0),
    adjustments: parseNonNegative(params.get("adj"), 0),
    dm: dmRaw && isDeductionMode(dmRaw) ? dmRaw : "auto",
    local: (params.get("loc") ?? "").split(",").filter((s) => s.length > 0),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("fs", f.fs);
  p.set("st", f.st);
  p.set("w", String(f.wages));
  if (f.other > 0) p.set("oi", String(f.other));
  if (f.adjustments > 0) p.set("adj", String(f.adjustments));
  if (f.dm !== "auto") p.set("dm", f.dm);
  if (f.local.length > 0) p.set("loc", f.local.join(","));
  return p;
}

function buildBreakdown(result: TaxResult, locale: string): BreakdownLine[] {
  const fmt = (m: Money): string => m.format(locale);
  const lines: BreakdownLine[] = [
    { label: "Gross income", value: fmt(result.grossIncome) },
    {
      label: `Federal income tax (${result.federal.deduction.kind} deduction)`,
      value: fmt(result.federal.incomeTax),
      citation: result.federal.citation,
    },
    {
      label: "Social Security (FICA)",
      value: fmt(result.fica.socialSecurity),
      citation: result.fica.citation,
    },
    { label: "Medicare (FICA)", value: fmt(result.fica.medicare), citation: result.fica.citation },
  ];
  if (result.fica.additionalMedicare.greaterThan(0)) {
    lines.push({
      label: "Additional Medicare",
      value: fmt(result.fica.additionalMedicare),
      citation: result.fica.citation,
    });
  }
  if (result.state && result.state.incomeTax.greaterThan(0)) {
    lines.push({
      label: `${result.state.jurisdictionName} income tax`,
      value: fmt(result.state.incomeTax),
      citation: result.state.citation,
    });
  }
  for (const line of result.local.lines) {
    lines.push({
      label: `${line.name} local tax`,
      value: fmt(line.tax),
      citation: result.local.citation,
    });
  }
  lines.push({ label: "Total tax", value: fmt(result.totals.totalTax), emphasis: true });
  lines.push({ label: "Effective rate", value: pct(result.totals.effectiveRate) });
  lines.push({ label: "Marginal rate (next dollar)", value: pct(result.totals.marginalRate) });
  return lines;
}

export function mountTakeHome(ctx: TileContext): void {
  const { root, data } = ctx;
  root.replaceChildren();

  if (!data) {
    root.append(el("p", { class: "tile-error", text: "Tax data could not be loaded." }));
    return;
  }
  const federal = data.federal();
  const fica = data.fica();
  if (!federal || !fica) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "Federal tax data is unavailable — verify before relying on any figure.",
      }),
    );
    return;
  }

  // `data`, `federal`, and `fica` are non-null past the guards above; capture
  // them as locals so the nested closures keep the narrowed (non-null) types.
  const bundled = data;
  const fed = federal;
  const ficaData = fica;
  const codes = bundled.stateCodes();
  const defaultState = codes.includes("ca") ? "ca" : (codes[0] ?? "");
  let fields = readFields(ctx.params, defaultState);

  // --- Controls ---
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
      const j = bundled.state(code);
      return option(code, j ? j.name : code.toUpperCase(), code === fields.st);
    }),
  );

  const wagesInput = el("input", {
    type: "number",
    name: "w",
    min: 0,
    step: 1000,
    value: fields.wages,
    attrs: { "aria-label": "Annual wages", inputmode: "decimal" },
  });
  const otherInput = el("input", {
    type: "number",
    name: "oi",
    min: 0,
    step: 500,
    value: fields.other,
    attrs: { "aria-label": "Other income", inputmode: "decimal" },
  });
  const adjInput = el("input", {
    type: "number",
    name: "adj",
    min: 0,
    step: 500,
    value: fields.adjustments,
    attrs: { "aria-label": "Pre-tax adjustments", inputmode: "decimal" },
  });
  const dmSelect = el(
    "select",
    { name: "dm", attrs: { "aria-label": "Deduction method" } },
    ...DEDUCTION_MODES.map((d) => option(d.value, d.label, d.value === fields.dm)),
  );

  const localContainer = el("div", { class: "local-addons" });
  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function renderLocalAddOns(): void {
    localContainer.replaceChildren();
    const state = fields.st ? bundled.state(fields.st) : null;
    const addOns = state?.localAddOns ?? [];
    if (addOns.length === 0) return;
    localContainer.append(el("p", { class: "field-group-label", text: "Local taxes" }));
    for (const addOn of addOns) {
      const cb = el("input", {
        type: "checkbox",
        name: `loc-${addOn.id}`,
        checked: fields.local.includes(addOn.id),
        attrs: { "aria-label": addOn.name },
        on: { change: () => recompute() },
      });
      cb.id = `loc-${addOn.id}`;
      localContainer.append(
        el("label", { class: "checkbox" }, cb, el("span", { text: addOn.name })),
      );
    }
  }

  function collect(): void {
    fields = {
      fs: isFilingStatus(fsSelect.value) ? fsSelect.value : "single",
      st: stSelect.value,
      wages: parseNonNegative(wagesInput.value, 0),
      other: parseNonNegative(otherInput.value, 0),
      adjustments: parseNonNegative(adjInput.value, 0),
      dm: isDeductionMode(dmSelect.value) ? dmSelect.value : "auto",
      local: Array.from(localContainer.querySelectorAll<HTMLInputElement>("input:checked")).map(
        (cb) => cb.name.replace(/^loc-/, ""),
      ),
    };
  }

  function compute(): void {
    const input: TaxInput = {
      filingStatus: fields.fs,
      wages: fields.wages,
      otherIncome: fields.other,
      adjustments: fields.adjustments,
      deductionMode: fields.dm,
      localJurisdictionIds: fields.local,
    };
    const state = fields.st ? (bundled.state(fields.st) ?? undefined) : undefined;
    const result = evaluateTaxes(input, { federal: fed, fica: ficaData, state });

    resultContainer.replaceChildren(
      resultCard({
        label: "Annual take-home pay",
        value: result.totals.takeHome,
        locale: ctx.locale,
        breakdown: buildBreakdown(result, ctx.locale),
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function recompute(): void {
    collect();
    renderLocalAddOns();
    ctx.setParams(writeFields(fields));
    compute();
  }

  for (const control of [fsSelect, stSelect, dmSelect]) {
    control.addEventListener("change", recompute);
  }
  for (const input of [wagesInput, otherInput, adjInput]) {
    input.addEventListener("input", recompute);
  }

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    fsSelect.value = fields.fs;
    stSelect.value = fields.st;
    wagesInput.value = String(fields.wages);
    otherInput.value = String(fields.other);
    adjInput.value = String(fields.adjustments);
    dmSelect.value = fields.dm;
    recompute();
  });

  const form = el(
    "form",
    {
      class: "tile-form",
      on: { submit: (e) => e.preventDefault() },
    },
    field("Filing status", fsSelect),
    field("State", stSelect),
    field("Annual wages", wagesInput),
    field("Other income", otherInput),
    field("Pre-tax adjustments", adjInput),
    field("Deduction method", dmSelect),
    localContainer,
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  renderLocalAddOns();
  compute();
}

export const takeHomeTile: TileDefinition = {
  id: "take-home",
  title: "Take-Home Pay",
  pillar: "take-home",
  description:
    "Your real paycheck after federal, FICA, state, and local taxes — across all states.",
  keywords: ["paycheck", "net pay", "salary", "withholding", "fica", "state tax"],
  status: "ready",
  mount: mountTakeHome,
};
