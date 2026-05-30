/**
 * 1099 Contract vs W-2 Salary (BUILD-SPEC-2 §6.4). A contractor rate and a salary
 * aren't the same money. As a 1099 worker you pay both halves of Social Security
 * and Medicare (an employee's employer covers half), and you self-fund the benefits
 * a job often includes. So a $X/hr contract is worth less than a salary that "looks"
 * the same. This translates a contractor rate into the rough W-2 salary it equals,
 * subtracting the employer-side FICA and the benefits you have to buy yourself.
 *
 * It's a rule-of-thumb translation, clearly labeled — not an exact equalize-the-
 * take-home solve — so it stays simple and honest.
 */
import { Money } from "../engine/money";
import { selfEmploymentTax } from "../engine/tax";
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
  rate: number;
  hours: number;
  benefits: number;
}

const EXAMPLE: Fields = { fs: "single", rate: 75, hours: 2000, benefits: 12000 };

function isFilingStatus(v: string): v is FilingStatus {
  return FILING_STATUSES.some((f) => f.value === v);
}

function readFields(p: URLSearchParams, profile: SituationStore): Fields {
  const fs = p.get("fs");
  return {
    fs: fs && isFilingStatus(fs) ? fs : (profile.get("filingStatus") ?? "single"),
    rate: parseNonNegative(p.get("r"), 0),
    hours: p.has("h") ? parseNonNegative(p.get("h"), 0) : 2080,
    benefits: parseNonNegative(p.get("b"), 0),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("fs", f.fs);
  p.set("r", String(f.rate));
  p.set("h", String(f.hours));
  if (f.benefits > 0) p.set("b", String(f.benefits));
  return p;
}

export function mountContractVsSalary(ctx: TileContext): void {
  const { root, data, profile } = ctx;
  root.replaceChildren();
  const fica = data?.fica();
  if (!fica) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "FICA data is unavailable, verify before relying on any figure.",
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
  fsSelect.value = fields.fs;
  const mkNum = (name: string, label: string, value: number, step: number): HTMLInputElement =>
    el("input", {
      type: "number",
      name,
      min: 0,
      step,
      value,
      attrs: { "aria-label": label, inputmode: "decimal" },
    });
  const rInput = mkNum("r", "Contractor rate per hour", fields.rate, 5);
  const hInput = mkNum("h", "Billable hours per year", fields.hours, 50);
  const bInput = mkNum("b", "Benefits you'd self-fund per year", fields.benefits, 500);

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const gross = Money.from(fields.rate * fields.hours);
    const se = selfEmploymentTax(gross, fields.fs, fica!);

    // Employer-side FICA an employer would have paid for an employee: 6.2% Social
    // Security up to the wage base + 1.45% Medicare on all wages (~7.65%).
    const wageBase = fica!.socialSecurityWageBase;
    const ssBase = gross.greaterThan(wageBase) ? Money.from(wageBase) : gross;
    const employerFica = ssBase
      .multiply(fica!.socialSecurityRate)
      .add(gross.multiply(fica!.medicareRate));

    const equivalent = gross.subtract(employerFica).subtract(fields.benefits);
    const equivalentSalary = equivalent.isNegative() ? Money.zero() : equivalent;
    const fmt = (m: Money): string => m.format(ctx.locale);

    const lines: BreakdownLine[] = [
      {
        label: `Contractor gross (${fmt(Money.from(fields.rate))}/hr × ${fields.hours.toLocaleString(ctx.locale)} hrs)`,
        value: fmt(gross),
      },
      {
        label: "Self-employment tax you pay (both halves)",
        value: fmt(se.total),
        citation: se.citation,
      },
      {
        label: "Employer-side FICA an employer would cover (~7.65%)",
        value: fmt(employerFica),
        citation: fica!.citation,
      },
      { label: "Benefits you self-fund", value: fmt(Money.from(fields.benefits)) },
      { label: "Roughly equal to a W-2 salary of", value: fmt(equivalentSalary), emphasis: true },
      {
        label: "Flip it",
        value: `To match a salary offer, charge about the salary plus that employer FICA and benefits back: a common rule of thumb is a contractor rate 1.25–1.4× the salary's hourly wage.`,
      },
      {
        label: "Rule of thumb",
        value:
          "This subtracts the employer's costs from your gross; it doesn't equalize take-home tax exactly. Use it to compare an offer, not file a return.",
      },
    ];

    resultContainer.replaceChildren(
      resultCard({
        label: "This contract ≈ a W-2 salary of",
        value: equivalentSalary,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function recompute(): void {
    fields = {
      fs: isFilingStatus(fsSelect.value) ? fsSelect.value : "single",
      rate: parseNonNegative(rInput.value, 0),
      hours: parseNonNegative(hInput.value, 0),
      benefits: parseNonNegative(bInput.value, 0),
    };
    ctx.setParams(writeFields(fields));
    rememberShared(profile, { filingStatus: fields.fs });
    compute();
  }

  fsSelect.addEventListener("change", recompute);
  for (const i of [rInput, hInput, bInput]) i.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    fsSelect.value = fields.fs;
    rInput.value = String(fields.rate);
    hInput.value = String(fields.hours);
    bInput.value = String(fields.benefits);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Filing status", fsSelect),
    field("Contractor rate per hour", rInput),
    field("Billable hours per year", hInput),
    field("Benefits you'd self-fund per year", bInput),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const contractVsSalaryTile: TileDefinition = {
  id: "contract-vs-salary",
  title: "1099 Contract vs W-2 Salary",
  pillar: "paycheck",
  description: "Translate a contractor rate into the equivalent employee salary.",
  keywords: [
    "self employed",
    "1099",
    "freelance",
    "contractor",
    "gig",
    "w2",
    "w-2",
    "salary",
    "contract",
    "rate",
  ],
  status: "ready",
  how: "A contractor rate and a salary look comparable but aren't. As a W-2 employee, your employer quietly pays half of your Social Security and Medicare (about 7.65% of your wages) and often covers benefits like health insurance, retirement matching, and paid time off. As a 1099 contractor you pay all of that yourself: both halves of FICA via self-employment tax, and every benefit out of pocket.\n\nSo we take your contractor gross (rate × billable hours), subtract the employer-side FICA an employer would otherwise have paid, and subtract the benefits you have to self-fund, to land on the rough W-2 salary your contract is worth. Flip it the other way and it shows why contractors typically charge well above a salaried worker's hourly wage.\n\nThis is a rule-of-thumb comparison to weigh an offer, not an exact, take-home-equalizing tax calculation; for your real tax, use the Quarterly Taxes tool. Filing status flows to and from My Situation.",
  resources: [
    {
      label: "IRS, independent contractor vs employee",
      url: "https://www.irs.gov/businesses/small-businesses-self-employed/independent-contractor-self-employed-or-employee",
    },
  ],
  mount: mountContractVsSalary,
};
