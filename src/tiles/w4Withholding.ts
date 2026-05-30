/**
 * W-4 Withholding & Refund Reality Check (BUILD-SPEC-2 §6.4). The plain truth a
 * pay stub never spells out: a tax refund is an interest-free loan you made to
 * the government. This tile projects your federal income tax for the year, projects
 * what your current W-4 withholds, and shows the gap — a refund (you over-withheld)
 * or a balance due (you under-withheld) — then suggests the per-paycheck W-4 tweak
 * that lands you near zero so the money rides in your own account all year instead.
 *
 * The W-4 governs FEDERAL INCOME TAX withholding only, so that's all this tool
 * touches: FICA (Social Security + Medicare) isn't adjustable on a W-4, and state
 * withholding has its own form. Built on the same deterministic federal tax engine
 * as the take-home tile, so the projected tax matches everywhere. Filing status
 * and wages flow to and from My Situation.
 */
import { Money } from "../engine/money";
import { evaluateTaxes, type TaxInput } from "../engine/tax";
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

const FREQUENCIES: { value: number; label: string }[] = [
  { value: 52, label: "Weekly (52/yr)" },
  { value: 26, label: "Every two weeks (26/yr)" },
  { value: 24, label: "Twice a month (24/yr)" },
  { value: 12, label: "Monthly (12/yr)" },
];

// A labeled assumption (no external rule to cite, like the 50/30/20 framework):
// what an over-withheld dollar could have earned in a high-yield savings account,
// held on average about half the year before the refund arrives.
const ASSUMED_SAVINGS_RATE = 0.04;
const AVG_HELD_FRACTION = 0.5;

interface Fields {
  fs: FilingStatus;
  wages: number;
  periods: number;
  perPaycheck: number;
  extra: number;
}

const EXAMPLE: Fields = { fs: "single", wages: 70000, periods: 26, perPaycheck: 420, extra: 0 };

function isFilingStatus(v: string): v is FilingStatus {
  return FILING_STATUSES.some((f) => f.value === v);
}

