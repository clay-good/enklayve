/**
 * Benefit Cliffs (SPEC-4 §A1, §A2) — the two Pillar 4 tiles that answer the
 * question every other calculator on this site skips: **if I earn more, am I
 * actually better off?**
 *
 * Both run on `engine/cliffs.ts`, which composes the tax engine with the EITC,
 * Child Tax Credit, ACA premium tax credit, SNAP, and Medicaid engines that
 * already ship. No new dataset: the arithmetic is what was missing, not the data.
 *
 * The tiles are harm tier 1 (informational), but they carry the pillar's honesty
 * obligations in full — every program left out is named on screen, and losing
 * Medicaid is shown as a status change rather than converted into dollars we
 * cannot source.
 */
import { Money } from "../engine/money";
import { marginalReality, sweepResources, type CliffData, type CliffInput } from "../engine/cliffs";
import { fplRegionFor } from "../data/usStates";
import type { FilingStatus } from "../data/schemas";
import type { BundledData } from "../data/browser";
import { el, option } from "../ui/dom";
import { NO_STATE_OPTION_LABEL, field, parseNonNegative, pct, tryExampleButton } from "../ui/form";
import { downsampleCurve, resourceCurve, type CurvePoint } from "../ui/charts";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import { rememberableCounty, residenceLocalField, seedResidenceLocal } from "../ui/residenceLocal";
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

function isFilingStatus(v: string): v is FilingStatus {
  return FILING_STATUSES.some((f) => f.value === v);
}

interface Fields {
  fs: FilingStatus;
  st: string;
  size: number;
  kids: number;
  /** Benchmark second-lowest-cost silver monthly premium; 0 opts the ACA out. */
  premium: number;
  /** Only used by the Marginal Reality tile. */
  income: number;
  step: number;
  /** The mandatory residence-based county tax (Maryland, Indiana), when there is one. */
  local: string[];
}

/**
 * A single earner supporting two children — the household the cliff literature
 * is about, and the one where the SNAP, Medicaid, and ACA edges all land inside
 * a realistic wage range.
 */
const EXAMPLE: Fields = {
  fs: "head_of_household",
  st: "ca",
  size: 3,
  kids: 2,
  premium: 1200,
  income: 38000,
  step: 1000,
  local: [],
};

function readFields(p: URLSearchParams, defaultState: string, profile: SituationStore): Fields {
  const fs = p.get("fs");
  const st = p.get("st");
  return {
    fs: fs && isFilingStatus(fs) ? fs : (profile.get("filingStatus") ?? "head_of_household"),
    st: st !== null ? st : (profile.get("stateCode") ?? defaultState),
    size: Math.max(
      1,
      Math.round(parseNonNegative(p.get("size"), profile.get("householdSize") ?? 3)),
    ),
    kids: Math.max(0, Math.round(parseNonNegative(p.get("kids"), 2))),
    premium: parseNonNegative(p.get("prem"), 0),
    income: p.has("inc")
      ? parseNonNegative(p.get("inc"), 0)
      : (profile.get("annualIncome") ?? 38000),
    step: Math.max(1, parseNonNegative(p.get("step"), 1000)),
    local: p.getAll("loc"),
  };
}

function writeFields(f: Fields, includeIncome: boolean): URLSearchParams {
  const p = new URLSearchParams();
  p.set("fs", f.fs);
  p.set("st", f.st);
  p.set("size", String(f.size));
  p.set("kids", String(f.kids));
  p.set("prem", String(f.premium));
  if (includeIncome) {
    p.set("inc", String(f.income));
    p.set("step", String(f.step));
  }
  for (const id of f.local) p.append("loc", id);
  return p;
}

