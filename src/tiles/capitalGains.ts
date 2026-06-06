/**
 * Capital Gains tile (BUILD-SPEC.md §3.2): short- and long-term gains, bracket-
 * aware, including the Net Investment Income Tax. Short-term gains are taxed as
 * ordinary income (stacked on your other income through the IRS brackets);
 * long-term gains get the preferential 0/15/20% rates stacked on top; NIIT adds
 * 3.8% above the MAGI threshold. Every output line carries its citation.
 *
 * A cost-basis helper (proceeds − basis) computes the gain when you enter a
 * single lot; the full FIFO / specific-identification lot picker is a later
 * sub-wave (noted in "How this works").
 */
import { Money } from "../engine/money";
import { estimateCapitalGains } from "../engine/capitalGains";
import type { FilingStatus } from "../data/schemas";
import { el, option } from "../ui/dom";
import { field, parseNonNegative, parseNumber, pct, tryExampleButton } from "../ui/form";
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
  /** Ordinary taxable income beneath the gains. */
  ordinary: number;
  shortTerm: number;
  longTerm: number;
  /** Modified AGI for the NIIT test (defaults to ordinary + gains when blank). */
  magi: number | null;
}

const EXAMPLE: Fields = {
  fs: "single",
  ordinary: 90000,
  shortTerm: 5000,
  longTerm: 20000,
  magi: null,
};

function isFilingStatus(v: string): v is FilingStatus {
  return FILING_STATUSES.some((f) => f.value === v);
}

/** MAGI used for NIIT: the user's entry, or ordinary income + the gains. */
function magiOf(f: Fields): number {
  return f.magi !== null ? f.magi : f.ordinary + f.shortTerm + f.longTerm;
}

