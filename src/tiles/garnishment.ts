/**
 * Wage Garnishment Limits (SPEC-4-safety-net §B2) — harm tier 3, screener-only.
 *
 * The single way this tool could do harm is by reading as "so they can take
 * $X" when the household's own state would let them take far less, or nothing
 * at all. Four states bar wage garnishment for ordinary consumer debt outright;
 * many more protect a larger share than the federal floor does; and where a
 * state protects more, the state rule is the one that governs (15 U.S.C. §1677).
 *
 * So the state-variance caveat renders **above** the number, not beneath it —
 * and that ordering is asserted by a DOM-order test, because a later edit that
 * moved it below would look harmless in review and would invert the message.
 *
 * The tile states the federal ceiling, shows which of the two statutory tests
 * produced it, names the debts Title III does not reach at all, states the
 * §1674 job protection, and routes to free legal aid. It never says what any
 * particular creditor may take.
 */
import { garnishmentCeiling, type GarnishmentKind, type PayPeriod } from "../engine/garnishment";
import { el, option } from "../ui/dom";
import { field, parseNonNegative, pct, tryExampleButton } from "../ui/form";
import { citationLink } from "../ui/resultCard";
import type { GarnishmentLimitsData } from "../data/schemas";
import type { TileContext, TileDefinition } from "./types";

const PAY_PERIODS: { id: PayPeriod; label: string }[] = [
  { id: "weekly", label: "Weekly" },
  { id: "biweekly", label: "Every two weeks" },
  { id: "semimonthly", label: "Twice a month" },
  { id: "monthly", label: "Monthly" },
];

const KINDS: { id: GarnishmentKind; label: string }[] = [
  { id: "ordinary", label: "An ordinary debt — a card, a loan, a medical bill, a judgment" },
  { id: "support", label: "Child support or alimony" },
  { id: "tax", label: "State or federal tax" },
  { id: "bankruptcy", label: "A chapter 13 bankruptcy order" },
];

interface Fields {
  disposable: number;
  payPeriod: PayPeriod;
  kind: GarnishmentKind;
  supporting: boolean;
  arrears: boolean;
}

const EXAMPLE: Fields = {
  disposable: 600,
  payPeriod: "weekly",
  kind: "ordinary",
  supporting: true,
  arrears: false,
};