/** Assemble the engine's data bundle from the loaded shards. */
function buildCliffData(data: BundledData, fields: Fields): CliffData | null {
  const federal = data.federal();
  const fica = data.fica();
  if (!federal || !fica) return null;
  const region = fields.st ? fplRegionFor(fields.st) : "contiguous";
  return {
    tax: {
      federal,
      fica,
      state: fields.st ? (data.state(fields.st) ?? undefined) : undefined,
    },
    fpl: data.fpl(region),
    eitcCtc: data.eitcCtc(),
    aca: data.aca(),
    snap: data.snap(),
    medicaid: data.medicaid(),
    // SNAP allotments are bundled for the lower 48 only; Alaska and Hawaii run
    // on different tables we haven't shipped, so the term is dropped and said
    // to be dropped rather than estimated at the wrong level.
    snapRegionSupported: region === "contiguous",
  };
}

function toCliffInput(f: Fields): CliffInput {
  return {
    filingStatus: f.fs,
    householdSize: f.size,
    qualifyingChildren: f.kids,
    stateCode: f.st,
    benchmarkMonthlyPremium: f.premium,
    localJurisdictionIds: f.local,
  };
}

/**
 * The "what this leaves out" block. Rendered on both tiles, always, never behind
 * a disclosure triangle: several unmodeled programs have steeper cliffs than
 * anything modeled here, so a user reading this chart as complete would be
 * misled about the thing they came to find out.
 */
function unmodeledBlock(unmodeled: string[]): HTMLElement {
  return el(
    "details",
    { class: "cliff-unmodeled", attrs: { open: "" } },
    el("summary", { text: `What this leaves out (${unmodeled.length})` }),
    el("p", {
      class: "cliff-unmodeled__lead",
      text: "Your real cliff may be larger than the one shown. These are not included:",
    }),
    el("ul", {}, ...unmodeled.map((u) => el("li", { text: u }))),
  );
}

function missingDataBanner(): HTMLElement {
  return el("div", {
    class: "verify-banner",
    attrs: { role: "alert" },
    text: "Federal tax data is unavailable, so no cliff can be computed. Verify before relying on any figure.",
  });
}

function commonControls(fields: Fields, data: BundledData) {
  const codes = data.stateCodes();
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
      const j = data.state(code);
      return option(code, j ? j.name : code.toUpperCase(), code === fields.st);
    }),
  );
  const sizeInput = el("input", {
    type: "number",
    name: "size",
    min: 1,
    step: 1,
    value: fields.size,
    attrs: { "aria-label": "Household size", inputmode: "numeric" },
  });
  const kidsInput = el("input", {
    type: "number",
    name: "kids",
    min: 0,
    step: 1,
    value: fields.kids,
    attrs: { "aria-label": "Children who qualify for credits", inputmode: "numeric" },
  });
  const premInput = el("input", {
    type: "number",
    name: "prem",
    min: 0,
    step: 25,
    value: fields.premium,
    attrs: { "aria-label": "Benchmark silver monthly premium", inputmode: "decimal" },
  });
  return { fsSelect, stSelect, sizeInput, kidsInput, premInput };
}

/**
 * The county currently chosen, or nothing. Read from the DOM rather than kept
 * in a variable so that a county belonging to the state you just navigated away
 * from cannot survive into the new state's sweep.
 */
function countyOf(container: HTMLElement): string[] {
  const select = container.querySelector<HTMLSelectElement>("select[name='loc-select']");
  return select && select.value ? [select.value] : [];
}

// --- Tile 1: the Benefit Cliff Explorer -------------------------------------