function readFields(p: URLSearchParams, profile: SituationStore): Fields {
  const fs = p.get("fs");
  const per = Math.round(parseNonNegative(p.get("pf"), 26));
  return {
    fs: fs && isFilingStatus(fs) ? fs : (profile.get("filingStatus") ?? "single"),
    wages: p.has("w") ? parseNonNegative(p.get("w"), 0) : (profile.get("annualIncome") ?? 0),
    periods: FREQUENCIES.some((f) => f.value === per) ? per : 26,
    perPaycheck: parseNonNegative(p.get("wh"), 0),
    extra: parseNonNegative(p.get("ex"), 0),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("fs", f.fs);
  p.set("w", String(f.wages));
  p.set("pf", String(f.periods));
  if (f.perPaycheck > 0) p.set("wh", String(f.perPaycheck));
  if (f.extra > 0) p.set("ex", String(f.extra));
  return p;
}

export function mountW4Withholding(ctx: TileContext): void {
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
  const pfSelect = el(
    "select",
    { name: "pf", attrs: { "aria-label": "Pay frequency" } },
    ...FREQUENCIES.map((f) => option(String(f.value), f.label, f.value === fields.periods)),
  );
  // Force the resolved values onto the controls — setting an option's `selected`
  // alone doesn't reliably drive the select's value (matches paycheckOptimizer).
  fsSelect.value = fields.fs;
  pfSelect.value = String(fields.periods);
  const mkNum = (name: string, label: string, value: number, step: number): HTMLInputElement =>
    el("input", {
      type: "number",
      name,
      min: 0,
      step,
      value,
      attrs: { "aria-label": label, inputmode: "decimal" },
    });
  const wInput = mkNum("w", "Gross annual wages", fields.wages, 1000);
  const whInput = mkNum("wh", "Federal tax withheld per paycheck", fields.perPaycheck, 10);
  const exInput = mkNum("ex", "Extra withholding per paycheck", fields.extra, 10);

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  /** Projected annual FEDERAL INCOME TAX for the wages (W-4 governs this only). */
  function projectedFederalTax(): Money {
    const input: TaxInput = { filingStatus: fields.fs, wages: Math.max(0, fields.wages) };
    return evaluateTaxes(input, { federal: fed!, fica: fica! }).federal.incomeTax;
  }

  function compute(): void {
    const tax = projectedFederalTax();
    const perPay = Money.from(fields.perPaycheck).add(fields.extra);
    const withholding = perPay.multiply(fields.periods);
    const gap = withholding.subtract(tax); // + over-withheld (refund), − under-withheld (owe)
    const fmt = (m: Money): string => m.format(ctx.locale);

    const overWithheld = gap.greaterThan(0);
    const balanced = gap.abs().lessThan(100); // within ~$100 for the year ≈ on target

    const lines: BreakdownLine[] = [
      {
        label: "Projected federal income tax this year",
        value: fmt(tax),
        citation: fed!.citation,
      },
      {
        label: `Projected withholding (${fmt(perPay)} × ${fields.periods})`,
        value: fmt(withholding),
      },
      {
        label: overWithheld ? "Projected refund" : "Projected balance due",
        value: fmt(gap.abs()),
        emphasis: true,
      },
    ];

    if (overWithheld && !balanced) {
      const forgone = gap.multiply(ASSUMED_SAVINGS_RATE * AVG_HELD_FRACTION);
      const perPaycheckLess = gap.divide(fields.periods);
      lines.push(
        {
          label: "What that refund really is",
          value: `A ${fmt(gap)} interest-free loan to the government — your money, locked up for up to a year, then handed back with no interest.`,
        },
        {
          label: "Forgone interest (assumption)",
          value: `About ${fmt(forgone)}, at a ${(ASSUMED_SAVINGS_RATE * 100).toFixed(0)}% savings rate held ~half the year. A labeled estimate, not a rule.`,
        },
        {
          label: "To keep that money in your paycheck",
          value: `Reduce withholding by about ${fmt(perPaycheckLess)} per paycheck. On the W-4, claim dependents/deductions in Steps 3–4(b), or lower any extra amount in Step 4(c).`,
        },
      );
    } else if (!overWithheld && !balanced) {
      const perPaycheckMore = gap.abs().divide(fields.periods);
      lines.push(
        {
          label: "Heads up",
          value: `You're under-withholding — at tax time you'd owe about ${fmt(gap.abs())}, and a large gap can trigger an underpayment penalty.`,
        },
        {
          label: "To avoid a surprise bill",
          value: `Withhold about ${fmt(perPaycheckMore)} more per paycheck. On the W-4, add that amount in Step 4(c).`,
        },
      );
    } else {
      lines.push({
        label: "You're dialed in",
        value:
          "Your withholding lands within a paycheck of your projected tax — close to the ideal of a refund near zero, with the money in your hands all year.",
      });
    }

    const headlineLabel = balanced
      ? "You're about even"
      : overWithheld
        ? "Your projected refund"
        : "You'll likely owe";

    resultContainer.replaceChildren(
      resultCard({
        label: headlineLabel,
        value: gap.abs(),
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function recompute(): void {
    fields = {
      fs: isFilingStatus(fsSelect.value) ? fsSelect.value : "single",
      wages: parseNonNegative(wInput.value, 0),
      periods: Math.round(parseNonNegative(pfSelect.value, 26)),
      perPaycheck: parseNonNegative(whInput.value, 0),
      extra: parseNonNegative(exInput.value, 0),
    };
    ctx.setParams(writeFields(fields));
    rememberShared(profile, { filingStatus: fields.fs, annualIncome: fields.wages });
    compute();
  }

  for (const s of [fsSelect, pfSelect]) s.addEventListener("change", recompute);
  for (const i of [wInput, whInput, exInput]) i.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    fsSelect.value = fields.fs;
    pfSelect.value = String(fields.periods);
    wInput.value = String(fields.wages);
    whInput.value = String(fields.perPaycheck);
    exInput.value = String(fields.extra);
    recompute();
  });

  const intro = el("p", {
    class: "screener-intro",
    text: "A refund feels like a windfall, but it's really an interest-free loan you made to the government — your own money handed back with no interest. This checks whether your W-4 is over- or under-withholding and suggests a tweak to land near zero.",
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Filing status", fsSelect),
    field("Gross annual wages", wInput),
    field("Pay frequency", pfSelect),
    field("Federal tax withheld per paycheck", whInput),
    field("Extra withholding per paycheck", exInput),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(intro, form, resultContainer);
  compute();
}

export const w4WithholdingTile: TileDefinition = {
  id: "w4",
  title: "W-4 Withholding & Refund Check",
  pillar: "paycheck",
  description:
    "A refund is an interest-free loan to the government — tune your W-4 to land near zero.",
  keywords: [
    "w4",
    "w-4",
    "withholding",
    "refund",
    "interest free loan",
    "allowances",
    "owe",
    "tax refund",
    "paycheck",
  ],
  status: "ready",
  how: "Most people aim for a big tax refund, but a refund is not free money — it is an interest-free loan you made to the government. You overpaid your taxes a little out of every paycheck all year, and the refund is simply that overpayment handed back, with no interest. The ideal is a refund near zero: you keep your own money as you earn it (in a savings account, paying down debt, or invested) instead of lending it out for free.\n\nThis tool projects your federal income tax for the year from your wages and filing status using the same engine as the take-home tile, then compares it to what your current W-4 withholds (your per-paycheck federal withholding times your number of pay periods, plus any extra). If you are over-withholding it shows the refund, what that refund is really costing you in forgone interest, and how much less to withhold per paycheck. If you are under-withholding it shows the likely bill and how much more to withhold.\n\nThe W-4 controls federal income tax withholding only, so that is all this covers — Social Security and Medicare (FICA) are fixed and not on the W-4, and state withholding uses a separate state form. Adjust your real W-4 with your employer or in the IRS Tax Withholding Estimator; these figures point you in the right direction.",
  resources: [
    {
      label: "IRS Tax Withholding Estimator",
      url: "https://www.irs.gov/individuals/tax-withholding-estimator",
    },
    { label: "IRS, About Form W-4", url: "https://www.irs.gov/forms-pubs/about-form-w-4" },
  ],
  mount: mountW4Withholding,
};
