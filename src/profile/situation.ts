/**
 * Your Situation — the in-memory session profile (BUILD-SPEC-2 §3).
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
import type { FilingStatus } from "../data/schemas";

/** Where a field's value came from (§3.1). */
export type FieldSource = "typed" | "extracted" | "assumed";

/** The known fields of the session profile. All optional — a profile fills in
 * over time as the user (or the Readout) supplies values. */
export interface SituationValues {
  filingStatus: FilingStatus;
  /** Two-letter state code, e.g. "ca". */
  stateCode: string;
  county: string;
  householdSize: number;
  /** Ages of household members. */
  ages: number[];
  /** Gross annual income. */
  annualIncome: number;
  /** Annual pre-tax contributions (401k/HSA/etc.). */
  preTaxContributions: number;
  /** Essential monthly expenses (the "sleep at night" number). */
  essentialMonthlyExpenses: number;
  /** Total monthly expenses. */
  totalMonthlyExpenses: number;
  /** Liquid savings / cash on hand. */
  liquidSavings: number;
}

export type SituationKey = keyof SituationValues;

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
      values: { ...this.values, ...(this.values.ages ? { ages: [...this.values.ages] } : {}) },
      sources: { ...this.sources },
    };
  }

  /** Replace the profile contents from a snapshot (used by import). */
  load(snapshot: SituationSnapshot): void {
    this.values = { ...snapshot.values };
    this.sources = { ...snapshot.sources };
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
