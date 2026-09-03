/**
 * Marginal Rate Explorer (BUILD-SPEC.md §3.2): answers "what does my next
 * $1,000 of income actually cost me?" across federal income tax, FICA, and
 * state. It evaluates the engine at the current income and at income + the
 * step, then attributes the difference to each layer — every line cited.
 */
import { Money, allocateRounded } from "../engine/money";
import { evaluateTaxes, type TaxInput, type TaxResult } from "../engine/tax";
import { bracketsFor, statutoryNotches } from "../engine/tax/brackets";
import type { CitationData, FilingStatus } from "../data/schemas";
import { el, option } from "../ui/dom";
import { NO_STATE_OPTION_LABEL, field, parseNonNegative, pct, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import { rememberableCounty, residenceLocalField, seedResidenceLocal } from "../ui/residenceLocal";
import { rememberShared } from "./profileSync";
import type { SituationStore } from "../profile/situation";
import type { TileContext, TileDefinition } from "./types";
import { OBBBA_DEDUCTIONS_NOT_MODELED } from "./deductionCopy";

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
  /**
   * The mandatory residence-based local, when the state has one. Maryland's and
   * Indiana's county taxes are up to 3.3 and 3.0 points of a resident's real
   * marginal rate, and this tile answered without them until 2026-09-02.
   */
  local: string[];
}

