/**
 * A point where a state's own rate schedule charges a flat amount to cross a
 * line, and the words for it — in one place, because two surfaces print it.
 *
 * Ohio is the only such point in the repo today: Ohio Rev. Code
 * §5747.02(A)(3)(c) owes nothing at or below $26,050 of nonbusiness taxable
 * income and states the band above as "$332.00 plus 2.75% of the amount in
 * excess", over 0% bands for that $332 to not be a restatement of. It lands
 * whole on the first dollar over.
 *
 * The combined marginal rate is measured over a {@link MARGINAL_PROBE} wage
 * bump, so a filer sitting just under that line reads a rate of 351%. That is
 * arithmetic rather than a defect, and it is the most alarming number this site
 * can print. Both the Take-Home tile and **the Readout Report** — the document a
 * household saves and comes back to — print that rate, and a document that says
 * something different from the tile that produced it is a failure this project
 * has already had once. So the sentence lives here rather than in either of
 * them.
 */
import { Money } from "../engine/money";
import { MARGINAL_PROBE, type TaxResult } from "../engine/tax";
import { bracketsFor, statutoryNotches, type StatutoryNotch } from "../engine/tax/brackets";
import type { Jurisdiction } from "../data/schemas";
import { el } from "./dom";

/**
 * The step this filer's marginal-rate probe straddles, if any.
 *
 * Null is the answer almost everywhere and for almost everyone: a filer below
 * the probe's reach, a filer past the line, and every jurisdiction whose
 * schedule has no such point at all.
 */
export function crossedStatutoryStep(
  result: TaxResult,
  jurisdiction: Jurisdiction | undefined,
): StatutoryNotch | null {
  if (!jurisdiction || !result.state) return null;
  const taxable = result.state.taxableIncome;
  return (
    statutoryNotches(bracketsFor(jurisdiction, result.filingStatus)).find(
      (n) =>
        taxable.lessThanOrEqual(n.taxableIncome) &&
        taxable.add(MARGINAL_PROBE).greaterThan(n.taxableIncome),
    ) ?? null
  );
}

/** The whole-dollar form a statute and a reader both use for a threshold. */
function wholeDollars(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Why the marginal rate beside this is over 100%.
 *
 * Printing "351%" beside the words "next dollar" with no explanation is worse
 * than printing nothing: it reads as a broken calculator, and a reader who
 * believes it takes away a rate that is true of a hundred dollars and of no
 * dollar after them. The amount keeps its cents, because Ohio prints "$332.00"
 * and a figure a reader checks against the page should read the way the page
 * does; the threshold does not, because the statute writes "$26,050".
 */
export function statutoryStepSentence(
  notch: StatutoryNotch,
  jurisdictionName: string,
  locale: string,
): string {
  const amount = Money.from(notch.amount).format(locale);
  return (
    `That marginal rate is over 100% because you are just under a line the ${jurisdictionName} ` +
    `schedule charges a flat amount to cross. ${jurisdictionName} owes nothing at or below ` +
    `${wholeDollars(notch.taxableIncome, locale)} of taxable income and ${amount} plus its ` +
    `ordinary rate above it, so that ${amount} arrives on the first dollar over. The rate here is ` +
    `measured across ${wholeDollars(MARGINAL_PROBE, locale)}; past the line the ordinary rate ` +
    `returns.`
  );
}

/**
 * The same sentence as a calm note, for a tile. Null when the number is not
 * strange — a warning attached to every Ohio paycheck is furniture.
 */
export function statutoryStepNote(
  result: TaxResult,
  jurisdiction: Jurisdiction | undefined,
  locale: string,
): HTMLElement | null {
  if (result.totals.marginalRate <= 1) return null;
  const crossed = crossedStatutoryStep(result, jurisdiction);
  if (!crossed || !result.state) return null;
  return el("p", {
    class: "statute-step",
    text: statutoryStepSentence(crossed, result.state.jurisdictionName, locale),
  });
}