export function mountCliffExplorer(ctx: TileContext): void {
  const { root, data } = ctx;
  root.replaceChildren();
  if (!data) {
    root.append(missingDataBanner());
    return;
  }
  const codes = data.stateCodes();
  const defaultState = codes.includes("ca") ? "ca" : (codes[0] ?? "");
  let fields = readFields(ctx.params, defaultState, ctx.profile);

  const { fsSelect, stSelect, sizeInput, kidsInput, premInput } = commonControls(fields, data);
  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });
  const localContainer = el("div", { class: "local-addons" });

  /**
   * A Maryland or Indiana county tax comes straight off what the household has
   * at every income on the chart, so it is resolved to the shard's default
   * rather than left empty — a blank selection would draw the whole curve above
   * where the household actually sits.
   */
  function renderLocal(): void {
    const state = fields.st ? (data!.state(fields.st) ?? null) : null;
    fields.local = seedResidenceLocal(state, fields.local, ctx.profile);
    localContainer.replaceChildren();
    const county = residenceLocalField(state, fields.local[0], recompute);
    if (county) localContainer.append(county);
  }

  function compute(): void {
    const cliffData = buildCliffData(data!, fields);
    if (!cliffData) {
      resultContainer.replaceChildren(missingDataBanner());
      return;
    }
    const sweep = sweepResources(toCliffInput(fields), cliffData);
    const fmt = (n: number): string => Money.from(n).format(ctx.locale);

    // Mark which points sit inside a cliff so the chart can color them.
    const cliffIncomes = new Set<number>();
    for (const c of sweep.cliffs) {
      if (c.kind !== "drop") continue;
      for (const p of sweep.points) {
        if (p.grossIncome >= c.startIncome && p.grossIncome <= c.endIncome) {
          cliffIncomes.add(p.grossIncome);
        }
      }
    }
    const markers = new Map(
      sweep.statusChanges.map((s) => [s.atIncome, "Medicaid eligibility ends"]),
    );
    const curvePoints: CurvePoint[] = sweep.points.map((p) => ({
      income: p.grossIncome,
      resources: p.totalResources,
      inCliff: cliffIncomes.has(p.grossIncome),
      marker: markers.get(p.grossIncome),
    }));

    const drops = sweep.cliffs.filter((c) => c.kind === "drop");
    const worst = drops.reduce<(typeof drops)[number] | null>(
      (m, c) => (m === null || c.depth > m.depth ? c : m),
      null,
    );

    const lines: BreakdownLine[] = [];
    if (drops.length === 0) {
      lines.push({
        label: "Cliffs found",
        value: "None in this income range",
      });
    }
    for (const c of drops) {
      lines.push({
        label: `${fmt(c.startIncome)} → ${fmt(c.endIncome)}`,
        value: `−${fmt(c.depth)}`,
      });
    }
    for (const s of sweep.statusChanges) {
      lines.push({
        label: `Medicaid eligibility ends at ${fmt(s.atIncome)}`,
        // Never a dollar figure: we cannot price a household's coverage.
        value: "Coverage change, not priced",
        citation: data!.medicaid()?.citation ?? null,
      });
    }
    const plateaus = sweep.cliffs.filter((c) => c.kind === "plateau");
    if (plateaus.length > 0) {
      lines.push({
        label: "Flat stretches (earning more, keeping nothing)",
        value: String(plateaus.length),
      });
    }
    if (sweep.stepWidened) {
      lines.push({ label: "Income step used", value: fmt(sweep.step) });
    }

    const headline = worst ? Money.from(worst.depth) : Money.zero();
    resultContainer.replaceChildren(
      resultCard({
        label: worst
          ? `Biggest cliff: what you lose earning past ${fmt(worst.startIncome)}`
          : "No cliff found in this income range",
        value: headline,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields, false)),
      }),
      resourceCurve({
        // The sweep is fine-grained so narrow cliffs are found; the chart only
        // needs enough columns to read as a curve.
        points: downsampleCurve(curvePoints),
        locale: ctx.locale,
        // "Here is the cliff" is half an answer; the other half is where the
        // reader stands on it. The chart has taken this since it was written
        // and nothing ever passed it.
        highlightIncome: fields.income,
        ariaLabel:
          "Total household resources plotted against gross income. Bars in the warning color mark stretches where earning more leaves the household with the same or less.",
      }),
      resourceTable(sweep.points, ctx.locale),
      unmodeledBlock(sweep.unmodeled),
    );
  }

  function collect(): void {
    fields = {
      ...fields,
      fs: isFilingStatus(fsSelect.value) ? fsSelect.value : "head_of_household",
      st: stSelect.value,
      size: Math.max(1, Math.round(parseNonNegative(sizeInput.value, 3))),
      kids: Math.max(0, Math.round(parseNonNegative(kidsInput.value, 0))),
      premium: parseNonNegative(premInput.value, 0),
      local: countyOf(localContainer),
    };
  }

  function recompute(): void {
    collect();
    renderLocal();
    ctx.setParams(writeFields(fields, false));
    rememberShared(ctx.profile, {
      filingStatus: fields.fs,
      stateCode: fields.st,
      county: rememberableCounty(fields.st ? (data!.state(fields.st) ?? null) : null, fields.local),
    });
    ctx.profile.set("householdSize", fields.size);
    compute();
  }

  for (const c of [fsSelect, stSelect]) c.addEventListener("change", recompute);
  for (const i of [sizeInput, kidsInput, premInput]) i.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    fsSelect.value = fields.fs;
    stSelect.value = fields.st;
    sizeInput.value = String(fields.size);
    kidsInput.value = String(fields.kids);
    premInput.value = String(fields.premium);
    recompute();
  });

  root.append(
    el(
      "form",
      { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
      field("Filing status", fsSelect),
      field("State", stSelect),
      field("People in household", sizeInput),
      field("Children who qualify for credits", kidsInput),
      field("Benchmark silver premium (monthly)", premInput),
      localContainer,
      el("div", { class: "tile-form-actions" }, tryExample),
    ),
    resultContainer,
  );
  renderLocal();
  compute();
}

