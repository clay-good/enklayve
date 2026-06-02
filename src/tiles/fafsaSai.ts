/**
 * FAFSA Student Aid Index estimator (BUILD-SPEC.md §4.4). Computes the
 * dependent-student SAI from the published 2024-25 federal methodology and the
 * bundled, cited Dept. of Education tables, showing every allowance and step.
 *
 * It is an estimate to verify: the formula is exact, but it points the user to
 * the official SAI Formula Guide and to their FAFSA Submission Summary to
 * confirm the figure (§2.1, §2.3). It also shows the Pell Grant the SAI implies.
 */
import { Money } from "../engine/money";
import { estimateSai, estimatePell } from "../engine/fafsa";
import { el } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import type { SituationStore } from "../profile/situation";
import type { TileContext, TileDefinition } from "./types";

interface Fields {
  parentIncome: number;
  parentTax: number;
  familySize: number;
  lowerEarnerIncome: number;
  parentAssets: number;
  studentIncome: number;
  studentTax: number;
  studentAssets: number;
}

const EXAMPLE: Fields = {
  parentIncome: 45000,
  parentTax: 1500,
  familySize: 4,
  lowerEarnerIncome: 18000,
  parentAssets: 5000,
  studentIncome: 4000,
  studentTax: 0,
  studentAssets: 1000,
};

function readFields(p: URLSearchParams, profile: SituationStore): Fields {
  return {
    parentIncome: p.has("pinc")
      ? parseNonNegative(p.get("pinc"), 0)
      : (profile.get("annualIncome") ?? 0),
    parentTax: parseNonNegative(p.get("ptax"), 0),
    familySize: p.has("size")
      ? Math.max(1, parseNonNegative(p.get("size"), 4))
      : (profile.get("householdSize") ?? 4),
    lowerEarnerIncome: parseNonNegative(p.get("earn2"), 0),
    parentAssets: parseNonNegative(p.get("passet"), 0),
    studentIncome: parseNonNegative(p.get("sinc"), 0),
    studentTax: parseNonNegative(p.get("stax"), 0),
    studentAssets: parseNonNegative(p.get("sasset"), 0),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("pinc", String(f.parentIncome));
  p.set("ptax", String(f.parentTax));
  p.set("size", String(f.familySize));
  p.set("earn2", String(f.lowerEarnerIncome));
  p.set("passet", String(f.parentAssets));
  p.set("sinc", String(f.studentIncome));
  p.set("stax", String(f.studentTax));
  p.set("sasset", String(f.studentAssets));
  return p;
}

export function mountFafsaSai(ctx: TileContext): void {
  const { root, data, profile } = ctx;
  root.replaceChildren();
  const maybeData = data?.fafsa() ?? null;
  if (!maybeData) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "FAFSA data is unavailable, verify before relying on any figure.",
      }),
    );
    return;
  }
  const fafsa = maybeData;
  const ssWageBase = data?.fica()?.socialSecurityWageBase ?? 168600;
  let fields = readFields(ctx.params, profile);

  const inputs = {
    pinc: numberInput("pinc", "Parents' total income (AGI + untaxed)", fields.parentIncome, 1000),
    ptax: numberInput("ptax", "Federal income tax the parents paid", fields.parentTax, 500),
    size: numberInput("size", "People in the parents' household", fields.familySize, 1),
    earn2: numberInput(
      "earn2",
      "Lower-earning parent's income (0 if one earner)",
      fields.lowerEarnerIncome,
      1000,
    ),
    passet: numberInput("passet", "Parents' savings & investments", fields.parentAssets, 1000),
    sinc: numberInput("sinc", "Student's income", fields.studentIncome, 500),
    stax: numberInput("stax", "Federal income tax the student paid", fields.studentTax, 100),
    sasset: numberInput("sasset", "Student's savings & investments", fields.studentAssets, 500),
  };

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const r = estimateSai(
      {
        parentIncome: fields.parentIncome,
        parentIncomeTax: fields.parentTax,
        familySize: fields.familySize,
        lowerEarnerIncome: fields.lowerEarnerIncome,
        parentAssets: fields.parentAssets,
        studentIncome: fields.studentIncome,
        studentIncomeTax: fields.studentTax,
        studentAssets: fields.studentAssets,
        ssWageBase,
      },
      fafsa,
    );
    const pell = estimatePell(r.sai, fafsa);
    const fmt = (n: number): string => Money.from(n).format(ctx.locale);
    const lines: BreakdownLine[] = [
      { label: "Income protection allowance", value: fmt(r.incomeProtectionAllowance) },
      { label: "Payroll-tax allowance", value: fmt(r.payrollAllowance) },
      { label: "Employment expense allowance", value: fmt(r.employmentExpenseAllowance) },
      { label: "Available income (after allowances)", value: fmt(r.availableIncome) },
      { label: "Contribution from parents' assets", value: fmt(r.assetContribution) },
      { label: "Parents' contribution", value: fmt(r.parentContribution) },
      { label: "Student's contribution", value: fmt(r.studentContribution) },
      {
        label: "Student Aid Index (SAI)",
        value: fmt(r.sai),
        emphasis: true,
        citation: fafsa.citation,
      },
      {
        label: "Estimated Pell Grant",
        value: pell.eligible ? `${pell.award.format(ctx.locale)} / year` : "Not Pell-eligible",
        citation: fafsa.citation,
      },
      {
        label: "Verify",
        value:
          "An estimate of the dependent-student SAI. Confirm it against the SAI Formula Guide and your FAFSA Submission Summary.",
      },
    ];

    resultContainer.replaceChildren(
      resultCard({
        label: "Estimated Student Aid Index",
        value: Money.from(r.sai),
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
        copyText: String(r.sai),
      }),
    );
  }

  function recompute(): void {
    fields = {
      parentIncome: parseNonNegative(inputs.pinc.value, 0),
      parentTax: parseNonNegative(inputs.ptax.value, 0),
      familySize: Math.max(1, parseNonNegative(inputs.size.value, 4)),
      lowerEarnerIncome: parseNonNegative(inputs.earn2.value, 0),
      parentAssets: parseNonNegative(inputs.passet.value, 0),
      studentIncome: parseNonNegative(inputs.sinc.value, 0),
      studentTax: parseNonNegative(inputs.stax.value, 0),
      studentAssets: parseNonNegative(inputs.sasset.value, 0),
    };
    ctx.setParams(writeFields(fields));
    profile.set("annualIncome", fields.parentIncome);
    profile.set("householdSize", fields.familySize);
    compute();
  }

  for (const input of Object.values(inputs)) input.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    inputs.pinc.value = String(fields.parentIncome);
    inputs.ptax.value = String(fields.parentTax);
    inputs.size.value = String(fields.familySize);
    inputs.earn2.value = String(fields.lowerEarnerIncome);
    inputs.passet.value = String(fields.parentAssets);
    inputs.sinc.value = String(fields.studentIncome);
    inputs.stax.value = String(fields.studentTax);
    inputs.sasset.value = String(fields.studentAssets);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Parents' total income (AGI + untaxed)", inputs.pinc),
    field("Federal income tax the parents paid", inputs.ptax),
    field("People in the parents' household", inputs.size),
    field("Lower-earning parent's income (0 if one earner)", inputs.earn2),
    field("Parents' savings & investments", inputs.passet),
    field("Student's income", inputs.sinc),
    field("Federal income tax the student paid", inputs.stax),
    field("Student's savings & investments", inputs.sasset),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