function readFields(p: URLSearchParams, profile: SituationStore): Fields {
  const fs = p.get("fs");
  const magi = p.get("magi");
  return {
    fs: fs && isFilingStatus(fs) ? fs : (profile.get("filingStatus") ?? "single"),
    ordinary: p.has("ord") ? parseNonNegative(p.get("ord"), 0) : (profile.get("annualIncome") ?? 0),
    shortTerm: parseNonNegative(p.get("st"), 0),
    longTerm: parseNonNegative(p.get("lt"), 0),
    magi: magi !== null && magi.trim() !== "" ? parseNumber(magi, 0) : null,
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("fs", f.fs);
  p.set("ord", String(f.ordinary));
  if (f.shortTerm > 0) p.set("st", String(f.shortTerm));
  if (f.longTerm > 0) p.set("lt", String(f.longTerm));
  if (f.magi !== null) p.set("magi", String(f.magi));
  return p;
}

export function mountCapitalGains(ctx: TileContext): void {
  const { root, data } = ctx;
  root.replaceChildren();
  const fed = data?.federal();
  const cg = data?.capitalGains();
  if (!fed || !cg) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "Capital-gains data is unavailable, verify before relying on any figure.",
      }),
    );
    return;
  }

  let fields = readFields(ctx.params, ctx.profile);

  const fsSelect = el(
    "select",
    { name: "fs", attrs: { "aria-label": "Filing status" } },
    ...FILING_STATUSES.map((s) => option(s.value, s.label, s.value === fields.fs)),
  );
  const mkMoney = (name: string, value: number, label: string, step = 1000): HTMLInputElement =>
    el("input", {
      type: "number",
      name,
      min: 0,
      step,
      value,
      attrs: { "aria-label": label, inputmode: "decimal" },
    });
  const ordInput = mkMoney("ord", fields.ordinary, "Ordinary taxable income");
  const stInput = mkMoney("st", fields.shortTerm, "Net short-term gain");
  const ltInput = mkMoney("lt", fields.longTerm, "Net long-term gain");
  const magiInput = el("input", {
    type: "number",
    name: "magi",
    min: 0,
    step: 1000,
    value: fields.magi ?? "",
    attrs: {
      "aria-label": "Modified AGI for the Net Investment Income Tax (optional)",
      inputmode: "decimal",
      placeholder: "auto",
    },
  });

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const result = estimateCapitalGains(
      {
        filingStatus: fields.fs,
        ordinaryTaxableIncome: fields.ordinary,
        shortTermGain: fields.shortTerm,
        longTermGain: fields.longTerm,
        modifiedAgi: magiOf(fields),
      },
      fed!,
      cg!,
    );
    const fmt = (m: Money): string => m.format(ctx.locale);

    const lines: BreakdownLine[] = [];
    if (fields.shortTerm > 0) {
      lines.push({
        label: "Short-term gain (taxed as ordinary income)",
        value: fmt(result.shortTermTax),
        citation: fed!.citation,
      });
    }
    for (const band of result.longTermBands) {
      lines.push({
        label: `Long-term gain at ${pct(band.rate, 0)}`,
        value: `${fmt(band.amount)} → ${fmt(band.tax)}`,
        citation: cg!.citation,
      });
    }
    if (result.netInvestmentIncomeTax.greaterThan(0)) {
      lines.push({
        label: "Net Investment Income Tax (3.8%)",
        value: fmt(result.netInvestmentIncomeTax),
        citation: cg!.citation,
      });
    }
    lines.push({
      label: "Total tax on gains",
      value: fmt(result.totalTax),
      citation: cg!.citation,
      emphasis: true,
    });
    lines.push({
      label: "Effective rate on gains",
      value: pct(result.effectiveRateOnGains),
    });

    resultContainer.replaceChildren(
      resultCard({
        label: "Tax on your capital gains",
        value: result.totalTax,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function collect(): void {
    const magiRaw = magiInput.value.trim();
    fields = {
      fs: isFilingStatus(fsSelect.value) ? fsSelect.value : "single",
      ordinary: parseNonNegative(ordInput.value, 0),
      shortTerm: parseNonNegative(stInput.value, 0),
      longTerm: parseNonNegative(ltInput.value, 0),
      magi: magiRaw === "" ? null : parseNonNegative(magiRaw, 0),
    };
  }

  function recompute(): void {
    collect();
    ctx.setParams(writeFields(fields));
    rememberShared(ctx.profile, { filingStatus: fields.fs });
    compute();
  }

  fsSelect.addEventListener("change", recompute);
  for (const i of [ordInput, stInput, ltInput, magiInput]) i.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    fsSelect.value = fields.fs;
    ordInput.value = String(fields.ordinary);
    stInput.value = String(fields.shortTerm);
    ltInput.value = String(fields.longTerm);
    magiInput.value = "";
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Filing status", fsSelect),
    field("Ordinary taxable income", ordInput),
    field("Net short-term gain", stInput),
    field("Net long-term gain", ltInput),
    field("Modified AGI (optional, for NIIT)", magiInput),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const capitalGainsTile: TileDefinition = {
  id: "capital-gains",
  title: "Capital Gains",
  pillar: "investing",
  description: "Short- and long-term gains with a cost-basis helper.",
  keywords: ["capital gains", "niit", "cost basis", "investments", "stocks", "long term"],
  status: "ready",
  how: "Short-term gains (assets held a year or less) are ordinary income, so we stack them on your other taxable income and tax them at your marginal brackets. Long-term gains (held more than a year) get the preferential 0%, 15%, and 20% rates, stacked on top of everything beneath them, so the bracket a long-term dollar lands in depends on your ordinary income first.\n\nIf your modified AGI is high enough, the Net Investment Income Tax adds 3.8% on the smaller of your net investment income or the amount above the threshold for your filing status. Enter a single lot as proceeds minus cost basis to get the gain; a full FIFO / specific-identification lot picker is on the way. Net losses aren't modeled here, enter net gains.",
  resources: [
    {
      label: "IRS Topic No. 409, capital gains and losses",
      url: "https://www.irs.gov/taxtopics/tc409",
    },
    {
      label: "IRS, Net Investment Income Tax",
      url: "https://www.irs.gov/individuals/net-investment-income-tax",
    },
  ],
  related: [
    {
      hubId: "paycheck-taxes",
      tool: "marginal-explorer",
      label: "Marginal Rate Explorer",
      note: "what your next $1,000 of income costs",
    },
  ],
  mount: mountCapitalGains,
};
