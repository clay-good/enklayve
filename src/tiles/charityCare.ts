/**
 * Hospital Financial Assistance (SPEC-4 §A6) — harm tier 3, screener-only.
 *
 * A hospital bill is the debt that generates the most anxiety and, unpaid for a
 * month, usually carries the least immediate consequence (see Bill Triage). It
 * is also the one most likely to be reducible before it is paid, because every
 * nonprofit hospital is required to have a written financial assistance policy
 * — and most people who qualify never ask, because nobody tells them the policy
 * exists.
 *
 * This tile does exactly two things: it computes where the household sits as a
 * percentage of the Federal Poverty Level, which is the figure nearly every
 * policy keys off, and it states what the law requires the hospital to have and
 * to hand over on request.
 *
 * It does **not** say whether you qualify, and it must never imply that it can.
 * Thresholds are set per hospital and are not centrally published, so the honest
 * output is your FPL percentage plus the question to ask. That is the entire
 * design constraint, and it is why this ships as a tier-3 screener with named
 * channels rather than as an eligibility estimator.
 */
import { fplPercent } from "../engine/benefits";
import { fplRegionFor } from "../data/usStates";
import { HOSPITAL_COLLECTION_CITATION, HOSPITAL_FAP_CITATION } from "../data/statutes";
import { el, option } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
import { citationLink } from "../ui/resultCard";
import { rememberShared } from "./profileSync";
import type { TileContext, TileDefinition } from "./types";

interface Fields {
  income: number;
  size: number;
  state: string;
}

const EXAMPLE: Fields = { income: 46000, size: 4, state: "tx" };

function readFields(p: URLSearchParams, ctx: TileContext): Fields {
  return {
    income: p.has("inc")
      ? parseNonNegative(p.get("inc"), 0)
      : (ctx.profile.get("annualIncome") ?? EXAMPLE.income),
    size: Math.max(
      1,
      Math.round(parseNonNegative(p.get("size"), ctx.profile.get("householdSize") ?? EXAMPLE.size)),
    ),
    state: p.get("st") ?? ctx.profile.get("stateCode") ?? EXAMPLE.state,
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("inc", String(f.income));
  p.set("size", String(f.size));
  p.set("st", f.state);
  return p;
}

/** The questions to ask, in the order they're useful. */
const ASK = [
  "Ask for the financial assistance policy and its application form. The hospital must give you a paper copy on request, free.",
  "Ask for a fully itemized bill, and check it against your insurer's Explanation of Benefits before you pay anything.",
  "Ask whether the bill can be held while your application is reviewed.",
  "Apply even if you think you earn too much. Policies differ, and some cover people well above the poverty line.",
  "Apply even if the bill is months old, and even if it has already gone to collections. The application period runs to at least the 240th day after your first bill, and a hospital may accept one after that.",
];

export function mountCharityCare(ctx: TileContext): void {
  const { root, data } = ctx;
  root.replaceChildren();
  let fields = readFields(ctx.params, ctx);

  const incInput = el("input", {
    type: "number",
    min: 0,
    step: 1000,
    value: fields.income,
    attrs: { "aria-label": "Household income", inputmode: "decimal" },
  });
  const sizeInput = el("input", {
    type: "number",
    min: 1,
    step: 1,
    value: fields.size,
    attrs: { "aria-label": "People in household", inputmode: "numeric" },
  });
  const codes = data?.stateCodes() ?? [];
  const stSelect = el(
    "select",
    { attrs: { "aria-label": "State" } },
    ...codes.map((c) => option(c, data?.state(c)?.name ?? c.toUpperCase(), c === fields.state)),
  );
  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const fpl = data?.fpl(fplRegionFor(fields.state));
    if (!fpl) {
      resultContainer.replaceChildren(
        el("div", {
          class: "verify-banner",
          attrs: { role: "alert" },
          text: "The poverty-guideline data is unavailable, so no percentage can be computed. Ask the hospital for its financial assistance policy regardless — every nonprofit hospital is required to have one.",
        }),
      );
      return;
    }
    const pct = fplPercent(fields.income, fields.size, fpl);
    const rounded = Math.round(pct);

    resultContainer.replaceChildren(
      el(
        "p",
        { class: "cc-figure" },
        `Your household is at about ${rounded}% of the Federal Poverty Level. `,
        citationLink(fpl.citation),
      ),
      // The screener line. Deliberately never "you qualify" or "you don't":
      // thresholds are per hospital and are not centrally published.
      el("p", {
        class: "cc-screen",
        text:
          rounded <= 200
            ? "Most hospital financial assistance policies start somewhere in this range, and many reach well above it. This is a good reason to ask, but only the hospital decides."
            : rounded <= 400
              ? "Some policies reach this far, especially for large bills relative to income. Worth asking — the answer costs nothing and only the hospital decides."
              : "Policies vary and some still offer discounts at this income, particularly when a bill is large relative to what you earn. Only the hospital decides, so it is still worth asking.",
      }),
      el(
        "p",
        { class: "cc-law" },
        "Every nonprofit hospital must have a written financial assistance policy covering emergency and medically necessary care, must say who qualifies and whether help is free or discounted, and must give you a paper copy on request at no charge. ",
        citationLink(HOSPITAL_FAP_CITATION),
      ),
      el("h3", { class: "cc-heading", text: "How long you have, and what they may not do" }),
      el(
        "p",
        { class: "cc-law" },
        "The clock is longer than a bill makes it look. A nonprofit hospital must accept a financial assistance " +
          "application until at least the 240th day after your first bill after discharge, and it must hold off on " +
          "collection for at least 120 days from that same bill — no selling the debt, no credit reporting, no lien, " +
          "no lawsuit, no wage garnishment, and no refusing you medically necessary care over the unpaid bill. " +
          "Before the first of those it owes you 30 days' written warning. Applying suspends them again while your " +
          "application is reviewed. ",
        citationLink(HOSPITAL_COLLECTION_CITATION),
      ),
      el("h3", { class: "cc-heading", text: "What to ask for" }),
      el("ol", { class: "cc-ask" }, ...ASK.map((a) => el("li", { text: a }))),
      el("p", {
        class: "cc-limit",
        text: "This is not an eligibility determination and cannot be one. Each hospital sets its own thresholds and they are not published in one place, so the only way to find out is to ask for the policy.",
      }),
    );
  }

  function recompute(): void {
    fields = {
      income: parseNonNegative(incInput.value, 0),
      size: Math.max(1, Math.round(parseNonNegative(sizeInput.value, 1))),
      state: stSelect.value,
    };
    ctx.setParams(writeFields(fields));
    rememberShared(ctx.profile, { stateCode: fields.state, annualIncome: fields.income });
    ctx.profile.set("householdSize", fields.size);
    compute();
  }

  incInput.addEventListener("input", recompute);
  sizeInput.addEventListener("input", recompute);
  stSelect.addEventListener("change", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    incInput.value = String(fields.income);
    sizeInput.value = String(fields.size);
    stSelect.value = fields.state;
    recompute();
  });

  root.append(
    el(
      "form",
      { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
      field("Household income", incInput),
      field("People in household", sizeInput),
      field("State", stSelect),
      el("div", { class: "tile-form-actions" }, tryExample),
    ),
    resultContainer,
  );
  compute();
}

