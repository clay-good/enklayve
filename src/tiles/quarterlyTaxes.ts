/**
 * Quarterly Taxes & Set-Aside (BUILD-SPEC-2 §6.4). The question every 1099 worker
 * actually has: "how much of each payment do I keep for the IRS, and what do I send
 * in every quarter?" No employer withholds for you, so you self-withhold. This adds
 * up the two taxes a self-employed person owes — self-employment tax (both halves of
 * Social Security and Medicare) AND federal + state income tax — then shows the
 * share to skim off every payment into a tax bucket and the four equal 1040-ES
 * installments. Built on the same deterministic engine as the take-home tile.
 *
 * Simplification: we omit the QBI / §199A deduction, so the figure errs slightly
 * high — the safe direction when the goal is "set enough aside."
 */
import { Money, allocateRounded } from "../engine/money";
import { evaluateTaxes, selfEmploymentTax, type TaxInput } from "../engine/tax";
import { estimatedTaxDueDates, estimatedTaxSafeHarbor, formatDueDate } from "../engine/dueDates";
import type { CitationData, FilingStatus } from "../data/schemas";
import { el, option } from "../ui/dom";
import { NO_STATE_OPTION_LABEL, field, parseNonNegative, pct, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import { allocatePercents, donutChart, paletteVar } from "../ui/charts";
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

const ESTIMATED_PAYMENT_CITATION: CitationData = {
  sourceUrl: "https://www.irs.gov/forms-pubs/about-form-1040-es",
  sourceDocument: "IRS Form 1040-ES, Estimated Tax for Individuals",
  effectiveYear: 2026,
  dateRetrieved: "2026-06-02",
};

interface Fields {
  fs: FilingStatus;
  state: string;
  profit: number;
  other: number;
  lastYearTax: number;
  /**
   * Last year's AGI, which is the number IRC §6654(d)(1)(C) actually asks about
   * — "the adjusted gross income shown on the return of the individual for the
   * preceding taxable year". This tile used to test *this* year's computed AGI
   * against it, which is a different question and, for a self-employed person
   * whose income is the thing that moves, frequently a different answer.
   *
   * Optional, because someone who has last year's total tax to hand may not
   * have last year's AGI. Left blank, this year's AGI stands in and the
   * safe-harbor line says so rather than quietly presenting a guess as the
   * statute's answer.
   */
  lastYearAgi: number;
  /**
   * The mandatory residence-based county tax (Maryland, Indiana). It belongs in
   * an ESTIMATED-tax figure more than anywhere else on the site: the number this
   * tile produces is one somebody sends to a taxing authority four times a year,
   * and an estimate short by a county's 3% is an underpayment with a penalty on
   * it, not a display rounding.
   */
  local: string[];
}

const EXAMPLE: Fields = {
  fs: "single",
  state: "ca",
  profit: 90000,
  other: 0,
  lastYearTax: 0,
  lastYearAgi: 0,
  local: [],
};

function isFilingStatus(v: string): v is FilingStatus {
  return FILING_STATUSES.some((f) => f.value === v);
}

function readFields(p: URLSearchParams, profile: SituationStore): Fields {
  const fs = p.get("fs");
  const st = p.get("st");
  return {
    fs: fs && isFilingStatus(fs) ? fs : (profile.get("filingStatus") ?? "single"),
    state: st !== null ? st : (profile.get("stateCode") ?? ""),
    profit: p.has("np") ? parseNonNegative(p.get("np"), 0) : (profile.get("annualIncome") ?? 0),
    other: parseNonNegative(p.get("oth"), 0),
    lastYearTax: parseNonNegative(p.get("ly"), 0),
    lastYearAgi: parseNonNegative(p.get("lya"), 0),
    local: p.getAll("loc"),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("fs", f.fs);
  p.set("st", f.state);
  p.set("np", String(f.profit));
  if (f.other > 0) p.set("oth", String(f.other));
  if (f.lastYearTax > 0) p.set("ly", String(f.lastYearTax));
  if (f.lastYearAgi > 0) p.set("lya", String(f.lastYearAgi));
  for (const id of f.local) p.append("loc", id);
  return p;
}

export function mountQuarterlyTaxes(ctx: TileContext): void {
  const { root, data, profile } = ctx;
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

  let fields = readFields(ctx.params, profile);

  const fsSelect = el(
    "select",
    { name: "fs", attrs: { "aria-label": "Filing status" } },
    ...FILING_STATUSES.map((s) => option(s.value, s.label, s.value === fields.fs)),
  );
  const stateCodes = data?.stateCodes() ?? [];
  const stateSelect = el(
    "select",
    { name: "st", attrs: { "aria-label": "State" } },
    option("", NO_STATE_OPTION_LABEL, fields.state === ""),
    ...stateCodes.map((c) => option(c, c.toUpperCase(), c === fields.state)),
  );
  fsSelect.value = fields.fs;
  stateSelect.value = fields.state;

  const mkNum = (name: string, label: string, value: number): HTMLInputElement =>
    el("input", {
      type: "number",
      name,
      min: 0,
      step: 1000,
      value,
      attrs: { "aria-label": label, inputmode: "decimal" },
    });
  const npInput = mkNum("np", "Net business profit", fields.profit);
  const othInput = mkNum("oth", "Other taxable household income", fields.other);
  const lyInput = mkNum("ly", "Last year's total tax (optional)", fields.lastYearTax);
  const lyaInput = mkNum("lya", "Last year's AGI (optional)", fields.lastYearAgi);

  const chartContainer = el("div", { class: "tile-charts" });
  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const se = selfEmploymentTax(Money.from(fields.profit), fields.fs, fica!);
    const stateJur = fields.state ? (data?.state(fields.state) ?? undefined) : undefined;
    const input: TaxInput = {
      filingStatus: fields.fs,
      wages: 0, // self-employed: no W-2 wages, so no employee FICA here
      otherIncome: fields.profit + fields.other, // income-tax-only
      adjustments: se.deductibleHalf.toNumber(), // half of SE tax is above-the-line
    };
    const r = evaluateTaxes(
      { ...input, localJurisdictionIds: fields.local },
      { federal: fed!, fica: fica!, state: stateJur },
    );
    const fedIncome = r.federal.incomeTax;
    const stateIncome = r.state?.incomeTax ?? Money.zero();
    const incomeTax = fedIncome.add(stateIncome).add(r.local.total);
    const totalTax = incomeTax.add(se.total);

    const totalIncome = fields.profit + fields.other;
    const setAside = totalIncome > 0 ? totalTax.divide(totalIncome).toNumber() : 0;
    const quarterly = totalTax.divide(4);
    const kept = Money.from(totalIncome).subtract(totalTax);
    const fmt = (m: Money): string => m.format(ctx.locale);

    // The shares of the total, rounded so the column adds up to it rather than
    // each to itself — see `allocateRounded`. Rounded independently, SE tax +
    // federal + state came to a cent less than the total printed beneath them.
    const shares = allocateRounded(
      [se.total, fedIncome, stateIncome, ...r.local.lines.map((l) => l.tax)],
      totalTax,
    );
    const lines: BreakdownLine[] = [
      { label: "Net business profit", value: fmt(Money.from(fields.profit)) },
      { label: "Self-employment tax", value: fmt(shares[0]!), citation: se.citation },
      { label: "Federal income tax", value: fmt(shares[1]!), citation: fed!.citation },
    ];
    if (stateJur) {
      lines.push({
        label: `State income tax (${fields.state.toUpperCase()})`,
        value: fmt(shares[2]!),
        citation: r.state?.citation ?? null,
      });
    }
    // Its own line, never folded into the state's: the county tax is a separate
    // figure on a separate authority's schedule, and someone reconciling this
    // against their own return needs to see the two apart.
    for (const [i, local] of r.local.lines.entries()) {
      lines.push({
        label: `${local.name} local tax`,
        value: fmt(shares[3 + i]!),
        citation: r.local.citation ?? null,
      });
    }
    lines.push(
      { label: "Total estimated tax for the year", value: fmt(totalTax), emphasis: true },
      {
        label: "Set aside this share of every payment",
        value: pct(Math.max(0, setAside), 1),
      },
    );
    // The four 1040-ES installments and their due dates, with the next-business-day
    // rule applied so a deadline that falls on a weekend or holiday reads correctly.
    const dueDates = estimatedTaxDueDates(fed!.taxYear);
    for (const d of dueDates) {
      const dateLabel = formatDueDate(d.due, ctx.locale);
      lines.push({
        label: `Q${d.quarter} payment, due ${dateLabel}${d.adjusted ? " (moved to the next business day)" : ""}`,
        value: fmt(quarterly),
        citation: ESTIMATED_PAYMENT_CITATION,
      });
    }
    if (fields.lastYearTax > 0) {
      // §6654(d)(1)(C) measures the threshold on LAST year's AGI. When it is not
      // given, this year's stands in — and the line below says so, because a
      // substituted number presented as the statute's own is the failure this
      // tile already had.
      const proxied = fields.lastYearAgi <= 0;
      const priorAgi = proxied ? r.agi.toNumber() : fields.lastYearAgi;
      const harbor = estimatedTaxSafeHarbor(
        fields.fs,
        Money.from(fields.lastYearTax),
        priorAgi,
        totalTax,
      );
      lines.push({
        label: "Safe-harbor minimum for the year (avoids the underpayment penalty)",
        value: `${fmt(harbor.minimum)} (${fmt(harbor.minimum.divide(4))} per quarter)`,
        citation: ESTIMATED_PAYMENT_CITATION,
      });
      const line = `$${harbor.threshold.toLocaleString(ctx.locale)}`;
      const rateSentence =
        harbor.priorYearRate > 1
          ? `Your AGI is over ${line}, so the safe harbor is 110% of last year's tax rather than 100% (IRC §6654(d)(1)(C)).`
          : `At or under ${line} of AGI the safe harbor is 100% of last year's tax (IRC §6654(d)(1)(C)).`;
      lines.push({
        label: "How the safe harbor was set",
        value: proxied
          ? `${rateSentence} We used this year's AGI because last year's is blank — the statute measures it on last year's return, so enter it above for the exact test.`
          : rateSentence,
        citation: ESTIMATED_PAYMENT_CITATION,
      });
    }
    lines.push({
      label: "Note",
      value:
        "We don't subtract the QBI (20% pass-through) deduction, so this errs a little high: the safe side when you're setting money aside.",
    });

    // Built once: the ring, its legend, and the share in its hole are three
    // renderings of one split, and computing any of them separately is how they
    // came to disagree. "What you keep" is last, which is what lets the centre
    // be 100 minus it.
    const donutSlices = [
      { label: "Self-employment tax", value: se.total.toNumber(), color: paletteVar(0) },
      { label: "Federal income tax", value: fedIncome.toNumber(), color: paletteVar(1) },
      ...(stateJur && stateIncome.greaterThan(0)
        ? [{ label: "State income tax", value: stateIncome.toNumber(), color: paletteVar(2) }]
        : []),
      // The county tax is a slice like any other. Left out, the ring's whole was
      // income MINUS the local tax, so every other share read a little high and
      // a Maryland household's county tax vanished from the picture while
      // sitting on its own line in the breakdown beneath it.
      ...r.local.lines
        .filter((l) => l.tax.greaterThan(0))
        .map((l, i) => ({
          label: `${l.name} local tax`,
          value: l.tax.toNumber(),
          color: paletteVar(3 + i),
        })),
      {
        label: "What you keep",
        value: Math.max(0, kept.toNumber()),
        color: "var(--enk-accent)",
      },
    ];
    // The share in the ring's hole is the rate the breakdown states below it,
    // rounded once -- and the tax slices in the legend are then allocated to
    // THAT, not to a whole of their own. Computed separately, the hole read
    // "30% to taxes" over a legend column of 14 + 11 + 4, which is a
    // contradiction inside one figure at one glance; allocating the legend to
    // its own total instead moved the disagreement rather than removing it,
    // leaving the hole at 29% under a breakdown row reading 29.6%.
    const taxSlices = donutSlices.slice(0, -1);
    const taxShare = Math.max(0, Math.min(100, Math.round(Math.max(0, setAside) * 100)));
    const donutPercents = [
      ...allocatePercents(
        taxSlices.map((sl) => sl.value),
        taxSlices.reduce((a, sl) => a + Math.max(0, sl.value), 0),
        taxShare,
      ),
      100 - taxShare,
    ];

    chartContainer.replaceChildren(
      donutChart({
        slices: donutSlices,
        locale: ctx.locale,
        ariaLabel: "Your income split between taxes and what you keep",
        // One rounding, read by the hole and by the legend both.
        percents: donutPercents,
        centerValue: `${taxShare}%`,
        centerLabel: "to taxes",
      }),
    );

    resultContainer.replaceChildren(
      resultCard({
        label: "Estimated tax for the year",
        value: totalTax,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  const localContainer = el("div", { class: "local-addons" });

  /** The county whose tax the quarterly estimate must include. */
  function renderLocal(): void {
    const state = fields.state ? (data?.state(fields.state) ?? null) : null;
    fields.local = seedResidenceLocal(state, fields.local, profile);
    localContainer.replaceChildren();
    const county = residenceLocalField(state, fields.local[0], recompute);
    if (county) localContainer.append(county);
  }

  function recompute(): void {
    const countySelect = localContainer.querySelector<HTMLSelectElement>(
      "select[name='loc-select']",
    );
    fields = {
      fs: isFilingStatus(fsSelect.value) ? fsSelect.value : "single",
      state: stateSelect.value,
      profit: parseNonNegative(npInput.value, 0),
      other: parseNonNegative(othInput.value, 0),
      lastYearTax: parseNonNegative(lyInput.value, 0),
      lastYearAgi: parseNonNegative(lyaInput.value, 0),
      local: countySelect && countySelect.value ? [countySelect.value] : [],
    };
    renderLocal();
    ctx.setParams(writeFields(fields));
    rememberShared(profile, {
      filingStatus: fields.fs,
      stateCode: fields.state || undefined,
      county: rememberableCounty(
        fields.state ? (data?.state(fields.state) ?? null) : null,
        fields.local,
      ),
      annualIncome: fields.profit,
    });
    compute();
  }

  for (const s of [fsSelect, stateSelect]) s.addEventListener("change", recompute);
  for (const i of [npInput, othInput, lyInput, lyaInput]) i.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    fsSelect.value = fields.fs;
    stateSelect.value = fields.state;
    npInput.value = String(fields.profit);
    othInput.value = String(fields.other);
    lyInput.value = String(fields.lastYearTax);
    lyaInput.value = String(fields.lastYearAgi);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Filing status", fsSelect),
    field("State", stateSelect),
    field("Net business profit", npInput),
    field("Other taxable household income", othInput),
    field("Last year's total tax (optional)", lyInput),
    field("Last year's AGI (optional)", lyaInput),
    localContainer,
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, chartContainer, resultContainer);
  renderLocal();
  compute();
}

export const quarterlyTaxesTile: TileDefinition = {
  id: "quarterly-taxes",
  title: "Quarterly Taxes & Set-Aside",
  pillar: "paycheck",
  description: "How much of every 1099 payment to keep for taxes, and what to pay each quarter.",
  keywords: [
    "self employed",
    "1099",
    "freelance",
    "contractor",
    "gig",
    "quarterly",
    "estimated tax",
    "set aside",
    "1040-es",
    "schedule c",
  ],
  status: "ready",
  how:
    "When you work for yourself, no employer withholds taxes from your pay, so you have to do it yourself, and you owe two taxes, not one. First is self-employment tax: both halves of Social Security and Medicare (15.3% on 92.35% of your profit). Second is regular income tax, federal and state, on your profit minus the deductible half of that SE tax. We add the two together to get your tax for the year.\n\nFrom that we show the share to skim off every payment you receive (move it to a separate tax account the day it lands) and the four equal estimated payments the IRS expects on the 1040-ES schedule. If you enter last year's total tax, we also show the safe-harbor minimum: pay at least that much across the year and you avoid the underpayment penalty even if you earn more than expected. It is the smaller of 90% of this year's tax and 100% of last year's — 110% of last year's if last year's AGI was over $150,000, or over $75,000 if you file separately (IRC §6654(d)(1)(C)). The threshold is measured on LAST year's AGI, so enter it too if you have it; left blank we use this year's and say so on the line.\n\nWe don't subtract the QBI (20% qualified business income) deduction, so the number leans slightly high, which is the safe side when the whole point is setting enough aside. Filing status, state, and income flow to and from My Situation.\n\n" +
    OBBBA_DEDUCTIONS_NOT_MODELED,
  resources: [
    {
      label: "IRS, estimated taxes",
      url: "https://www.irs.gov/businesses/small-businesses-self-employed/estimated-taxes",
    },
    {
      label: "IRS, Form 1040-ES (estimated tax)",
      url: "https://www.irs.gov/forms-pubs/about-form-1040-es",
    },
  ],
  mount: mountQuarterlyTaxes,
};
