/**
 * Selling a Home: the Taxable Gain, the interactive half (SPEC-5 Phase 28).
 * Loaded on first use with its shard; the definition in `homeSaleGain.ts`
 * stays in the shell. The tax on what §121 leaves comes from the capital-gains
 * engine and carries that shard's citation, never one of its own (SPEC-5 §4,
 * addition 12).
 */
import { Money } from "../engine/money";
import { estimateCapitalGains } from "../engine/capitalGains";
import { homeSaleGain } from "../engine/homeSale";
import type { FilingStatus } from "../data/schemas";
import { el, option } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import type { TileContext } from "./types";

const FILING_STATUSES: { value: FilingStatus; label: string }[] = [
  { value: "single", label: "Single" },
  { value: "married_jointly", label: "Married filing jointly" },
  { value: "married_separately", label: "Married filing separately" },
  { value: "head_of_household", label: "Head of household" },
  { value: "qualifying_surviving_spouse", label: "Qualifying surviving spouse" },
];

interface Fields {
  fs: FilingStatus;
  price: number;
  costs: number;
  basis: number;
  owned: number;
  lived: number;
  /** Months since a prior excluded sale, or null for none. */
  prior: number | null;
  reason: boolean;
  /** Other taxable income this year, beneath the gain. */
  other: number;
}

const EXAMPLE: Fields = {
  fs: "single",
  price: 600000,
  costs: 36000,
  basis: 300000,
  owned: 60,
  lived: 60,
  prior: null,
  reason: false,
  other: 80000,
};

function isFilingStatus(v: string): v is FilingStatus {
  return FILING_STATUSES.some((f) => f.value === v);
}

