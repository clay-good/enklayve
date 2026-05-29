/**
 * Child Tax Credit estimator (BUILD-SPEC.md §4.2). $2,000 per qualifying child,
 * reduced above the high-income phase-out, with the refundable Additional Child
 * Tax Credit portion shown. Cited to the IRS parameters.
 */
import { Money } from "../engine/money";
import { estimateCtc } from "../engine/benefits";
import { el } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import { marriedCheckbox, marriedDefault } from "./owedShared";
import type { SituationStore } from "../profile/situation";
import type { TileContext, TileDefinition } from "./types";

interface Fields {
  qualifyingChildren: number;
  magi: number;
  married: boolean;
}

const EXAMPLE: Fields = { qualifyingChildren: 2, magi: 120000, married: true };

function readFields(p: URLSearchParams, profile: SituationStore): Fields {
  return {
    qualifyingChildren: Math.max(0, parseNonNegative(p.get("kids"), 0)),
    magi: p.has("inc") ? parseNonNegative(p.get("inc"), 0) : (profile.get("annualIncome") ?? 0),
    married: p.has("mfj") ? p.get("mfj") === "1" : marriedDefault(profile),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("kids", String(f.qualifyingChildren));
  p.set("inc", String(f.magi));
  if (f.married) p.set("mfj", "1");
  return p;
}

export function mountChildTaxCredit(ctx: TileContext): void {
  const { root, data, profile } = ctx;
  root.replaceChildren();
  const maybeData = data?.eitcCtc() ?? null;
  if (!maybeData) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "Child Tax Credit data is unavailable, verify before relying on any figure.",
      }),
    );
    return;
  }
  // Capture the narrowed (non-null) dataset so the nested closures keep the type.
  const eitcCtc = maybeData;
  let fields = readFields(ctx.params, profile);

  const kidsInput = el("input", {
    type: "number",
    name: "kids",
    min: 0,
    step: 1,
    value: fields.qualifyingChildren,
    attrs: { "aria-label": "Qualifying children under 17", inputmode: "numeric" },
  });
  const incInput = el("input", {
    type: "number",
    name: "inc",
    min: 0,
    step: 1000,
    value: fields.magi,
    attrs: { "aria-label": "Modified adjusted gross income", inputmode: "decimal" },
  });
  const mfj = marriedCheckbox(fields.married);

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const r = estimateCtc(
      { qualifyingChildren: fields.qualifyingChildren, magi: fields.magi, married: fields.married },
      eitcCtc,
    );
    const fmt = (m: Money): string => m.format(ctx.locale);
    const lines: BreakdownLine[] = [
      { label: "Qualifying children", value: String(fields.qualifyingChildren) },
      {
        label: "Per child",
        value: fmt(Money.from(eitcCtc.childTaxCredit.perChild)),
        citation: eitcCtc.citation,
      },
      { label: "Estimated Child Tax Credit", value: fmt(r.credit), emphasis: true },
      {
        label: "Refundable portion (ACTC)",
        value: `up to ${fmt(r.refundable)}`,
        citation: eitcCtc.citation,
      },
    ];

    resultContainer.replaceChildren(
      resultCard({
        label: "Estimated Child Tax Credit",
        value: r.credit,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function recompute(): void {
    fields = {
      qualifyingChildren: Math.max(0, parseNonNegative(kidsInput.value, 0)),
      magi: parseNonNegative(incInput.value, 0),
      married: mfj.checked,
    };
    ctx.setParams(writeFields(fields));
    profile.set("annualIncome", fields.magi);
    compute();
  }

  mfj.addEventListener("change", recompute);
  for (const i of [kidsInput, incInput]) i.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    kidsInput.value = String(fields.qualifyingChildren);
    incInput.value = String(fields.magi);
    mfj.checked = fields.married;
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Qualifying children (under 17)", kidsInput),
    field("Modified adjusted gross income", incInput),
    el("label", { class: "checkbox" }, mfj, el("span", { text: "Married filing jointly" })),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const childTaxCreditTile: TileDefinition = {
  id: "ctc",
  title: "Child Tax Credit",
  pillar: "owed",
  description: "Child Tax Credit and the refundable Additional CTC.",
  keywords: ["ctc", "child tax credit", "actc", "dependents"],
  status: "ready",
  how: "The Child Tax Credit is $2,000 per qualifying child under 17. It's reduced by $50 for every $1,000 (or part of $1,000) of income above $200,000 (single or head of household) or $400,000 (married filing jointly).\n\nUp to $1,700 per child is refundable, the Additional Child Tax Credit, so part of it can come back even if you owe little or no tax.",
  resources: [
    {
      label: "IRS, Child Tax Credit",
      url: "https://www.irs.gov/credits-deductions/individuals/child-tax-credit",
    },
    {
      label: "IRS Schedule 8812",
      url: "https://www.irs.gov/forms-pubs/about-schedule-8812-form-1040",
    },
  ],
  mount: mountChildTaxCredit,
};