const EXAMPLE: Fields = { fs: "single", st: "ca", income: 120000, step: 1000, local: [] };

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
    local: p.getAll("loc"),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("fs", f.fs);
  p.set("st", f.st);
  p.set("inc", String(f.income));
  p.set("step", String(f.step));
  for (const id of f.local) p.append("loc", id);
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
        text: "Federal tax data is unavailable, verify before relying on any figure.",
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
    option("", NO_STATE_OPTION_LABEL, fields.st === ""),
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
    const state = fields.st ? (data!.state(fields.st) ?? undefined) : undefined;
    const input: TaxInput = {
      filingStatus: fields.fs,
      wages: income,
      localJurisdictionIds: fields.local,
    };
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

    // The parts of "Total cost of the next dollars", allocated to it by largest
    // remainder rather than each rounded to itself -- see `allocateRounded`.
    // Rounded independently, federal + FICA + state came to a cent under the
    // total printed beneath them at a $91,913 income, among others.
    const parts: { label: string; amount: Money; citation: CitationData | null }[] = [
      { label: "Federal income tax", amount: fedDelta, citation: base.federal.citation },
      { label: "FICA", amount: ficaDelta, citation: base.fica.citation },
    ];
    if (base.state) {
      parts.push({
        label: `${base.state.jurisdictionName} income tax`,
        amount: stateDelta,
        citation: base.state.citation,
      });
    }
    if (base.local.lines.length > 0) {
      parts.push({ label: "Local tax", amount: localDelta, citation: base.local.citation });
    }
    const shares = allocateRounded(
      parts.map((p) => p.amount),
      totalDelta,
    );
    const lines: BreakdownLine[] = parts.map((p, i) => ({
      label: p.label,
      value: fmt(shares[i]!),
      citation: p.citation,
    }));
    // A step that crosses a point where the SCHEDULE charges a flat amount is
    // the one case where "your marginal rate" is a misleading answer on its own:
    // the number is real, and it is a step rather than a rate, so it does not
    // apply to the next dollar or the one after. Ohio is the only jurisdiction
    // in the repo with one — nothing is owed at or below $26,050 of taxable
    // income and the band above is "$332.00 plus 2.75% of the excess", with the
    // 0% bands below contributing nothing for that $332 to be a restatement of.
    // A filer one dollar over that line owes $332.03 instead of nothing.
    const stateShard = fields.st ? (data!.state(fields.st) ?? null) : null;
    const crossed =
      stateShard && base.state && bumped.state
        ? statutoryNotches(bracketsFor(stateShard, fields.fs)).filter(
            (n) =>
              base.state!.taxableIncome.lessThanOrEqual(n.taxableIncome) &&
              bumped.state!.taxableIncome.greaterThan(n.taxableIncome),
          )
        : [];
    // The threshold is a round statutory figure — "$26,050", the way the Code
    // and the reader both write it. The AMOUNT keeps its cents, because Ohio
    // prints it as "$332.00" and a citation the reader can check against the
    // page should read the way the page does.
    const wholeDollars = (n: number): string =>
      new Intl.NumberFormat(ctx.locale, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(n);

    for (const notch of crossed) {
      lines.push({
        label: `${base.state!.jurisdictionName}'s ${wholeDollars(notch.taxableIncome)} step`,
        value: fmt(Money.from(notch.amount)),
        citation: base.state!.citation,
      });
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
      ...crossed.map((notch) =>
        el("p", {
          class: "statute-step",
          text:
            `Part of that is a step, not a rate. ${base.state!.jurisdictionName} charges ` +
            `${Money.from(notch.amount).format(ctx.locale)} the moment taxable income passes ` +
            `${wholeDollars(notch.taxableIncome)}, so one dollar either side of ` +
            `that line is ${Money.from(notch.amount).format(ctx.locale)} apart — and the dollars ` +
            `after it cost the ordinary rate again. It is the printed schedule, not a phase-out.`,
        }),
      ),
    );
  }

  const localContainer = el("div", { class: "local-addons" });

  /**
   * A mandatory county tax is a fact about where you live, not a question, so it
   * is resolved to the shard's default rather than left empty — an empty
   * selection would silently answer a Maryland resident with 3.2 points missing.
   */
  function renderLocal(): void {
    const state = fields.st ? (data!.state(fields.st) ?? null) : null;
    fields.local = seedResidenceLocal(state, fields.local, ctx.profile);
    localContainer.replaceChildren();
    const county = residenceLocalField(state, fields.local[0], recompute);
    if (county) localContainer.append(county);
  }

  function collect(): void {
    const county = localContainer.querySelector<HTMLSelectElement>("select[name='loc-select']");
    fields = {
      fs: isFilingStatus(fsSelect.value) ? fsSelect.value : "single",
      st: stSelect.value,
      income: parseNonNegative(incInput.value, 0),
      step: Math.max(1, parseNonNegative(stepInput.value, 1000)),
      // A county select that is gone because the state changed must not carry
      // the old state's county into the new state's evaluation.
      local: county && county.value ? [county.value] : [],
    };
  }

  function recompute(): void {
    collect();
    renderLocal();
    ctx.setParams(writeFields(fields));
    rememberShared(ctx.profile, {
      filingStatus: fields.fs,
      stateCode: fields.st,
      county: rememberableCounty(fields.st ? (data!.state(fields.st) ?? null) : null, fields.local),
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
    localContainer,
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  renderLocal();
  compute();
}

export const marginalExplorerTile: TileDefinition = {
  id: "marginal-explorer",
  title: "Marginal Rate Explorer",
  pillar: "paycheck",
  description: "What does my next $1,000 of income actually cost?",
  keywords: ["marginal", "next dollar", "bracket", "raise", "rate"],
  status: "ready",
  how:
    "We run the tax engine twice, at your current income, and again at your income plus the step you choose, then attribute the extra tax to each layer: federal income tax, FICA, your state, and — in Maryland and Indiana, where a county income tax is mandatory rather than optional — the county you live in. That difference is what your next dollars actually cost you, which is often higher than your bracket alone because several taxes stack. Optional local taxes you would have to opt into (New York City, Yonkers, Columbus, Detroit) are not included here; the Take-Home tile is where you choose those.\n\n" +
    OBBBA_DEDUCTIONS_NOT_MODELED,
  resources: [
    {
      label: "IRS, tax brackets & rates",
      url: "https://www.irs.gov/filing/federal-income-tax-rates-and-brackets",
    },
    {
      label: "SSA, Social Security & Medicare tax rates",
      url: "https://www.ssa.gov/oact/progdata/taxRates.html",
    },
  ],
  mount: mountMarginalExplorer,
};
