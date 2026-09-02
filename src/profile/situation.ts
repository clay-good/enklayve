/**
 * My Situation — the in-memory session profile (BUILD-SPEC-2 §3).
 *
 * A single store every tile reads defaults from and writes user entries back
 * to, so income is entered once, not retyped in eight tools. Each field records
 * its provenance — typed by the user, extracted from a document, or assumed as a
 * default — per §3.1.
 *
 * Privacy (SPEC §2 principle 8, SPEC-2 §3.2): the profile lives ONLY in memory.
 * It is never written to storage automatically and is cleared on page unload.
 * Continuity across sessions is opt-in and user-held via the portable export in
 * profile/portable.ts. Nothing is ever sent anywhere.
 */
import { z } from "zod";
import { FilingStatus } from "../data/schemas";

/** Where a field's value came from (§3.1). */
export type FieldSource = "typed" | "extracted" | "assumed";

/** A single debt: a balance, its annual interest rate, and a name (§3.1). */
export interface Debt {
  /** Display name, e.g. "Visa" or "Car loan". */
  name: string;
  /** Outstanding balance. */
  balance: number;
  /** Annual interest rate as a percentage, e.g. 22.99 for 22.99% APR. */
  ratePct: number;
}

/** The known fields of the session profile. All optional — a profile fills in
 * over time as the user (or the Readout) supplies values. */
export interface SituationValues {
  filingStatus: FilingStatus;
  /** Two-letter state code, e.g. "ca". */
  stateCode: string;
  /**
   * The id of the mandatory residence-based local tax the household pays — a
   * `localAddOns` id such as `md-montgomery` or `in-marion`, not a place name.
   *
   * The field sat here unread from the day it was declared until 2026-09-02,
   * when Maryland's and Indiana's county taxes reached the tiles that need
   * them: an id is state-scoped and unambiguous, where "Washington" is a county
   * in Maryland, a county in Indiana, and a state. Empty for a household in
   * neither, since nowhere else levies a local tax you cannot opt out of.
   */
  county: string;
  householdSize: number;
  /** Ages of household members. */
  ages: number[];
  /** Gross annual income. */
  annualIncome: number;
  /**
   * Cash tips reported to the employer for the year — W-2 box 12, code TP.
   *
   * Named for what the box holds rather than for the deduction it feeds, because
   * the two are not the same number: IRC §224 counts only tips received in an
   * occupation the Treasury lists, and box 14b carries the occupation code that
   * says whether they were (with "000" meaning at least some were not). So this
   * is a ceiling on the qualified figure, and the tile that spends it says so.
   */
  qualifiedTipsAnnual: number;
  /** Qualified overtime compensation for the year — W-2 box 12, code TT. The
   *  premium half of time-and-a-half required by FLSA §7, which is exactly what
   *  IRC §225 deducts, so this box needs no such caveat. */
  qualifiedOvertimeAnnual: number;
  /** Annual pre-tax contributions (401k/HSA/etc.). */
  preTaxContributions: number;
  /** Annual contributions to tax-advantaged retirement accounts (401k/IRA). */
  retirementContributionsAnnual: number;
  /** Full annual employer match available if you contribute enough to capture it. */
  employerMatchAnnual: number;
  /** Annual employer match you are currently capturing. */
  employerMatchCaptured: number;
  /** Debts with their balances and rates (§3.1). Feeds the high-cost-debt step. */
  debts: Debt[];
  /** Essential monthly expenses (the "sleep at night" number). */
  essentialMonthlyExpenses: number;
  /** Total monthly expenses. */
  totalMonthlyExpenses: number;
  /** Liquid savings / cash on hand. */
  liquidSavings: number;
}

export type SituationKey = keyof SituationValues;

/**
 * A finite number, or nothing.
 *
 * `.catch(undefined)` is the whole shape of this schema: a snapshot arrives
 * from a file the user chose, and one unreadable field should cost that field
 * and not the rest of their situation. So every entry drops on its own rather
 * than failing the object.
 */
const num = z.number().finite().optional().catch(undefined);
const str = z.string().optional().catch(undefined);

/**
 * What a restored snapshot is allowed to contain.
 *
 * `SituationStore.load` used to spread whatever it was handed straight into the
 * store, and both paths that reach it — the portable profile file and the
 * Standing Ledger — accepted any shape at all: the ledger's schema said
 * `values: z.record(z.string(), z.unknown())`, which checks that `values` is an
 * object and nothing else. So a restore was a way into every tile that the
 * catalog's "no tile throws or paints a non-finite value" sweep does not cover,
 * because that sweep drives form inputs and deep links rather than a restored
 * profile. A `NaN` for `annualIncome` reaches the tax engine the same as a
 * typed one.
 *
 * Only the runtime shape is enforced, not the economics. A negative balance or
 * a zero income is a state a person can genuinely be in and the tiles handle
 * it; a string where a number belongs is not, and never came from here.
 */
