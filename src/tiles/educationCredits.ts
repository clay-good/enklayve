/**
 * Education-credit comparison (SPEC-3 §4.6). "Which education credit saves more
 * this year — the American Opportunity Tax Credit or the Lifetime Learning
 * Credit?" Shows both side by side with the MAGI phase-out and the AOTC's
 * refundable portion. You can't claim both for the same student, so this is a
 * comparison, never advice. Gates on the cited education-credits shard.
 */
import { Money } from "../engine/money";
import { educationCredits } from "../engine/educationCredits";
import { el } from "../ui/dom";
import { field, parseNonNegative, pct, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import { marriedCheckbox, marriedDefault } from "./owedShared";
import { rememberShared } from "./profileSync";
import type { SituationStore } from "../profile/situation";
import type { TileContext, TileDefinition } from "./types";

interface Fields {
  magi: number;
  married: boolean;
  expenses: number;
  aotcEligible: boolean;
}

const EXAMPLE: Fields = { magi: 70000, married: false, expenses: 4000, aotcEligible: true };

function readFields(p: URLSearchParams, profile: SituationStore): Fields {
  return {
    magi: p.has("magi") ? parseNonNegative(p.get("magi"), 0) : (profile.get("annualIncome") ?? 0),
    married: p.has("mfj") ? p.get("mfj") === "1" : marriedDefault(profile),
    expenses: parseNonNegative(p.get("exp"), 0),
    aotcEligible: p.get("aotc") !== "0",
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("magi", String(f.magi));
  p.set("mfj", f.married ? "1" : "0");
  p.set("exp", String(f.expenses));
  p.set("aotc", f.aotcEligible ? "1" : "0");
  return p;
}

export function mountEducationCredits(ctx: TileContext): void {
  const { root, data, profile } = ctx;
  root.replaceChildren();
  const ec = data?.educationCredits();
  if (!ec) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "Education-credit data is unavailable, verify before relying on any figure.",
      }),
    );
    return;
  }
  let fields = readFields(ctx.params, profile);

  const magiInput = el("input", {
    type: "number",
    name: "magi",
    min: 0,
    step: 1000,
    value: fields.magi,
    attrs: { "aria-label": "Modified adjusted gross income", inputmode: "decimal" },
  });
  const expInput = el("input", {
    type: "number",
    name: "exp",
    min: 0,
    step: 500,
    value: fields.expenses,
    attrs: { "aria-label": "Qualified education expenses", inputmode: "decimal" },
  });
  const mfj = marriedCheckbox(fields.married);
  const aotcBox = el("input", {
    type: "checkbox",
    name: "aotc",
    checked: fields.aotcEligible,
    attrs: { "aria-label": "Eligible for the American Opportunity Credit" },
  });

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const r = educationCredits(
      {
        magi: fields.magi,
        married: fields.married,
        qualifiedExpenses: fields.expenses,
        aotcEligible: fields.aotcEligible,
      },
      ec!,
    );
    const fmt = (m: Money): string => m.format(ctx.locale);
    const lines: BreakdownLine[] = [];
    if (fields.aotcEligible) {
      lines.push({
        label: "American Opportunity Credit (per student)",
        value: fmt(r.aotc.afterPhaseout),
        citation: ec!.citation,
      });
      if (r.aotc.refundable.greaterThan(0)) {
        lines.push({
          label: "— of which refundable (40%)",
          value: fmt(r.aotc.refundable),
          citation: ec!.citation,
        });
      }
    } else {
      lines.push({
        label: "American Opportunity Credit",
        value: "Not eligible (first 4 years & ≥ half-time only)",
      });
    }
    lines.push({
      label: "Lifetime Learning Credit (per return)",
      value: fmt(r.llc.afterPhaseout),
      citation: ec!.citation,
    });
    lines.push({
      label: "Phase-out range (MAGI)",
      value: `${fmt(Money.from(r.phaseOut.low))} – ${fmt(Money.from(r.phaseOut.high))}${r.phaseOutFraction < 1 && r.phaseOutFraction > 0 ? ` (you're partly phased out: ${pct(r.phaseOutFraction, 0)} kept)` : r.phaseOutFraction === 0 ? " (fully phased out)" : ""}`,
      citation: ec!.citation,
    });
    lines.push({
      label: "Which saves more",
      value:
        r.better === "none"
          ? "Neither credit is available at this income / expense level."
          : r.better === "aotc"
            ? "The American Opportunity Credit, this year."
            : "The Lifetime Learning Credit, this year.",
      emphasis: true,
    });
    lines.push({
      label: "Note",
      value:
        "You can't claim both for the same student. The AOTC is per student and partly refundable but only for the first four years; the LLC is per return, nonrefundable, with no year limit. A comparison, not advice.",
    });

    resultContainer.replaceChildren(
      resultCard({
        label: "Larger education credit",
        value: r.recommendedCredit,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function recompute(): void {
    fields = {
      magi: parseNonNegative(magiInput.value, 0),
      married: mfj.checked,
      expenses: parseNonNegative(expInput.value, 0),
      aotcEligible: aotcBox.checked,
    };
    ctx.setParams(writeFields(fields));
    rememberShared(profile, {
      filingStatus: fields.married ? "married_jointly" : "single",
      annualIncome: fields.magi,
    });
    compute();
  }

  for (const i of [magiInput, expInput]) i.addEventListener("input", recompute);
  for (const b of [mfj, aotcBox]) b.addEventListener("change", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    magiInput.value = String(fields.magi);
    expInput.value = String(fields.expenses);
    mfj.checked = fields.married;
    aotcBox.checked = fields.aotcEligible;
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Modified adjusted gross income (MAGI)", magiInput),
    el("label", { class: "checkbox" }, mfj, el("span", { text: "Married filing jointly" })),
    field("Qualified education expenses", expInput),
    el(
      "label",
      { class: "checkbox" },
      aotcBox,
      el("span", { text: "First 4 years of college, at least half-time (AOTC-eligible)" }),
    ),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const educationCreditsTile: TileDefinition = {
  id: "education-credits",
  title: "Education Credit Comparison",
  pillar: "owed",
  description: "AOTC vs Lifetime Learning Credit — which education credit saves more this year.",
  keywords: [
    "education credit",
    "aotc",
    "american opportunity",
    "lifetime learning",
    "llc",
    "form 8863",
    "8863",
    "tuition",
    "college",
    "25a",
  ],
  status: "ready",
  how: "Two tax credits help with college costs, and you pick one per student. The American Opportunity Tax Credit (AOTC) is the bigger one — 100% of the first $2,000 of qualified expenses plus 25% of the next $2,000, up to $2,500 — and 40% of it is refundable, so it can pay out even with no tax due. But it's only for the first four years of a degree, at least half-time. The Lifetime Learning Credit (LLC) is 20% of up to $10,000 of expenses, up to $2,000 per return, nonrefundable, but with no year or enrollment limit — good for grad school or a single class.\n\nWe compute both from your qualified expenses and apply the MAGI phase-out (the same $80,000–$90,000 single / $160,000–$180,000 joint range for both), then show which is larger this year. It's a comparison, not advice — and you can't claim both for the same student.",
  resources: [
    {
      label: "IRS, education credits (AOTC and LLC)",
      url: "https://www.irs.gov/credits-deductions/individuals/education-credits-aotc-and-llc",
    },
    { label: "IRS Form 8863", url: "https://www.irs.gov/forms-pubs/about-form-8863" },
  ],
  mount: mountEducationCredits,
};
