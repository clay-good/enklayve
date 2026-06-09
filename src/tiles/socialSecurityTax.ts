/**
 * Social Security Taxation tile (IRC §86, IRS Pub. 915). "How much of my Social
 * Security is taxable?" Answers the question most retirees get wrong — neither 0%
 * nor 100% but a sliding 0/50/85% set by *provisional income* against two
 * statutory (never-indexed) base amounts. Gates on the social-security-taxation
 * shard; every base amount carries the §86 citation. Companion to the Social
 * Security Claiming Age tile in the same hub.
 */
import { Money } from "../engine/money";
import { socialSecurityBenefitTaxation } from "../engine/socialSecurityTax";
import type { FilingStatus } from "../data/schemas";
import { el, option } from "../ui/dom";
import { field, parseNonNegative, pct, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import type { TileContext, TileDefinition } from "./types";

// Single / head of household / qualifying surviving spouse share the $25k/$34k
// bases; married jointly uses $32k/$44k. (Married-filing-separately-with-spouse,
// a $0/$0 special case, is left out — see the shard note.)
const STATUSES: { value: "single" | "married_jointly" | "head_of_household"; label: string }[] = [
  { value: "single", label: "Single" },
  { value: "married_jointly", label: "Married filing jointly" },
  { value: "head_of_household", label: "Head of household" },
];

interface Fields {
  fs: "single" | "married_jointly" | "head_of_household";
  ss: number;
  other: number;
  exempt: number;
}

const EXAMPLE: Fields = { fs: "single", ss: 24000, other: 30000, exempt: 0 };

function isStatus(v: string): v is Fields["fs"] {
  return STATUSES.some((s) => s.value === v);
}

function readFields(p: URLSearchParams): Fields {
  const fs = p.get("fs");
  return {
    fs: fs && isStatus(fs) ? fs : "single",
    ss: parseNonNegative(p.get("ss"), 0),
    other: parseNonNegative(p.get("oi"), 0),
    exempt: parseNonNegative(p.get("ti"), 0),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("fs", f.fs);
  p.set("ss", String(f.ss));
  if (f.other > 0) p.set("oi", String(f.other));
  if (f.exempt > 0) p.set("ti", String(f.exempt));
  return p;
}

export function mountSocialSecurityTax(ctx: TileContext): void {
  const { root, data } = ctx;
  root.replaceChildren();
  const params = data?.socialSecurityTaxation();
  if (!params) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "Social Security taxation data is unavailable, verify before relying on any figure.",
      }),
    );
    return;
  }
  const ssTax = params;
  let fields = readFields(ctx.params);

  const fsSelect = el(
    "select",
    { name: "fs", attrs: { "aria-label": "Filing status" } },
    ...STATUSES.map((s) => option(s.value, s.label, s.value === fields.fs)),
  );
  fsSelect.value = fields.fs;
  const mkNum = (name: string, label: string, value: number): HTMLInputElement =>
    el("input", {
      type: "number",
      name,
      min: 0,
      step: 1000,
      value,
      attrs: { "aria-label": label, inputmode: "decimal" },
    });
  const ssInput = mkNum("ss", "Annual Social Security benefits", fields.ss);
  const otherInput = mkNum("oi", "Other income (AGI excluding Social Security)", fields.other);
  const exemptInput = mkNum("ti", "Tax-exempt interest", fields.exempt);

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const status = fields.fs as FilingStatus;
    const base1 = ssTax.base1ByFilingStatus[status] ?? ssTax.base1ByFilingStatus.single ?? 0;
    const base2 = ssTax.base2ByFilingStatus[status] ?? ssTax.base2ByFilingStatus.single ?? 0;
    const r = socialSecurityBenefitTaxation(
      {
        socialSecurityBenefits: fields.ss,
        otherIncome: fields.other,
        taxExemptInterest: fields.exempt,
      },
      {
        base1,
        base2,
        tier1InclusionRate: ssTax.tier1InclusionRate,
        tier2InclusionRate: ssTax.tier2InclusionRate,
      },
    );
    const fmt = (m: Money): string => m.format(ctx.locale);
    const tierNote =
      r.tier === "none"
        ? `Your provisional income is at or below $${base1.toLocaleString()}, so none of your Social Security is taxable.`
        : r.tier === "up-to-50"
          ? `Your provisional income is between $${base1.toLocaleString()} and $${base2.toLocaleString()}, so up to half of your benefit is taxable.`
          : `Your provisional income is above $${base2.toLocaleString()}, so up to 85% of your benefit is taxable — Social Security is never more than 85% taxable.`;
    const lines: BreakdownLine[] = [
      {
        label: "Provisional income (other income + tax-exempt interest + ½ benefits)",
        value: fmt(r.provisionalIncome),
        citation: ssTax.citation,
      },
      { label: "Taxable portion of your benefit", value: fmt(r.taxableBenefits), emphasis: true },
      { label: "Tax-free portion of your benefit", value: fmt(r.nonTaxableBenefits) },
      {
        label: "Share of your benefit that's taxable",
        value: r.percentTaxable > 0 ? pct(r.percentTaxable, 1) : "0%",
      },
      { label: "How the threshold works", value: tierNote, citation: ssTax.citation },
    ];

    resultContainer.replaceChildren(
      resultCard({
        label: "Taxable Social Security benefits",
        value: r.taxableBenefits,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function recompute(): void {
    fields = {
      fs: isStatus(fsSelect.value) ? fsSelect.value : "single",
      ss: parseNonNegative(ssInput.value, 0),
      other: parseNonNegative(otherInput.value, 0),
      exempt: parseNonNegative(exemptInput.value, 0),
    };
    ctx.setParams(writeFields(fields));
    compute();
  }

  fsSelect.addEventListener("change", recompute);
  for (const i of [ssInput, otherInput, exemptInput]) i.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    fsSelect.value = fields.fs;
    ssInput.value = String(fields.ss);
    otherInput.value = String(fields.other);
    exemptInput.value = String(fields.exempt);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Filing status", fsSelect),
    field("Annual Social Security benefits", ssInput),
    field("Other income (your AGI excluding Social Security)", otherInput),
    field("Tax-exempt interest (e.g. municipal bonds)", exemptInput),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const socialSecurityTaxTile: TileDefinition = {
  id: "social-security-tax",
  title: "Social Security Taxation",
  pillar: "retirement",
  description: "How much of your Social Security benefit is taxable (the IRC §86 0/50/85% rule).",
  keywords: [
    "social security tax",
    "social security taxable",
    "taxable benefits",
    "provisional income",
    "combined income",
    "85%",
    "irc 86",
    "section 86",
    "pub 915",
    "retirement income",
    "is my social security taxed",
  ],
  status: "ready",
  how: "Most people think Social Security is either fully taxed or not taxed at all. It's neither: a sliding 0%, up to 50%, or up to 85% of your benefit is taxable, depending on your 'provisional income' — your other income (your AGI without Social Security) plus any tax-exempt interest plus half of your benefits.\n\nThere are two base amounts (single $25,000 / $34,000; married jointly $32,000 / $44,000). Below the first, none of your benefit is taxable. Between the two, up to half is. Above the second, up to 85% is — and 85% is the most that's ever taxable, no matter how high your income. These thresholds are written into the law (IRC §86) and have never been adjusted for inflation, so the same numbers apply every year, which is why more retirees cross them over time.\n\nEnter your annual benefit, your other income, and any tax-exempt interest. We follow the IRS Publication 915 worksheet exactly to show how much of your benefit lands in taxable income — that taxable portion is then taxed at your ordinary rate, so pair it with the Take-Home or Federal Income Tax tools to see the dollars.",
  resources: [
    {
      label: "IRS Publication 915 (Social Security benefits)",
      url: "https://www.irs.gov/pub/irs-pdf/p915.pdf",
    },
    {
      label: "SSA, income taxes and your Social Security benefit",
      url: "https://www.ssa.gov/benefits/retirement/planner/taxes.html",
    },
    {
      label: "26 U.S. Code §86 (taxation of Social Security benefits)",
      url: "https://www.law.cornell.edu/uscode/text/26/86",
    },
  ],
  related: [
    {
      hubId: "retirement",
      tool: "social-security",
      label: "Social Security Claiming Age",
      note: "what your benefit is at 62, full retirement age, and 70",
    },
    {
      hubId: "paycheck-taxes",
      tool: "federal-income-tax",
      label: "Federal Income Tax",
      note: "the tax on the taxable portion at your ordinary rate",
    },
  ],
  mount: mountSocialSecurityTax,
};