function readFields(p: URLSearchParams, ctx: TileContext): Fields {
  const fs = p.get("fs");
  const prior = p.get("pr");
  return {
    fs: fs && isFilingStatus(fs) ? fs : (ctx.profile.get("filingStatus") ?? "single"),
    price: parseNonNegative(p.get("sp"), 0),
    costs: parseNonNegative(p.get("sc"), 0),
    basis: parseNonNegative(p.get("b"), 0),
    owned: Math.round(parseNonNegative(p.get("own"), 60)),
    lived: Math.round(parseNonNegative(p.get("use"), 60)),
    prior: prior !== null && prior.trim() !== "" ? Math.round(parseNonNegative(prior, 0)) : null,
    reason: p.get("why") === "1",
    other: p.has("oth")
      ? parseNonNegative(p.get("oth"), 0)
      : (ctx.profile.get("annualIncome") ?? 0),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("fs", f.fs);
  p.set("sp", String(f.price));
  p.set("sc", String(f.costs));
  p.set("b", String(f.basis));
  p.set("own", String(f.owned));
  p.set("use", String(f.lived));
  if (f.prior !== null) p.set("pr", String(f.prior));
  if (f.reason) p.set("why", "1");
  p.set("oth", String(f.other));
  return p;
}

export function mountHomeSaleGain(ctx: TileContext): void {
  const { root, data } = ctx;
  root.replaceChildren();
  const rules = data?.homeSaleExclusion();
  const fed = data?.federal();
  const cg = data?.capitalGains();
  if (!rules || !fed || !cg) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "The home-sale or capital-gains rules are unavailable, so no figure is given.",
      }),
    );
    return;
  }
  let fields = readFields(ctx.params, ctx);

  const fsSelect = el(
    "select",
    { name: "fs", attrs: { "aria-label": "Filing status" } },
    ...FILING_STATUSES.map((s) => option(s.value, s.label, s.value === fields.fs)),
  );
  const num = (name: string, value: number | string, label: string, step: number) =>
    el("input", {
      type: "number",
      name,
      min: 0,
      step,
      value,
      attrs: { "aria-label": label, inputmode: "decimal" },
    });
  const priceInput = num("sp", fields.price, "Sale price", 1000);
  const costsInput = num("sc", fields.costs, "Costs of selling", 500);
  const basisInput = num("b", fields.basis, "What you paid, plus improvements", 1000);
  const ownedInput = num("own", fields.owned, "Months owned, of the last five years", 1);
  const livedInput = num("use", fields.lived, "Months lived in it, of the last five years", 1);
  const priorInput = num(
    "pr",
    fields.prior ?? "",
    "Months since an earlier sale used this exclusion (blank if none)",
    1,
  );
  const reasonInput = el("input", {
    type: "checkbox",
    name: "why",
    attrs: { "aria-label": "Sold because of a job move, health, or an unforeseen event" },
  });
  reasonInput.checked = fields.reason;
  const otherInput = num("oth", fields.other, "Other taxable income this year", 1000);

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const r = homeSaleGain(
      {
        joint: fields.fs === "married_jointly",
        salePrice: fields.price,
        sellingCosts: fields.costs,
        basis: fields.basis,
        monthsOwned: fields.owned,
        monthsLived: fields.lived,
        monthsSincePriorExclusion: fields.prior,
        qualifyingReason: fields.reason,
      },
      rules!,
    );
    const taxable = r.taxableGain.toNumber();
    const tax = estimateCapitalGains(
      {
        filingStatus: fields.fs,
        ordinaryTaxableIncome: fields.other,
        shortTermGain: r.longTerm ? 0 : taxable,
        longTermGain: r.longTerm ? taxable : 0,
        modifiedAgi: fields.other + taxable,
      },
      fed!,
      cg!,
    );
    const fmt = (m: Money): string => m.format(ctx.locale);
    const cite = rules!.citation;
    const lines: BreakdownLine[] = [
      { label: "Gain: price less selling costs less what you paid", value: fmt(r.gain) },
      {
        label:
          r.basis === "full"
            ? "The exclusion you qualify for"
            : r.basis === "partial"
              ? `A partial exclusion, ${Math.round(r.share * 1000) / 10}% of the full limit, for a move you had to make`
              : "No exclusion",
        value: fmt(r.limit),
        citation: cite,
      },
      { label: "Gain excluded", value: fmt(r.excluded), citation: cite },
      {
        label: r.longTerm
          ? "Taxable gain, taxed as a long-term capital gain"
          : "Taxable gain, taxed as ordinary income (owned a year or less)",
        value: fmt(r.taxableGain),
        emphasis: true,
      },
    ];
    if (taxable > 0) {
      lines.push(
        {
          label: r.longTerm ? "Federal capital-gains tax on it" : "Federal income tax on it",
          value: fmt(r.longTerm ? tax.longTermTax : tax.shortTermTax),
          citation: r.longTerm ? cg!.citation : fed!.citation,
        },
        {
          label: "Net Investment Income Tax on it",
          value: fmt(tax.netInvestmentIncomeTax),
          citation: cg!.citation,
        },
      );
    }
    resultContainer.replaceChildren(
      resultCard({
        label: "Federal tax on the sale",
        value: tax.totalTax,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
      ...(r.shortOf.length > 0
        ? [
            el("p", {
              class: "hsg-short",
              text:
                (r.basis === "partial"
                  ? "The full exclusion needs more: you "
                  : "No exclusion applies, because you ") +
                r.shortOf.join(", and ") +
                (r.basis === "none"
                  ? ". If you sold because of a job move, health, or an unforeseen event, say so above: a share of the exclusion may still apply."
                  : "."),
            }),
          ]
        : []),
    );
  }

  function recompute(): void {
    const prior = priorInput.value.trim();
    fields = {
      fs: isFilingStatus(fsSelect.value) ? fsSelect.value : fields.fs,
      price: parseNonNegative(priceInput.value, 0),
      costs: parseNonNegative(costsInput.value, 0),
      basis: parseNonNegative(basisInput.value, 0),
      owned: Math.round(parseNonNegative(ownedInput.value, 0)),
      lived: Math.round(parseNonNegative(livedInput.value, 0)),
      prior: prior === "" ? null : Math.round(parseNonNegative(prior, 0)),
      reason: reasonInput.checked,
      other: parseNonNegative(otherInput.value, 0),
    };
    ctx.setParams(writeFields(fields));
    compute();
  }

  fsSelect.addEventListener("change", recompute);
  reasonInput.addEventListener("change", recompute);
  for (const i of [
    priceInput,
    costsInput,
    basisInput,
    ownedInput,
    livedInput,
    priorInput,
    otherInput,
  ])
    i.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    fsSelect.value = fields.fs;
    priceInput.value = String(fields.price);
    costsInput.value = String(fields.costs);
    basisInput.value = String(fields.basis);
    ownedInput.value = String(fields.owned);
    livedInput.value = String(fields.lived);
    priorInput.value = "";
    reasonInput.checked = false;
    otherInput.value = String(fields.other);
    recompute();
  });

  root.append(
    el(
      "form",
      { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
      field("Filing status", fsSelect),
      field("Sale price", priceInput),
      field("Costs of selling (commission, transfer taxes)", costsInput),
      field("What you paid, plus improvements", basisInput),
      field("Months owned, of the last five years", ownedInput),
      field("Months lived in it, of the last five years", livedInput),
      field("Months since an earlier sale used this exclusion (blank if none)", priorInput),
      field("Sold because of a job move, health, or an unforeseen event", reasonInput),
      field("Other taxable income this year", otherInput),
      el("div", { class: "tile-form-actions" }, tryExample),
    ),
    resultContainer,
  );
  compute();
}
