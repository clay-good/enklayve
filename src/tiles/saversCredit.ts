/**
 * Saver's Credit tile (BUILD-SPEC.md §4.2): the Retirement Savings Contributions
 * Credit. A non-refundable credit of 50%, 20%, or 10% of up to a capped
 * contribution, with the rate stepping down as AGI rises through filing-status
 * ceilings. Cited to IRS Form 8880. Reads income and retirement contributions
 * from My Situation so it pre-fills from what other tools already know.
 */
import { Money } from "../engine/money";
import { estimateSaversCredit } from "../engine/benefits";
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
  agi: number;
  contributions: number;
}

const EXAMPLE: Fields = { fs: "single", agi: 21000, contributions: 2000 };

function isFilingStatus(v: string): v is FilingStatus {
  return FILING_STATUSES.some((f) => f.value === v);
}

function readFields(p: URLSearchParams, profile: SituationStore): Fields {
  const fs = p.get("fs");
  return {
    fs: fs && isFilingStatus(fs) ? fs : (profile.get("filingStatus") ?? "single"),
    agi: p.has("agi") ? parseNonNegative(p.get("agi"), 0) : (profile.get("annualIncome") ?? 0),
    contributions: p.has("c")
      ? parseNonNegative(p.get("c"), 0)
      : (profile.get("retirementContributionsAnnual") ?? 0),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("fs", f.fs);
  p.set("agi", String(f.agi));
  p.set("c", String(f.contributions));
  return p;
}

export function mountSaversCredit(ctx: TileContext): void {
  const { root, data, profile } = ctx;
  root.replaceChildren();
  const savers = data?.saversCredit();
  if (!savers) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "Saver's Credit data is unavailable, verify before relying on any figure.",
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
  const agiInput = el("input", {
    type: "number",
    name: "agi",
    min: 0,
    step: 1000,
    value: fields.agi,
    attrs: { "aria-label": "Adjusted gross income", inputmode: "decimal" },
  });
  const cInput = el("input", {
    type: "number",
    name: "c",
    min: 0,
    step: 500,
    value: fields.contributions,
    attrs: { "aria-label": "Retirement contributions this year", inputmode: "decimal" },
  });

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const r = estimateSaversCredit(
      { agi: fields.agi, filingStatus: fields.fs, contributions: fields.contributions },
      savers!,
    );
    const fmt = (m: Money): string => m.format(ctx.locale);
    const lines: BreakdownLine[] = [
      {
        label: "Contributions counted",
        value: fmt(r.eligibleContributions),
        citation: savers!.citation,
      },
      {
        label: "Credit rate at your income",
        value: r.rate > 0 ? pct(r.rate, 0) : "0% (above the income limit)",
        citation: savers!.citation,
      },
      {
        label: "Estimated Saver's Credit",
        value: fmt(r.credit),
        emphasis: true,
        citation: savers!.citation,
      },
      {
        label: "Note",
        value:
          "Non-refundable: it offsets tax you owe, but doesn't pay out beyond that. You must also be 18+, not a full-time student, and not claimed as a dependent.",
      },
    ];

    resultContainer.replaceChildren(
      resultCard({
        label: "Estimated Saver's Credit",
        value: r.credit,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function recompute(): void {
    fields = {
      fs: isFilingStatus(fsSelect.value) ? fsSelect.value : "single",
      agi: parseNonNegative(agiInput.value, 0),
      contributions: parseNonNegative(cInput.value, 0),
    };
    ctx.setParams(writeFields(fields));
    rememberShared(profile, { filingStatus: fields.fs, annualIncome: fields.agi });
    profile.set("retirementContributionsAnnual", fields.contributions);
    compute();
  }

  fsSelect.addEventListener("change", recompute);
  for (const i of [agiInput, cInput]) i.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    fsSelect.value = fields.fs;
    agiInput.value = String(fields.agi);
    cInput.value = String(fields.contributions);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Filing status", fsSelect),
    field("Adjusted gross income", agiInput),
    field("Retirement contributions this year", cInput),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const saversCreditTile: TileDefinition = {
  id: "savers-credit",
  title: "Saver's Credit",
  pillar: "owed",
  description: "Eligibility and amount for retirement savers.",
  keywords: ["savers credit", "retirement", "credit", "form 8880", "8880"],
  status: "ready",
  how: "The Saver's Credit rewards retirement contributions if your income is modest. The credit is 50%, 20%, or 10% of up to $2,000 of contributions ($4,000 if married filing jointly), and the rate steps down as your adjusted gross income rises through the limits for your filing status. We use the published 2024 figures.\n\nIt's non-refundable, so it reduces tax you owe but won't pay out beyond that. You also must be at least 18, not a full-time student, and not claimed as someone's dependent.",
  resources: [
    {
      label: "IRS, Retirement Savings Contributions Credit",
      url: "https://www.irs.gov/retirement-plans/plan-participant-employee/retirement-savings-contributions-savers-credit",
    },
    { label: "IRS Form 8880", url: "https://www.irs.gov/forms-pubs/about-form-8880" },
  ],
  mount: mountSaversCredit,
};