/** An accessible table of the swept curve — the chart's non-visual equivalent. */
function resourceTable(
  points: { grossIncome: number; totalResources: number; medicaidEligible: boolean | null }[],
  locale: string,
): HTMLElement {
  const fmt = (n: number): string => Money.from(n).format(locale);
  // One row per ~$5,000 keeps the table readable next to a 200-point chart.
  const stride = Math.max(1, Math.round(points.length / 25));
  const rows = points.filter((_, i) => i % stride === 0);
  return el(
    "details",
    { class: "cliff-table" },
    el("summary", { text: "See the numbers" }),
    el(
      "table",
      { class: "data-table" },
      el(
        "thead",
        {},
        el(
          "tr",
          {},
          el("th", { attrs: { scope: "col" }, text: "If you earn" }),
          el("th", { attrs: { scope: "col" }, text: "You actually have" }),
          el("th", { attrs: { scope: "col" }, text: "Medicaid" }),
        ),
      ),
      el(
        "tbody",
        {},
        ...rows.map((p) =>
          el(
            "tr",
            {},
            el("th", { attrs: { scope: "row" }, text: fmt(p.grossIncome) }),
            el("td", { text: fmt(p.totalResources) }),
            el("td", {
              text:
                p.medicaidEligible === null
                  ? "Not determined"
                  : p.medicaidEligible
                    ? "Likely eligible"
                    : "Not eligible",
            }),
          ),
        ),
      ),
    ),
  );
}

// --- Tile 2: the Marginal Reality Rate --------------------------------------

