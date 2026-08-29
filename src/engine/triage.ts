/**
 * Bill triage (SPEC-4 §A3) — the ordering engine for a household in deficit.
 *
 * My Plan (SPEC-2 §4) orders the *building* steps for a household with surplus.
 * This is the other case, and the more common one: four bills are due, three can
 * be paid, and the order chosen decides whether the household keeps its housing,
 * its car, and its job.
 *
 * The sort key is **consequence severity**, not interest rate. That is the whole
 * point. A 24% credit card is the expensive debt on a spreadsheet and the cheap
 * one in a bad month, because missing it costs a fee and a credit-score drop,
 * while missing rent or the electric bill costs the home. Ranking by rate — the
 * instinct every debt calculator trains — is precisely backwards here.
 *
 * The engine is pure arithmetic over a cited rules table (`bill-triage-2026`,
 * from the CFPB's own "Prioritizing bills" framing). It never tells a user to
 * skip a bill. It orders what they listed, funds what the money reaches, and
 * states plainly what happens to each one it does not reach.
 */
import { Money } from "./money";
import type { BillTriageCategory, BillTriageData } from "../data/schemas";

/** One bill the user entered. */
export interface Bill {
  /** Free-text name the user gave it, e.g. "Con Edison". */
  name: string;
  /** The category id from the rules table, e.g. "utilities". */
  categoryId: string;
  amount: number;
}

/** A bill placed in the order, with what happens if it goes unpaid. */
export interface TriagedBill {
  bill: Bill;
  category: BillTriageCategory;
  /** 1-based position in the recommended order. */
  position: number;
  /** How much of the available money reaches this bill. */
  funded: Money;
  /** The shortfall on this bill (0 when fully funded). */
  short: Money;
  coverage: "full" | "partial" | "none";
}

export interface TriageResult {
  ordered: TriagedBill[];
  total: Money;
  available: Money;
  /** Total left unpaid across every bill. */
  shortfall: Money;
  /** True when the money covers everything and no triage is needed. */
  coversEverything: boolean;
  /** Categories in the result whose timing is set by state law, deduped. */
  stateVariable: BillTriageCategory[];
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

/** Look up a category, falling back to the least-severe one so an unknown id
 *  never crashes and never quietly jumps the queue. */
function categoryFor(id: string, data: BillTriageData): BillTriageCategory {
  const found = data.categories.find((c) => c.id === id);
  if (found) return found;
  return data.categories.reduce((worst, c) => (c.rank > worst.rank ? c : worst), data.categories[0]!);
}

/**
 * Order the bills and apply the available money down the list.
 *
 * Funding is sequential and partial: money runs out somewhere, and the bill it
 * runs out on usually gets *some* of it. That matters, because a partial payment
 * on a utility bill is often enough to stop a shutoff even though it does not
 * clear the balance — so showing "you can put $140 toward this" is more useful
 * than showing it as unpaid.
 *
 * Ties inside a category keep the order the user entered them, so the output is
 * stable and a user's own sense of their situation is not silently reshuffled.
 */
export function triageBills(
  bills: Bill[],
  availableAmount: number,
  data: BillTriageData,
): TriageResult {
  const available = Money.from(Math.max(0, finite(availableAmount)));

  const decorated = bills.map((bill, index) => ({
    bill: { ...bill, amount: Math.max(0, finite(bill.amount)) },
    category: categoryFor(bill.categoryId, data),
    index,
  }));
  decorated.sort((a, b) => a.category.rank - b.category.rank || a.index - b.index);

  let remaining = available;
  const ordered: TriagedBill[] = decorated.map((d, i) => {
    const amount = Money.from(d.bill.amount);
    const funded = remaining.lessThan(amount) ? remaining : amount;
    remaining = remaining.subtract(funded);
    if (remaining.isNegative()) remaining = Money.zero();
    const short = amount.subtract(funded);
    return {
      bill: d.bill,
      category: d.category,
      position: i + 1,
      funded,
      short,
      coverage: short.equals(Money.zero()) ? "full" : funded.equals(Money.zero()) ? "none" : "partial",
    };
  });

  const total = ordered.reduce((sum, t) => sum.add(Money.from(t.bill.amount)), Money.zero());
  const shortfall = ordered.reduce((sum, t) => sum.add(t.short), Money.zero());

  const stateVariable: BillTriageCategory[] = [];
  for (const t of ordered) {
    if (t.category.timing === "state" && !stateVariable.some((c) => c.id === t.category.id)) {
      stateVariable.push(t.category);
    }
  }

  return {
    ordered,
    total,
    available,
    shortfall,
    coversEverything: shortfall.equals(Money.zero()),
    stateVariable,
  };
}
