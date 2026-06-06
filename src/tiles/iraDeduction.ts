/**
 * Traditional-IRA deductibility screener (SPEC-3 §4.3). Answers the genuinely
 * common "can I actually deduct my traditional-IRA contribution?" — which turns
 * on whether you (or a joint-filing spouse) are covered by a workplace plan, and
 * on your MAGI. Reads the contribution limit and the IRC §219(g) phase-out ranges
 * from two cited shards; degrades to the verify banner if either is missing.
 * Pairs with the Backdoor Roth tile, which handles the nondeductible-basis case.
 */
import { Money } from "../engine/money";
import { iraDeductibility, type IraDeductionStatus } from "../engine/iraDeduction";
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
  magi: number;
  contribution: number;
  covered: boolean;
  spouseCovered: boolean;
  age50Plus: boolean;
}

const EXAMPLE: Fields = {
  fs: "single",
  magi: 86000,
  contribution: 7500,
  covered: true,
  spouseCovered: false,
  age50Plus: false,
};

function isFilingStatus(v: string): v is FilingStatus {
  return FILING_STATUSES.some((f) => f.value === v);
}

function isJoint(fs: FilingStatus): boolean {
  return fs === "married_jointly" || fs === "qualifying_surviving_spouse";
}

function readFields(p: URLSearchParams, profile: SituationStore): Fields {
  const fs = p.get("fs");
  return {
    fs: fs && isFilingStatus(fs) ? fs : (profile.get("filingStatus") ?? "single"),
    magi: p.has("magi") ? parseNonNegative(p.get("magi"), 0) : (profile.get("annualIncome") ?? 0),
    contribution: parseNonNegative(p.get("c"), 7500),
    covered: p.get("cov") === "1",
    spouseCovered: p.get("scov") === "1",
    age50Plus: p.get("a50") === "1",
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("fs", f.fs);
  p.set("magi", String(f.magi));
  p.set("c", String(f.contribution));
  if (f.covered) p.set("cov", "1");
  if (f.spouseCovered) p.set("scov", "1");
  if (f.age50Plus) p.set("a50", "1");
  return p;
}

const STATUS_NOTE: Record<IraDeductionStatus, string> = {
  "no-limit":
    "Neither you nor your spouse is covered by a workplace plan, so there is no income limit — your contribution is fully deductible.",
  full: "Your income is at or below the phase-out range, so the contribution is fully deductible.",
  partial:
    "Your income is inside the phase-out range, so only part of your contribution is deductible. The rest becomes nondeductible basis (Form 8606) — the same starting point as a Backdoor Roth.",
  none: "Your income is at or above the phase-out range, so none of it is deductible. A nondeductible contribution sets up the Backdoor Roth (Form 8606).",
};

export function mountIraDeduction(ctx: TileContext): void {
  const { root, data, profile } = ctx;
  root.replaceChildren();
  const limits = data?.retirementLimits();
  const iraData = data?.iraDeduction();
  if (!limits || !iraData) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "IRA limit data is unavailable, verify before relying on any figure.",
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
  const magiInput = el("input", {
    type: "number",
    name: "magi",
    min: 0,
    step: 1000,
    value: fields.magi,
    attrs: { "aria-label": "Modified adjusted gross income", inputmode: "decimal" },
  });
  const cInput = el("input", {
    type: "number",
    name: "c",
    min: 0,
    step: 500,
    value: fields.contribution,
    attrs: { "aria-label": "Traditional IRA contribution", inputmode: "decimal" },
  });
  const covBox = el("input", {
    type: "checkbox",
    name: "cov",
    checked: fields.covered,
    attrs: { "aria-label": "You are covered by a workplace retirement plan" },
  });
  const scovBox = el("input", {
    type: "checkbox",
    name: "scov",
    checked: fields.spouseCovered,
    attrs: { "aria-label": "Your spouse is covered by a workplace retirement plan" },
  });
  const a50Box = el("input", {
    type: "checkbox",
    name: "a50",
    checked: fields.age50Plus,
    attrs: { "aria-label": "Age 50 or older this year" },
  });

  const spouseField = el(
    "label",
    { class: "checkbox" },
    scovBox,
    el("span", { text: "Spouse is covered by a workplace plan" }),
  );

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function syncSpouseVisibility(): void {
    spouseField.hidden = !isJoint(fields.fs);
  }

  function compute(): void {
    const r = iraDeductibility(
      {
        filingStatus: fields.fs,
        magi: fields.magi,
        contribution: fields.contribution,
        coveredByPlan: fields.covered,
        spouseCoveredByPlan: fields.spouseCovered,
        age50Plus: fields.age50Plus,
      },
      limits!.limits as { ira_contribution: number; ira_catch_up_50plus: number },
      iraData!,
    );
    const fmt = (m: Money): string => m.format(ctx.locale);
    const lines: BreakdownLine[] = [
      {
        label: "Contribution limit this year",
        value: fmt(r.contributionLimit),
        citation: limits!.citation,
      },
      { label: "Your contribution (after the limit)", value: fmt(r.cappedContribution) },
      {
        label: "Deductible amount",
        value: fmt(r.deductible),
        emphasis: true,
        citation: iraData!.citation,
      },
    ];
    if (r.phaseOut) {
      lines.push({
        label: "Phase-out range for your situation (MAGI)",
        value: `${fmt(Money.from(r.phaseOut.low))} – ${fmt(Money.from(r.phaseOut.high))}`,
        citation: iraData!.citation,
      });
    }
    if (r.nondeductibleBasis.greaterThan(0)) {
      lines.push({
        label: "Nondeductible basis (Form 8606)",
        value: fmt(r.nondeductibleBasis),
      });
    }
    lines.push({ label: "What this means", value: STATUS_NOTE[r.status] });

    resultContainer.replaceChildren(
      resultCard({
        label: "Deductible traditional-IRA contribution",
        value: r.deductible,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function recompute(): void {
    fields = {
      fs: isFilingStatus(fsSelect.value) ? fsSelect.value : "single",
      magi: parseNonNegative(magiInput.value, 0),
      contribution: parseNonNegative(cInput.value, 0),
      covered: covBox.checked,
      spouseCovered: scovBox.checked,
      age50Plus: a50Box.checked,
    };
    ctx.setParams(writeFields(fields));
    rememberShared(profile, { filingStatus: fields.fs, annualIncome: fields.magi });
    syncSpouseVisibility();
    compute();
  }

  fsSelect.addEventListener("change", recompute);
  magiInput.addEventListener("input", recompute);
  cInput.addEventListener("input", recompute);
  for (const b of [covBox, scovBox, a50Box]) b.addEventListener("change", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    fsSelect.value = fields.fs;
    magiInput.value = String(fields.magi);
    cInput.value = String(fields.contribution);
    covBox.checked = fields.covered;
    scovBox.checked = fields.spouseCovered;
    a50Box.checked = fields.age50Plus;
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Filing status", fsSelect),
    field("Modified adjusted gross income (MAGI)", magiInput),
    field("Traditional IRA contribution", cInput),
    el(
      "label",
      { class: "checkbox" },
      covBox,
      el("span", { text: "You are covered by a workplace plan (401(k), etc.)" }),
    ),
    spouseField,
    el("label", { class: "checkbox" }, a50Box, el("span", { text: "Age 50 or older this year" })),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  syncSpouseVisibility();
  compute();
}

export const iraDeductionTile: TileDefinition = {
  id: "ira-deduction",
  title: "IRA Deduction Checker",
  pillar: "retirement",
  description: "Whether your traditional-IRA contribution is deductible at your income.",
  keywords: [
    "ira",
    "traditional ira",
    "deduction",
    "deductible",
    "phase out",
    "magi",
    "workplace plan",
    "active participant",
    "nondeductible",
    "form 8606",
    "219",
  ],
  status: "ready",
  how: "A traditional-IRA contribution is deductible — unless you (or, if you file jointly, your spouse) are covered by a workplace retirement plan and your income is too high. This tool applies the IRS rule: if neither of you is covered, there's no income limit and the whole contribution is deductible. If you're covered, your deduction phases out across a MAGI range for your filing status; if only your spouse is covered, a higher range applies.\n\nInside the phase-out range we pro-rate the deduction the way the Pub 590-A worksheet does (rounding up to $10, with a $200 floor). Anything not deductible becomes nondeductible basis you report on Form 8606 — which is exactly the starting point for a Backdoor Roth. We use the 2026 contribution limit and phase-out ranges from IRS Notice 2025-67.",
  resources: [
    {
      label: "IRS, IRA deduction limits",
      url: "https://www.irs.gov/retirement-plans/ira-deduction-limits",
    },
    {
      label: "IRS Publication 590-A",
      url: "https://www.irs.gov/forms-pubs/about-publication-590-a",
    },
  ],
  mount: mountIraDeduction,
};
