/**
 * What the unemployment check nets (SPEC-5 layoff-month J3), loaded with its
 * shard once the estimator has a figure to net. The tax comes from the tax
 * engine, at the filing status and other income My Situation holds; the state
 * half renders only for a state whose treatment has been read.
 */
import { Money } from "../engine/money";
import { evaluateTaxes, type TaxContext } from "../engine/tax";
import type { FilingStatus, UiTaxationData } from "../data/schemas";
import type { BundledData } from "../data/browser";
import { el } from "../ui/dom";
import { citationLink } from "../ui/resultCard";
import { OBBBA_DEDUCTIONS_NOT_MODELED } from "./deductionCopy";

export interface UiNetInput {
  stateCode: string;
  stateName: string;
  /** The weekly amount the claimant is paid. */
  weekly: number;
  /** The whole claim, if drawn within the year. */
  yearBenefits: number;
  filingStatus: FilingStatus;
  /** Other income this year, beneath the benefits. */
  otherIncome: number;
  locale: string;
}

/** Income tax the benefits add, federal and state, on top of the year's other income. */
function taxOnBenefits(
  benefits: number,
  input: UiNetInput,
  ctx: TaxContext,
): { federal: Money; state: Money } {
  const base = { filingStatus: input.filingStatus, wages: Math.max(0, input.otherIncome) };
  const without = evaluateTaxes(base, ctx);
  const withIt = evaluateTaxes({ ...base, otherIncome: Math.max(0, benefits) }, ctx);
  const stateOf = (r: typeof without): Money => r.state?.incomeTax ?? Money.zero();
  return {
    federal: withIt.federal.incomeTax.subtract(without.federal.incomeTax),
    state: stateOf(withIt).subtract(stateOf(without)),
  };
}

export function renderUiNet(
  input: UiNetInput,
  rules: UiTaxationData,
  data: BundledData,
): HTMLElement[] {
  const fed = data.federal();
  const fica = data.fica();
  if (!fed || !fica) return [];
  const fmt = (m: Money): string => m.format(input.locale);
  const stateRule = rules.states[input.stateCode.toLowerCase()];
  const jurisdiction =
    stateRule?.taxed === "yes" ? data.state(input.stateCode.toLowerCase()) : null;
  const tax = taxOnBenefits(input.yearBenefits, input, {
    federal: fed,
    fica,
    ...(jurisdiction ? { state: jurisdiction } : {}),
  });
  const withheldWeekly = Money.from(input.weekly).multiply(rules.federalWithholdingRate);
  const withheldYear = Money.from(input.yearBenefits).multiply(rules.federalWithholdingRate);
  const gapIfElected = tax.federal.subtract(withheldYear);
  const rate = `${Math.round(rules.federalWithholdingRate * 100)}%`;

  const lines: HTMLElement[] = [
    el("h3", { class: "uie-heading", text: "What it nets after tax" }),
    el(
      "p",
      { class: "uie-net" },
      el("span", {
        text: `Benefits are taxable federal income. You can ask for ${rate} to be withheld, which leaves ${fmt(Money.from(input.weekly).subtract(withheldWeekly))} of each ${fmt(Money.from(input.weekly))} payment. `,
      }),
      citationLink(rules.citation),
    ),
    el(
      "p",
      { class: "uie-net" },
      el("span", {
        text: `Drawn in full this year, the claim adds about ${fmt(tax.federal)} of federal income tax on top of your other income. If you elect no withholding, that is what you would owe in April; with ${rate} withheld, ${gapIfElected.isNegative() ? `about ${fmt(gapIfElected.multiply(-1))} would come back` : `about ${fmt(gapIfElected)} would still be owed`}. `,
      }),
      citationLink(fed.citation),
    ),
  ];
  if (!stateRule) {
    lines.push(
      el("p", {
        class: "uie-net",
        text: `State treatment not yet read for ${input.stateName}, so no state figure is given. Its revenue department can tell you whether it taxes benefits.`,
      }),
    );
  } else {
    const withholding =
      stateRule.withholdingOffered === null
        ? "Ask the agency whether it will withhold state tax."
        : stateRule.withholdingOffered
          ? "Its agency will withhold state tax if you ask."
          : "Its agency does not withhold state tax, so set that aside yourself.";
    const text =
      stateRule.taxed === "none"
        ? `${input.stateName} has no income tax, so it takes nothing. `
        : stateRule.taxed === "no"
          ? `${input.stateName} does not tax unemployment benefits. `
          : stateRule.taxed === "partly"
            ? `${input.stateName} taxes part of them, by a formula set on your return that this does not compute. ${withholding} `
            : `${input.stateName} taxes them too: about ${fmt(tax.state)} more for the year. ${withholding} `;
    lines.push(
      el("p", { class: "uie-net" }, el("span", { text }), citationLink(stateRule.citation)),
    );
  }
  lines.push(
    el("p", {
      class: "uie-detail",
      text: `These use the filing status and income in My Situation, single and none if it holds neither. Change them there and reopen this tool. ${OBBBA_DEDUCTIONS_NOT_MODELED}`,
    }),
  );
  return lines;
}