function numberInput(name: string, label: string, value: number, step: number): HTMLInputElement {
  return el("input", {
    type: "number",
    name,
    min: 0,
    step,
    value,
    attrs: { "aria-label": label, inputmode: "decimal" },
  });
}

export const fafsaSaiTile: TileDefinition = {
  id: "fafsa-sai",
  title: "FAFSA Student Aid Index",
  pillar: "owed",
  description: "Estimate the dependent-student SAI from the federal methodology.",
  keywords: ["fafsa", "sai", "student aid index", "financial aid", "college", "pell"],
  status: "ready",
  how: "The Student Aid Index (SAI) is what colleges subtract from the cost of attendance to size your federal aid. The federal methodology is a published, deterministic formula, so we can show every step.\n\nWe start from the parents' total income, subtract allowances (federal income tax paid, a payroll-tax allowance, an income protection allowance for your family size, and an employment expense allowance for two-earner households), add a small share of the parents' savings and investments, and run the result through the federal assessment schedule. We add the student's own contribution (a share of their income above a protected amount, plus a share of their assets). Under the 2026-27 methodology the result is no longer divided by the number of children in college, and the SAI can be as low as -$1,500.\n\nThis is an estimate of the dependent-student formula, computed entirely on your device from the published 2026-27 tables. Verify it against the official SAI Formula Guide and your FAFSA Submission Summary before relying on it. The independent-student formula and per-state aid are out of scope for now.",
  resources: [
    {
      label: "Federal Student Aid, how aid is calculated",
      url: "https://studentaid.gov/complete-aid-process/how-calculated",
    },
    {
      label: "Federal Student Aid, the SAI and your FAFSA Submission Summary",
      url: "https://studentaid.gov/apply-for-aid/fafsa/review-and-correct/fafsa-submission-summary",
    },
  ],
  mount: mountFafsaSai,
};