export const charityCareTile: TileDefinition = {
  id: "charity-care",
  title: "Hospital Financial Assistance",
  pillar: "rough",
  harmTier: 3,
  channels: [
    {
      label: "IRS, what a nonprofit hospital's financial assistance policy must contain",
      url: "https://www.irs.gov/charities-non-profits/financial-assistance-policy-and-emergency-medical-care-policy-section-501r4",
      note: "The rule itself, in the government's words",
    },
    {
      label: "Find free legal help near you",
      url: "https://www.lsc.gov/about-lsc/what-legal-aid/i-need-legal-help",
      note: "If a hospital refuses to provide its policy or moves to collect",
    },
    {
      label: "Submit a complaint to the CFPB",
      url: "https://www.consumerfinance.gov/complaint/",
      note: "For medical debt that has gone to collections",
    },
  ],
  description: "Before you pay a hospital bill, the discount you may be entitled to ask for.",
  keywords: [
    "charity care",
    "financial assistance",
    "hospital bill",
    "medical debt",
    "501r",
    "medical bill help",
    "can't afford hospital",
  ],
  status: "ready",
  mount: mountCharityCare,
  how: "A hospital bill is the debt that causes the most fear and, unpaid for a month, usually carries the least immediate consequence. It is also the one most likely to shrink before you pay it — and most people who could get that discount never ask, because nobody tells them it exists.\n\nEvery nonprofit hospital in the country is required to have a written financial assistance policy. It must cover emergency and medically necessary care, it must say who qualifies and whether the help is free or discounted, and the hospital must hand you a paper copy on request at no charge. That is the law, not a courtesy.\n\nNearly every one of those policies is written as a percentage of the Federal Poverty Level, so this computes where your household sits on that scale from the same cited poverty guidelines the rest of the site uses. That number is the one the application will turn on.\n\nWhat this cannot do is tell you whether you qualify. Each hospital sets its own thresholds and they are not published anywhere central, so a tool that guessed would be inventing the most important number in the answer. It gives you your percentage, the rule, and the questions to ask.\n\nThis is information about a published federal requirement applied to figures you entered. It is not legal or financial advice, and only the hospital determines eligibility.",
  resources: [
    {
      label: "IRS, requirements for 501(c)(3) hospitals",
      url: "https://www.irs.gov/charities-non-profits/charitable-organizations/requirements-for-501c3-hospitals-under-the-affordable-care-act-section-501r",
    },
  ],
  related: [
    {
      hubId: "when-money-is-tight",
      tool: "bill-triage",
      label: "Bill Triage",
      note: "Where a medical bill sits against the rest of the month",
    },
    {
      hubId: "benefits",
      tool: "fpl",
      label: "Federal Poverty Level",
      note: "The scale most assistance programs key off",
    },
  ],
};