export function mountMarginalReality(ctx: TileContext): void {
  const { root, data } = ctx;
  root.replaceChildren();
  if (!data) {
    root.append(missingDataBanner());
    return;
  }
  const codes = data.stateCodes();
  const defaultState = codes.includes("ca") ? "ca" : (codes[0] ?? "");
  let fields = readFields(ctx.params, defaultState, ctx.profile);

  const { fsSelect, stSelect, sizeInput, kidsInput, premInput } = commonControls(fields, data);

  const localContainer = el("div", { class: "local-addons" });

  /** The same mandatory county tax the Explorer charges — see its `renderLocal`. */
  function renderLocal(): void {
    const state = fields.st ? (data!.state(fields.st) ?? null) : null;
    fields.local = seedResidenceLocal(state, fields.local, ctx.profile);
    localContainer.replaceChildren();
    const county = residenceLocalField(state, fields.local[0], recompute);
    if (county) localContainer.append(county);
  }
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
    attrs: { "aria-label": "Raise amount", inputmode: "decimal" },
  });
  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const cliffData = buildCliffData(data!, fields);
    if (!cliffData) {
      resultContainer.replaceChildren(missingDataBanner());
      return;
    }
    const r = marginalReality(fields.income, fields.step, toCliffInput(fields), cliffData);
    const fmt = (n: number): string => Money.from(n).format(ctx.locale);

    const lines: BreakdownLine[] = [
      { label: "Extra pay", value: fmt(fields.step) },
      { label: "Lost to tax and FICA", value: fmt(-(fields.step - r.taxDelta)) },
      { label: "Change in benefits and credits", value: fmt(r.benefitDelta) },
      { label: "What you actually keep", value: fmt(r.netDelta), emphasis: true },
      { label: "Combined marginal rate", value: pct(r.combinedRate) },
    ];
    if (r.medicaidFlip) {
      lines.push({
        label: "Medicaid eligibility",
        value: "Ends across this raise — coverage change, not priced",
        citation: data!.medicaid()?.citation ?? null,
      });
    }

    const sweep = sweepResources(toCliffInput(fields), cliffData, {
      from: fields.income,
      to: fields.income + fields.step,
      step: Math.max(1, fields.step),
    });

    const nodes: HTMLElement[] = [];
    if (r.netNegative) {
      nodes.push(
        el("div", {
          class: "verify-banner",
          attrs: { role: "status" },
          text: `Taking this raise leaves you with ${fmt(Math.abs(r.netDelta))} less than before. That is not a mistake in the math, it is how the phase-outs stack at this income.`,
        }),
      );
    }
    nodes.push(
      resultCard({
        label: `What you keep from a ${fmt(fields.step)} raise`,
        value: Money.from(r.netDelta),
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields, true)),
      }),
      unmodeledBlock(sweep.unmodeled),
    );
    resultContainer.replaceChildren(...nodes);
  }

  function collect(): void {
    fields = {
      fs: isFilingStatus(fsSelect.value) ? fsSelect.value : "head_of_household",
      st: stSelect.value,
      size: Math.max(1, Math.round(parseNonNegative(sizeInput.value, 3))),
      kids: Math.max(0, Math.round(parseNonNegative(kidsInput.value, 0))),
      premium: parseNonNegative(premInput.value, 0),
      income: parseNonNegative(incInput.value, 0),
      step: Math.max(1, parseNonNegative(stepInput.value, 1000)),
      local: countyOf(localContainer),
    };
  }

  function recompute(): void {
    collect();
    renderLocal();
    ctx.setParams(writeFields(fields, true));
    rememberShared(ctx.profile, {
      filingStatus: fields.fs,
      stateCode: fields.st,
      county: rememberableCounty(fields.st ? (data!.state(fields.st) ?? null) : null, fields.local),
      annualIncome: fields.income,
    });
    ctx.profile.set("householdSize", fields.size);
    compute();
  }

  for (const c of [fsSelect, stSelect]) c.addEventListener("change", recompute);
  for (const i of [sizeInput, kidsInput, premInput, incInput, stepInput]) {
    i.addEventListener("input", recompute);
  }

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    fsSelect.value = fields.fs;
    stSelect.value = fields.st;
    sizeInput.value = String(fields.size);
    kidsInput.value = String(fields.kids);
    premInput.value = String(fields.premium);
    incInput.value = String(fields.income);
    stepInput.value = String(fields.step);
    recompute();
  });

  root.append(
    el(
      "form",
      { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
      field("Filing status", fsSelect),
      field("State", stSelect),
      field("People in household", sizeInput),
      field("Children who qualify for credits", kidsInput),
      field("Benchmark silver premium (monthly)", premInput),
      field("Current income", incInput),
      field("Raise amount", stepInput),
      localContainer,
      el("div", { class: "tile-form-actions" }, tryExample),
    ),
    resultContainer,
  );
  renderLocal();
  compute();
}

