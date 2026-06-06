/**
 * AMT quick screener (SPEC-3 §4.7). A deliberately coarse "might I owe the
 * Alternative Minimum Tax?" — yes / maybe / no, with a pointer to Form 6251. It
 * does not attempt the full AMT computation (that would over-promise); it
 * estimates your AMT income, applies the cited exemption and 26%/28% schedule to
 * get a tentative minimum tax, and compares that to your regular tax (computed
 * from the federal brackets). Gates on both the AMT and federal shards.
 */
import { Money } from "../engine/money";
import { amtScreen, type AmtVerdict } from "../engine/amt";
import { bracketTax, bracketsFor } from "../engine/tax";
import type { FilingStatus } from "../data/schemas";
import { el, option } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
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
  taxableIncome: number;
  addBacks: number;
}

// A classic AMT trigger: a moderate regular taxable income alongside a large
// preference add-back (e.g. an incentive-stock-option bargain element), so the
// tentative minimum tax clears the regular tax.
const EXAMPLE: Fields = { fs: "married_jointly", taxableIncome: 200000, addBacks: 250000 };

const VERDICT: Record<AmtVerdict, string> = {
  likely: "Likely — your tentative minimum tax is above your regular tax. Run Form 6251.",
  maybe: "Maybe — you're close to the line. Worth checking Form 6251 to be sure.",
  none: "Probably not — your AMT income is under the exemption or well below the crossover.",
};

function isFilingStatus(v: string): v is FilingStatus {
  return FILING_STATUSES.some((f) => f.value === v);
}

function readFields(p: URLSearchParams, profile: SituationStore): Fields {
  const fs = p.get("fs");
  return {
    fs: fs && isFilingStatus(fs) ? fs : (profile.get("filingStatus") ?? "single"),
    taxableIncome: parseNonNegative(p.get("ti"), 0),
    addBacks: parseNonNegative(p.get("ab"), 0),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("fs", f.fs);
  p.set("ti", String(f.taxableIncome));
  p.set("ab", String(f.addBacks));
  return p;
}

export function mountAmtScreener(ctx: TileContext): void {
  const { root, data, profile } = ctx;
  root.replaceChildren();
  const amtData = data?.amt();
  const fed = data?.federal();
  if (!amtData || !fed) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "AMT or federal tax data is unavailable, verify before relying on any figure.",
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
  const tiInput = el("input", {
    type: "number",
    name: "ti",
    min: 0,
    step: 5000,
    value: fields.taxableIncome,
    attrs: { "aria-label": "Regular taxable income", inputmode: "decimal" },
  });
  const abInput = el("input", {
    type: "number",
    name: "ab",
    min: 0,
    step: 5000,
    value: fields.addBacks,
    attrs: { "aria-label": "AMT add-backs", inputmode: "decimal" },
  });

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const regularTax = bracketTax(Money.from(fields.taxableIncome), bracketsFor(fed!, fields.fs));
    const r = amtScreen(
      {
        filingStatus: fields.fs,
        amtIncome: fields.taxableIncome + fields.addBacks,
        regularTax: regularTax.toNumber(),
      },
      amtData!,
    );
    const fmt = (m: Money): string => m.format(ctx.locale);
    const lines: BreakdownLine[] = [
      {
        label: "AMT income estimate (taxable income + add-backs)",
        value: fmt(Money.from(fields.taxableIncome + fields.addBacks)),
      },
      { label: "AMT exemption", value: fmt(r.exemption), citation: amtData!.citation },
    ];
    if (r.exemptionPhaseout.greaterThan(0)) {
      lines.push({
        label: "Exemption lost to the high-income phase-out",
        value: fmt(r.exemptionPhaseout),
        citation: amtData!.citation,
      });
    }
    lines.push(
      { label: "AMT base (income above the exemption)", value: fmt(r.amtBase) },
      {
        label: "Tentative minimum tax (26% / 28%)",
        value: fmt(r.tentativeMinimumTax),
        citation: amtData!.citation,
      },
      {
        label: "Your regular federal income tax",
        value: fmt(r.regularTax),
        citation: fed!.citation,
      },
      { label: "Estimated AMT on top of regular tax", value: fmt(r.amtOwed), emphasis: true },
      { label: "Do you owe AMT?", value: VERDICT[r.verdict] },
      {
        label: "Note",
        value:
          'A coarse screen, not the full Form 6251. "Add-backs" are the big AMT adjustments — chiefly the state and local taxes you deducted, plus items like incentive-stock-option bargain elements. If this flags you, complete Form 6251 (or have your preparer do it).',
      },
    );

    resultContainer.replaceChildren(
      resultCard({
        label: "Estimated AMT on top of regular tax",
        value: r.amtOwed,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function recompute(): void {
    fields = {
      fs: isFilingStatus(fsSelect.value) ? fsSelect.value : "single",
      taxableIncome: parseNonNegative(tiInput.value, 0),
      addBacks: parseNonNegative(abInput.value, 0),
    };
    ctx.setParams(writeFields(fields));
    rememberShared(profile, { filingStatus: fields.fs });
    compute();
  }

  fsSelect.addEventListener("change", recompute);
  for (const i of [tiInput, abInput]) i.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    fsSelect.value = fields.fs;
    tiInput.value = String(fields.taxableIncome);
    abInput.value = String(fields.addBacks);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Filing status", fsSelect),
    field("Regular taxable income (1040 line 15)", tiInput),
    field("AMT add-backs (state/local taxes deducted, etc.)", abInput),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const amtScreenerTile: TileDefinition = {
  id: "amt-screener",
  title: "AMT Screener",
  pillar: "paycheck",
  description: "A quick check on whether you might owe the Alternative Minimum Tax.",
  keywords: [
    "amt",
    "alternative minimum tax",
    "form 6251",
    "6251",
    "exemption",
    "preference items",
    "iso",
    "salt",
  ],
  status: "ready",
  how: "The Alternative Minimum Tax is a parallel tax system: you figure your tax a second way, with fewer deductions, and pay the higher of the two. Most people never owe it, but it can catch high earners with large state-and-local-tax deductions or incentive-stock-option exercises.\n\nThis is a screener, not the full Form 6251. We estimate your AMT income (your regular taxable income plus the big add-backs you enter), subtract the AMT exemption for your filing status (which itself phases out at high income), and apply the 26%/28% AMT rates to get a tentative minimum tax. You owe AMT only to the extent that tentative tax exceeds your regular tax. We compute your regular tax from the federal brackets and compare. If the screen flags you, complete Form 6251. Figures are the 2026 amounts from IRS Rev. Proc. 2025-32.",
  resources: [
    {
      label: "IRS, topic on the Alternative Minimum Tax",
      url: "https://www.irs.gov/taxtopics/tc556",
    },
    { label: "IRS Form 6251", url: "https://www.irs.gov/forms-pubs/about-form-6251" },
  ],
  mount: mountAmtScreener,
};