export const SituationValuesSchema = z
  .object({
    filingStatus: FilingStatus.optional().catch(undefined),
    stateCode: str,
    county: str,
    householdSize: num,
    ages: z.array(z.number().finite()).optional().catch(undefined),
    annualIncome: num,
    qualifiedTipsAnnual: num,
    qualifiedOvertimeAnnual: num,
    preTaxContributions: num,
    retirementContributionsAnnual: num,
    employerMatchAnnual: num,
    employerMatchCaptured: num,
    debts: z
      .array(
        z.object({
          name: z.string(),
          balance: z.number().finite(),
          ratePct: z.number().finite(),
        }),
      )
      .optional()
      .catch(undefined),
    essentialMonthlyExpenses: num,
    totalMonthlyExpenses: num,
    liquidSavings: num,
  })
  .catch({});

const FieldSourceSchema = z.enum(["typed", "extracted", "assumed"]);

export const SituationSnapshotSchema = z
  .object({
    values: SituationValuesSchema,
    sources: z.record(z.string(), FieldSourceSchema).optional().catch({}),
  })
  .catch({ values: {}, sources: {} });

/**
 * Keep what a snapshot got right and drop what it did not, never throwing.
 *
 * A restore that refuses the whole file over one bad field is worse than one
 * that restores the rest: there are no accounts here, so the file is the only
 * copy the person has.
 */
export function sanitizeSnapshot(snapshot: unknown): SituationSnapshot {
  const parsed = SituationSnapshotSchema.parse(snapshot ?? {});
  const given = (snapshot ?? {}) as { values?: unknown; sources?: unknown };
  const accepted = (parsed.values ?? {}) as Record<string, unknown>;
  const acceptedSources = (parsed.sources ?? {}) as Record<string, unknown>;

  // Walk the keys the file gave, not the schema's — a snapshot that survives
  // this should come back out in the order it went in, because a ledger file
  // round-trips bit for bit and its situation is this object.
  const values: Record<string, unknown> = {};
  for (const key of Object.keys((given.values as Record<string, unknown>) ?? {})) {
    if (accepted[key] !== undefined) values[key] = accepted[key];
  }
  const sources: Record<string, unknown> = {};
  for (const key of Object.keys((given.sources as Record<string, unknown>) ?? {})) {
    // A provenance entry for a value that did not survive is provenance for
    // nothing, and would show a field as "extracted" that is not there.
    if (key in values && acceptedSources[key] !== undefined) sources[key] = acceptedSources[key];
  }
  return { values, sources } as SituationSnapshot;
}

/** A serializable snapshot of the profile (used by the portable export). */
export interface SituationSnapshot {
  values: Partial<SituationValues>;
  sources: Partial<Record<SituationKey, FieldSource>>;
}

type Listener = () => void;

/**
 * The session profile store. Holds values plus per-field provenance, notifies
 * subscribers on change, and can snapshot/load for the portable export. It does
 * no persistence of its own.
 */
export class SituationStore {
  private values: Partial<SituationValues> = {};
  private sources: Partial<Record<SituationKey, FieldSource>> = {};
  private readonly listeners = new Set<Listener>();

  get<K extends SituationKey>(key: K): SituationValues[K] | undefined {
    return this.values[key];
  }

  /** Provenance of a field, or undefined when the field is unset. */
  sourceOf(key: SituationKey): FieldSource | undefined {
    return this.sources[key];
  }

  has(key: SituationKey): boolean {
    return this.values[key] !== undefined;
  }

  /** Set a field and record its provenance, notifying subscribers. */
  set<K extends SituationKey>(
    key: K,
    value: SituationValues[K],
    source: FieldSource = "typed",
  ): void {
    this.values[key] = value;
    this.sources[key] = source;
    this.emit();
  }

  /** Remove a single field. */
  unset(key: SituationKey): void {
    delete this.values[key];
    delete this.sources[key];
    this.emit();
  }

  /** Every set field, in insertion order. */
  entries(): { key: SituationKey; value: unknown; source: FieldSource }[] {
    return (Object.keys(this.values) as SituationKey[]).map((key) => ({
      key,
      value: this.values[key],
      source: this.sources[key] ?? "typed",
    }));
  }

  /** Clear the entire profile (also called on page unload). */
  clear(): void {
    this.values = {};
    this.sources = {};
    this.emit();
  }

  /** A deep-enough copy for export. */
  snapshot(): SituationSnapshot {
    return {
      values: {
        ...this.values,
        ...(this.values.ages ? { ages: [...this.values.ages] } : {}),
        ...(this.values.debts ? { debts: this.values.debts.map((d) => ({ ...d })) } : {}),
      },
      sources: { ...this.sources },
    };
  }

  /** Replace the profile contents from a snapshot (used by import). */
  /**
   * Replace the profile from a snapshot, keeping only what it got right.
   *
   * This is the boundary every restore crosses — the portable profile file and
   * the Standing Ledger both land here — so the check belongs here rather than
   * in either caller, where it would have to be written twice and could
   * disagree with itself.
   */
  load(snapshot: SituationSnapshot): void {
    const clean = sanitizeSnapshot(snapshot);
    this.values = { ...clean.values };
    this.sources = { ...clean.sources };
    this.emit();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
