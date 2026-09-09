/**
 * Child Tax Credit estimator (BUILD-SPEC.md §4.2). $2,200 per qualifying child,
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
  /** Earned income, which is what §24(d)(1)(B)(i) measures the refund against. */
  earnedIncome: number;
}

const EXAMPLE: Fields = {
  qualifyingChildren: 2,
  magi: 120000,
  married: true,
  earnedIncome: 120000,
};

function readFields(p: URLSearchParams, profile: SituationStore): Fields {
  return {
    qualifyingChildren: p.has("kids")
      ? Math.max(0, parseNonNegative(p.get("kids"), 0))
      : (profile.get("qualifyingChildren") ?? 0),
    magi: p.has("inc") ? parseNonNegative(p.get("inc"), 0) : (profile.get("annualIncome") ?? 0),
    married: p.has("mfj") ? p.get("mfj") === "1" : marriedDefault(profile),
    // Most households' MAGI is their earnings, so it is the default rather than
    // a second thing to type — but it is a field, because the refundable
    // portion is measured against earnings and a household living on investment
    // income has none.
    earnedIncome: p.has("earn")
      ? parseNonNegative(p.get("earn"), 0)
      : p.has("inc")
        ? parseNonNegative(p.get("inc"), 0)
        : (profile.get("annualIncome") ?? 0),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("kids", String(f.qualifyingChildren));
  p.set("inc", String(f.magi));
  // Written whether or not the box is ticked. A link is the sender's answer,
  // and "not a joint return" is an answer: dropping it lets the READER's My
  // Situation answer instead, so the same link opens joint for a married
  // reader and single for everyone else.
  p.set("mfj", f.married ? "1" : "0");
  p.set("earn", String(f.earnedIncome));
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
  const earnInput = el("input", {
    type: "number",
    name: "earn",
    min: 0,
    step: 1000,
    value: fields.earnedIncome,
    attrs: { "aria-label": "Earned income", inputmode: "decimal" },
  });
  const mfj = marriedCheckbox(fields.married);

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const r = estimateCtc(
      {
        qualifyingChildren: fields.qualifyingChildren,
        magi: fields.magi,
        married: fields.married,
        earnedIncome: fields.earnedIncome,
      },
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
      {
        label: "What caps the refundable portion",
        value: r.refundableLimitedByEarnedIncome
          ? `Your earnings: §24(d)(1)(B)(i) refunds 15% of earned income over ${fmt(Money.from(eitcCtc.childTaxCredit.refundableEarnedIncomeThreshold))}.`
          : "The per-child cap; your earnings clear the §24(d)(1)(B)(i) share.",
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
      earnedIncome: parseNonNegative(earnInput.value, 0),
    };
    ctx.setParams(writeFields(fields));
    // The EARNED figure, not the MAGI one. `annualIncome` is what Take-Home,
    // the W-4 estimator and the saved Report hand the engine as wages, and a
    // reader with pre-tax contributions has a MAGI below their wages — so
    // writing MAGI here sized the rest of the site off a smaller paycheck than
    // they have. This tile asks for earnings in their own field precisely
    // because §24(d)(1)(B)(i) measures against them.
    profile.set("annualIncome", fields.earnedIncome);
    profile.set("qualifyingChildren", fields.qualifyingChildren);
    compute();
  }

  mfj.addEventListener("change", recompute);
  for (const i of [kidsInput, incInput, earnInput]) i.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    kidsInput.value = String(fields.qualifyingChildren);
    incInput.value = String(fields.magi);
    earnInput.value = String(fields.earnedIncome);
    mfj.checked = fields.married;
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Qualifying children (under 17)", kidsInput),
    field("Modified adjusted gross income", incInput),
    field("Earned income (wages and self-employment)", earnInput),
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
  how: "The Child Tax Credit is $2,200 per qualifying child under 17. It's reduced by $50 for every $1,000 (or part of $1,000) of income above $200,000 (single or head of household) or $400,000 (married filing jointly).\n\nUp to $1,700 per child is refundable, the Additional Child Tax Credit, so part of it can come back even if you owe little or no tax. That per-child figure is a ceiling, not the answer: §24(d)(1)(B)(i) refunds at most 15% of earned income over $2,500, which is what binds at lower earnings. Not modeled: §24(d)(1)(B)(ii), an alternative for three or more children that can only raise the figure, so treat this as a floor there.",
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