const SHARED_HOW_TAIL =
  "\n\nThe tax half of every figure here comes from your income and household alone, so five deductions new for 2026 — tips, overtime, car loan interest, being 65, and giving without itemizing — are not in it. A household any of them reaches keeps a little more at every income on the chart, though the cliffs themselves sit where the benefit rules put them rather than where the tax does.\n\nWhat this leaves out is listed under every result, and it matters: housing assistance, childcare subsidies, WIC, LIHEAP, TANF, and state-only programs are not modeled here, and several of them have steeper cliffs than anything that is. Losing Medicaid is shown as a change in eligibility, never as a dollar amount, because we cannot price your coverage from public data and a made-up number would be worse than none.\n\nThis is an estimate from public data and the figures you enter, not an eligibility determination. Only the agency that runs a program decides who qualifies.";

export const cliffExplorerTile: TileDefinition = {
  id: "cliff-explorer",
  title: "Benefit Cliff Explorer",
  pillar: "rough",
  harmTier: 1,
  description: "If you earn more, are you actually better off?",
  keywords: ["cliff", "benefit cliff", "raise", "phase out", "welfare cliff", "better off", "trap"],
  status: "ready",
  mount: mountCliffExplorer,
  how:
    "Most calculators answer what you owe or what you're owed. This one answers something else: what a household actually has, across a whole range of incomes.\n\nFor each income we compute your pay after federal income tax, FICA, and state income tax, then add the EITC, the refundable Child Tax Credit, your ACA premium tax credit, and your estimated SNAP allotment. That sum is your total resources. Plotting it against gross income shows something a bracket table can't: the stretches where earning more leaves you with the same or less, because a credit phases out or an eligibility line is crossed faster than your wage grows." +
    SHARED_HOW_TAIL,
  related: [
    {
      hubId: "benefit-cliffs",
      tool: "marginal-reality",
      label: "Marginal Reality Rate",
      note: "What one specific raise costs, including lost benefits",
    },
    {
      hubId: "benefits",
      tool: "screener",
      label: "What am I owed?",
      note: "Screen every program in one place",
    },
  ],
  resources: [
    { label: "Benefits.gov, find benefits", url: "https://www.usa.gov/benefit-finder" },
    { label: "HealthCare.gov, find your benchmark premium", url: "https://www.healthcare.gov/" },
  ],
};

export const marginalRealityTile: TileDefinition = {
  id: "marginal-reality",
  title: "Marginal Reality Rate",
  pillar: "rough",
  harmTier: 1,
  description: "What your next raise really costs, including lost benefits.",
  keywords: ["marginal", "raise", "next dollar", "phase out", "effective rate", "overtime"],
  status: "ready",
  mount: mountMarginalReality,
  how:
    "The Marginal Rate Explorer adds up federal income tax, FICA, and state tax on your next dollars. This tile adds the part that's usually left out: what happens to your benefits at the same time.\n\nWe evaluate your whole position twice, at your current income and again after the raise, and report the difference split into its two halves, the tax you pay and the benefits you lose. The combined rate can exceed 100%, and we show it that way rather than tidying it up. A household that keeps none of its next $1,000 deserves to see exactly that." +
    SHARED_HOW_TAIL,
  // The two figures this rate is built from that a reader will most want to
  // check independently: the EITC's published phase-out, which supplies most of
  // the benefit-loss term, and the screener that says which programs are in play
  // at all. Both fetched and confirmed live.
  resources: [
    {
      label: "IRS, EITC tables (the phase-out this rate is mostly made of)",
      url: "https://www.irs.gov/credits-deductions/individuals/earned-income-tax-credit/earned-income-and-earned-income-tax-credit-eitc-tables",
    },
    { label: "USA.gov, find benefits", url: "https://www.usa.gov/benefit-finder" },
  ],
  related: [
    {
      hubId: "benefit-cliffs",
      tool: "cliff-explorer",
      label: "Benefit Cliff Explorer",
      note: "See the whole curve, not just this one step",
    },
    {
      hubId: "paycheck-taxes",
      tool: "marginal-explorer",
      label: "Marginal Rate Explorer",
      note: "The tax-only version of this question",
    },
  ],
};