function readFields(p: URLSearchParams): Fields {
  return {
    disposable: parseNonNegative(p.get("dis"), EXAMPLE.disposable),
    payPeriod: PAY_PERIODS.find((x) => x.id === p.get("per"))?.id ?? EXAMPLE.payPeriod,
    kind: KINDS.find((x) => x.id === p.get("kind"))?.id ?? EXAMPLE.kind,
    supporting: p.has("sup") ? p.get("sup") === "1" : EXAMPLE.supporting,
    arrears: p.has("arr") ? p.get("arr") === "1" : EXAMPLE.arrears,
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("dis", String(f.disposable));
  p.set("per", f.payPeriod);
  p.set("kind", f.kind);
  p.set("sup", f.supporting ? "1" : "0");
  p.set("arr", f.arrears ? "1" : "0");
  return p;
}

export function mountGarnishment(ctx: TileContext): void {
  const { root, data } = ctx;
  root.replaceChildren();
  let fields = readFields(ctx.params);

  const disposableInput = el("input", {
    type: "number",
    min: 0,
    step: 50,
    value: fields.disposable,
    attrs: { "aria-label": "Disposable earnings each pay period", inputmode: "decimal" },
  });
  const periodSelect = el(
    "select",
    { attrs: { "aria-label": "How often you are paid" } },
    ...PAY_PERIODS.map((p) => option(p.id, p.label, p.id === fields.payPeriod)),
  );
  const kindSelect = el(
    "select",
    { attrs: { "aria-label": "What the garnishment is for" } },
    ...KINDS.map((k) => option(k.id, k.label, k.id === fields.kind)),
  );
  const supportingBox = el("input", {
    type: "checkbox",
    checked: fields.supporting,
    attrs: { "aria-label": "I support another spouse or dependent child" },
  });
  const arrearsBox = el("input", {
    type: "checkbox",
    checked: fields.arrears,
    attrs: { "aria-label": "The order covers support more than twelve weeks overdue" },
  });
  const supportRow = el(
    "div",
    { class: "grn-support-rows" },
    field("I support another spouse or dependent child", supportingBox),
    field("The order covers support more than 12 weeks overdue", arrearsBox),
  );

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function render(limits: GarnishmentLimitsData): void {
    const r = garnishmentCeiling(
      {
        disposableEarnings: fields.disposable,
        payPeriod: fields.payPeriod,
        kind: fields.kind,
        supportingOtherDependents: fields.supporting,
        arrearsOlderThanTwelveWeeks: fields.arrears,
      },
      limits,
    );
    const locale = ctx.locale;

    // THE CAVEAT COMES FIRST. See the module comment: below the number it would
    // read as a footnote to a figure the reader has already taken as the answer.
    const caveat = el(
      "p",
      { class: "grn-caveat", attrs: { role: "note" } },
      el("strong", { text: "Read this before the number. " }),
      el("span", { text: `${limits.statePreemption.detail} ` }),
      citationLink(limits.citation),
    );

    const figure =
      r.federalMaximum === null
        ? el("p", {
            class: "grn-figure",
            text: "Federal law sets no ceiling here — a different rule applies, not an unlimited one.",
          })
        : el("p", {
            class: "grn-figure",
            text: `The federal ceiling is ${r.federalMaximum.format(locale)} of this pay period, leaving ${r.remaining?.format(locale) ?? ""}.`,
          });

    const math = el("p", { class: "grn-math", text: workingLine(r, limits, locale) });

    const blocks: HTMLElement[] = [caveat, figure, math];

    if (r.federalMaximum === null) {
      const entry = limits.noFederalCeiling.find((c) =>
        fields.kind === "tax" ? c.id === "tax-debt" : c.id === "bankruptcy-chapter-13",
      );
      if (entry) blocks.push(el("p", { class: "grn-detail", text: entry.detail }));
    }

    blocks.push(
      el("h3", { class: "grn-heading", text: "Debts this ceiling does not reach" }),
      el(
        "ul",
        { class: "grn-list" },
        ...limits.noFederalCeiling.map((c) => el("li", { text: `${c.label} — ${c.detail}` })),
      ),
      el("h3", { class: "grn-heading", text: limits.jobProtection.label }),
      el("p", { class: "grn-detail", text: limits.jobProtection.detail }),
      el("h3", { class: "grn-heading", text: limits.disposableEarnings.label }),
      el("p", { class: "grn-detail", text: limits.disposableEarnings.detail }),
      el("p", {
        class: "grn-limit",
        text: "This is a screener, not a determination and not a defense. It states the federal ceiling and nothing about what a particular creditor in your state may take — that turns on your state's exemptions, the type of judgment, and how it was served. Free legal aid can tell you your state's number, and it is worth asking before you agree to anything.",
      }),
    );

    resultContainer.replaceChildren(...blocks);
  }

  /** The "show the math" line: which of the two statutory tests produced the ceiling. */
  function workingLine(
    r: ReturnType<typeof garnishmentCeiling>,
    limits: GarnishmentLimitsData,
    locale: string,
  ): string {
    const floor = r.protectedFloor.format(locale);
    switch (r.binding) {
      case "protected-floor":
        return `Federal law protects ${floor} of every pay period outright — ${limits.protectedHoursMultiple} times the ${limits.federalMinimumHourlyWage.toLocaleString(locale, { style: "currency", currency: "USD" })} federal minimum hourly wage — and only earnings above that can be reached, which is less here than the ${pct(limits.ordinaryDebtMaxShare, 0)} share.`;
      case "percentage":
        return `${pct(limits.ordinaryDebtMaxShare, 0)} of disposable earnings is the lower of the two federal tests here; the other protects ${floor} a pay period outright.`;
      case "support-share":
        return `A support order is exempt from the ordinary ${pct(limits.ordinaryDebtMaxShare, 0)} ceiling and the ${floor} floor alike, and carries its own share instead: ${pct(r.shareApplied, 0)} of disposable earnings.`;
      default:
        return `Title III's ${pct(limits.ordinaryDebtMaxShare, 0)} ceiling and its ${floor} floor both stop short of this category.`;
    }
  }

  function compute(): void {
    const limits = data?.garnishmentLimits() ?? null;
    if (!limits) {
      resultContainer.replaceChildren(
        el("div", {
          class: "verify-banner",
          attrs: { role: "alert" },
          text: "The garnishment-limit data is unavailable, so no ceiling is stated here. Your state may protect more than federal law does either way — free legal aid can tell you your state's number.",
        }),
      );
      return;
    }
    render(limits);
  }

  function syncSupportRow(): void {
    supportRow.hidden = fields.kind !== "support";
  }

  function recompute(): void {
    fields = {
      disposable: parseNonNegative(disposableInput.value, 0),
      payPeriod: (periodSelect.value as PayPeriod) ?? "weekly",
      kind: (kindSelect.value as GarnishmentKind) ?? "ordinary",
      supporting: supportingBox.checked,
      arrears: arrearsBox.checked,
    };
    ctx.setParams(writeFields(fields));
    syncSupportRow();
    compute();
  }

  disposableInput.addEventListener("input", recompute);
  periodSelect.addEventListener("change", recompute);
  kindSelect.addEventListener("change", recompute);
  supportingBox.addEventListener("change", recompute);
  arrearsBox.addEventListener("change", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    disposableInput.value = String(fields.disposable);
    periodSelect.value = fields.payPeriod;
    kindSelect.value = fields.kind;
    supportingBox.checked = fields.supporting;
    arrearsBox.checked = fields.arrears;
    recompute();
  });

  root.append(
    el(
      "form",
      { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
      field("Disposable earnings each pay period", disposableInput),
      field("How often you are paid", periodSelect),
      field("What the garnishment is for", kindSelect),
      supportRow,
      el("div", { class: "tile-form-actions" }, tryExample),
    ),
    resultContainer,
  );
  syncSupportRow();
  compute();
}

export const garnishmentTile: TileDefinition = {
  id: "garnishment",
  title: "Wage Garnishment Limits",
  pillar: "rough",
  harmTier: 3,
  channels: [
    {
      label: "Find free legal help near you",
      url: "https://www.lsc.gov/about-lsc/what-legal-aid/i-need-legal-help",
      note: "The only reliable way to learn your own state's exemption",
    },
    {
      label: "CFPB: can a debt collector garnish my wages or benefits?",
      url: "https://www.consumerfinance.gov/ask-cfpb/can-a-debt-collector-take-or-garnish-my-wages-or-benefits-en-1439/",
      note: "The rules in plain language, including protected benefit income",
    },
    {
      label: "Submit a complaint to the CFPB",
      url: "https://www.consumerfinance.gov/complaint/",
      note: "If a collector is taking more than the law allows",
    },
  ],
  description:
    "The federal ceiling on what a garnishment can take, and why your state may allow less.",
  keywords: [
    "garnishment",
    "wage garnishment",
    "garnished",
    "judgment",
    "debt collector",
    "levy",
    "how much can they take",
    "ccpa title iii",
  ],
  status: "ready",
  mount: mountGarnishment,
  how: "A garnishment order arrives with a number on it, and nothing that tells you whether the number is allowed. Federal law caps ordinary garnishment at whichever is smaller: a quarter of your disposable earnings, or the amount by which those earnings exceed thirty times the federal minimum hourly wage. That minimum wage has been $7.25 since 2009, which makes the protected floor $217.50 a week — and the two tests cross at $290 a week, so below that figure the floor is what protects you and above it the quarter-share is.\n\nDisposable earnings means pay after legally required deductions: taxes, Social Security and Medicare, required retirement contributions. Voluntary deductions like health premiums and elective savings are not subtracted first.\n\nThree things sit outside that ceiling. Child support and alimony orders are exempt from it and carry higher caps of their own — 50% of disposable earnings if you support another spouse or child, 60% if you do not, each rising five points where the order answers support more than twelve weeks overdue. State and federal tax debts, and chapter 13 bankruptcy orders, have no Title III ceiling at all; tax levies protect a different amount under their own rules, which this does not model.\n\nOne protection worth knowing: an employer may not fire you because your wages were garnished for any one debt.\n\nWhat this page gives you is the federal ceiling, which is a floor on your protection and not the answer. Several states bar wage garnishment for ordinary consumer debt entirely, and many protect a larger share than federal law does. Where a state protects more, the state rule governs. So the number here is the most that could be taken anywhere in the country for your situation, and your own state may allow much less.\n\nThis is information about published federal law applied to figures you entered. It is not legal or financial advice, and it is not a defense to an order — only a lawyer who knows your state and your case can tell you that.",
  resources: [
    {
      label: "15 U.S.C. §1673 — Restriction on garnishment",
      url: "https://www.law.cornell.edu/uscode/text/15/1673",
    },
    {
      label: "15 U.S.C. §1677 — Effect on State laws",
      url: "https://www.law.cornell.edu/uscode/text/15/1677",
    },
  ],
  related: [
    {
      hubId: "when-money-is-tight",
      tool: "bill-triage",
      label: "Bill Triage",
      note: "What to pay first when you cannot pay everything",
    },
    {
      hubId: "when-money-is-tight",
      tool: "charity-care",
      label: "Hospital Financial Assistance",
      note: "If the debt behind the order is a medical bill",
    },
  ],
};
