/**
 * The Standing Ledger, Path 1 — the carried file (SPEC-4-ledger.md).
 *
 * Every personal-finance product that wants you back builds the same loop: an
 * account, a server-side copy of your finances, and a notification. This builds
 * the useful half with none of the machinery. You keep a **file**; when the
 * bundled data changes, the site recomputes the answers you kept and shows you
 * the diff. There is no account, no server, no sync, no push, and nothing left
 * on this machine when you leave — so there is nothing anywhere to leak.
 *
 * Two properties make it work without bundling historical data:
 *
 * 1. A snapshot stores **the answers themselves**, not only the inputs. The
 *    diff is stored-answer against recomputed-answer, so last year's shards are
 *    never needed — only last year's *results*, which the user is carrying.
 * 2. The recompute is `buildReport` over the imported situation and the
 *    **currently bundled** data. That is already pure, already deterministic,
 *    and already the surface a household's answers live on, so no parallel
 *    engine is introduced to drift away from the one on screen.
 *
 * What a snapshot may never hold: a document, a document's text, an account
 * number, a name, an address, an SSN, or anything the Readout extracted that the
 * user did not confirm. That is enforced by a **strict** Zod schema rather than
 * by convention — an unknown key is a rejected import, not a silently carried
 * payload.
 */
import { z } from "zod";
import type { Deadline } from "../engine/deadline";
import type { ReportModel } from "../readout/report";
import type { BundledData } from "../data/browser";
import { SituationStore, type SituationSnapshot } from "./situation";
import { decrypt, encrypt, isEncrypted } from "./portable";

export const LEDGER_FORMAT = "enklayve.ledger";
export const LEDGER_ENCRYPTED_FORMAT = "enklayve.ledger.encrypted";
const LEDGER_VERSION = 1;

/**
 * The materiality floor (SPEC-4-ledger §3.1): the greater of $25 or 1% of the
 * stored value. Below it a recomputed answer is recorded as unchanged, so a
 * rounding-level shift in a bracket does not manufacture a notification. The
 * figure is arguable rather than magic: $25 is about the smallest change a
 * household would act on, and the 1% arm keeps it proportionate on a five-figure
 * answer where $25 is noise.
 */
export const MATERIAL_FLOOR_DOLLARS = 25;
export const MATERIAL_FLOOR_SHARE = 0.01;

/** One answer the user chose to keep, with its value at snapshot time. */
export interface WatchedAnswer {
  /** The report section it came from, which disambiguates a repeated label. */
  section: string;
  label: string;
  /** The value exactly as it was displayed when the snapshot was taken. */
  display: string;
  /**
   * The numeric amount when the displayed value was a currency figure. A
   * non-numeric answer (an eligibility status, a plan name) has none and is
   * compared as a status instead — always a threshold crossing, never subject
   * to the dollar floor.
   */
  amount?: number;
}

export interface LedgerSnapshot {
  format: typeof LEDGER_FORMAT;
  version: typeof LEDGER_VERSION;
  /** ISO date the snapshot was taken. An input, never `Date.now()`. */
  takenOn: string;
  situation: SituationSnapshot;
  answers: WatchedAnswer[];
  deadlines: Deadline[];
  provenance: {
    schemaVersion: number;
    shards: { id: string; version: string; effectiveYear: number }[];
  };
}

/**
 * `.strict()` throughout is the privacy property, not a style choice: an
 * unrecognized key — a document, a name, an account number — fails the import
 * rather than riding along inside it.
 */
const WatchedAnswerSchema = z
  .object({
    section: z.string().min(1),
    label: z.string().min(1),
    display: z.string(),
    amount: z.number().finite().optional(),
  })
  .strict();

/**
 * The situation half of a ledger file, checked for *shape* only.
 *
 * Deliberately loose about the values, and the division is the point. A ledger
 * file's job is fidelity — it round-trips bit for bit, key order included, so a
 * person can carry it and get back exactly what they saved. Checking the values
 * here would mean rebuilding the object through a schema and normalizing that
 * order away. The values are checked where they can actually do harm, at
 * `SituationStore.load`, which is the one boundary both this and the portable
 * profile file cross on the way into the tiles.
 */
const SituationSnapshotSchema = z
  .object({
    values: z.record(z.string(), z.unknown()),
    sources: z.record(z.string(), z.string()),
  })
  .strict();

/** A `Deadline` as it travels in a file. `citation` stays required, so a
 * snapshot cannot carry an uncited clock any more than the type can. */
const DeadlineSchema = z
  .object({
    label: z.string().min(1),
    due: z.union([
      z.object({ on: z.string() }).strict(),
      z.object({ daysFromTrigger: z.number(), trigger: z.string() }).strict(),
      z.object({ monthsFromTrigger: z.number(), trigger: z.string() }).strict(),
    ]),
    citation: z
      .object({
        sourceUrl: z.string(),
        sourceDocument: z.string(),
        sourceNote: z.string().optional(),
        effectiveYear: z.number(),
        dateRetrieved: z.string(),
        contentHash: z.string().optional(),
      })
      .strict(),
    channel: z.object({ label: z.string(), url: z.string() }).strict().optional(),
    isFloor: z.boolean().optional(),
  })
  .strict();

export const LedgerSnapshotSchema = z
  .object({
    format: z.literal(LEDGER_FORMAT),
    version: z.literal(LEDGER_VERSION),
    takenOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    situation: SituationSnapshotSchema,
    answers: z.array(WatchedAnswerSchema),
    deadlines: z.array(DeadlineSchema),
    provenance: z
      .object({
        schemaVersion: z.number().int().positive(),
        shards: z.array(
          z
            .object({
              id: z.string().min(1),
              version: z.string().min(1),
              effectiveYear: z.number().int(),
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict();

/**
 * Parse a currency-formatted report value back to a number; null when the value
 * is not a plain money figure (a percentage, a status, a date, a sentence).
 */
export function parseDisplayedAmount(display: string): number | null {
  if (!/^-?\$[\d,]+(\.\d{1,2})?$/.test(display.trim())) return null;
  const n = Number(display.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Every answer in a report that can be watched. Sections and labels come
 * straight from {@link ReportModel}, which is already the pure surface the
 * household's answers live on.
 */
export function watchableAnswers(model: ReportModel): WatchedAnswer[] {
  return model.sections.flatMap((section) =>
    section.lines.map((line) => {
      const amount = parseDisplayedAmount(line.value);
      return {
        section: section.title,
        label: line.label,
        display: line.value,
        ...(amount !== null ? { amount } : {}),
      };
    }),
  );
}

/** Build a snapshot. `takenOn` is an explicit input, so the file is reproducible. */
export function takeSnapshot(
  profile: SituationStore,
  data: BundledData | null,
  answers: WatchedAnswer[],
  deadlines: Deadline[],
  takenOn: string,
): LedgerSnapshot {
  const manifest = data?.manifest;
  return {
    format: LEDGER_FORMAT,
    version: LEDGER_VERSION,
    takenOn,
    situation: profile.snapshot(),
    answers,
    deadlines,
    provenance: {
      schemaVersion: manifest?.schemaVersion ?? 1,
      shards: (manifest?.datasets ?? []).map((d) => ({
        id: d.id,
        version: d.version,
        effectiveYear: d.effectiveYear,
      })),
    },
  };
}

/**
 * Serialize a snapshot. Key order follows the object literal above and the
 * indent is fixed, so the same snapshot always produces the same bytes.
 */
export function serializeLedger(snapshot: LedgerSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

/** True when `text` is a plain (unencrypted) ledger file. */
export function isLedgerFile(text: string): boolean {
  try {
    return (JSON.parse(text) as { format?: string }).format === LEDGER_FORMAT;
  } catch {
    return false;
  }
}

/** True when `text` is an *encrypted* ledger envelope. */
export function isEncryptedLedger(text: string): boolean {
  return isEncrypted(text, LEDGER_ENCRYPTED_FORMAT);
}

/**
 * Parse and validate a ledger file. Rejected **whole**, with a plain-English
 * reason — never partially applied, the same fail-loudly posture as a malformed
 * data shard.
 */
export function parseLedger(text: string): LedgerSnapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON, so it can't be a saved enklayve ledger.");
  }
  const result = LedgerSnapshotSchema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    const where = first?.path.join(".") || "the file";
    throw new Error(
      `That isn't a valid enklayve ledger: ${first?.message ?? "unrecognized shape"} (at ${where}). Nothing was changed.`,
    );
  }
  return result.data as LedgerSnapshot;
}

/** Produce the file content: plain JSON, or an encrypted envelope with a passphrase. */
export async function exportLedger(snapshot: LedgerSnapshot, passphrase?: string): Promise<string> {
  const plain = serializeLedger(snapshot);
  return passphrase ? encrypt(plain, passphrase, LEDGER_ENCRYPTED_FORMAT) : plain;
}

/** Read a ledger file, decrypting first when it is an envelope. */
export async function importLedger(
  fileContent: string,
  passphrase?: string,
): Promise<LedgerSnapshot> {
  if (isEncryptedLedger(fileContent)) {
    if (!passphrase) throw new Error("This ledger is encrypted, so it needs its passphrase.");
    return parseLedger(await decrypt(fileContent, passphrase));
  }
  return parseLedger(fileContent);
}

/** How one watched answer changed. */
export type DiffKind = "threshold" | "material" | "unchanged" | "gone";

export interface AnswerDiff {
  section: string;
  label: string;
  /** The value in the snapshot. */
  before: string;
  /** The value now, or null when the answer no longer appears at all. */
  after: string | null;
  kind: DiffKind;
  /** The dollar movement, when both sides were money figures. */
  delta?: number;
}

export interface ShardChange {
  id: string;
  before: string;
  after: string;
  effectiveYearBefore: number;
  effectiveYearAfter: number;
}

export interface LedgerDiff {
  /** "The world moved under you" — reported regardless of dollar magnitude. */
  crossings: AnswerDiff[];
  material: AnswerDiff[];
  unchanged: AnswerDiff[];
  /** Carried through as stored; the view sorts them by nearness. */
  deadlines: Deadline[];
  /** Which shards moved between the snapshot and the bundle now loaded. */
  shardChanges: ShardChange[];
  /**
   * True when nothing crossed and nothing moved materially. A calm, common,
   * first-class result that renders as reassurance, not as an empty state.
   */
  nothingChanged: boolean;
}

/** Whether a dollar movement clears the §3.1 floor. */
export function isMaterial(before: number, after: number): boolean {
  const moved = Math.abs(after - before);
  const floor = Math.max(MATERIAL_FLOOR_DOLLARS, Math.abs(before) * MATERIAL_FLOOR_SHARE);
  return moved > floor;
}

/**
 * Diff a snapshot against a freshly computed report.
 *
 * Classification, in the order SPEC-4-ledger §3 requires:
 *
 * - A **status** answer that changed is a threshold crossing, always. So is an
 *   answer that disappeared, and an answer that changed between a money figure
 *   and a non-money one — each of those means the *shape* of the answer moved,
 *   which no dollar floor should be able to suppress. **The boundary wins.**
 * - A money answer that moved past the §3.1 floor is **material**.
 * - Everything else is **unchanged**, including a sub-floor movement.
 */
export function diffLedger(
  snapshot: LedgerSnapshot,
  current: ReportModel,
  currentShards: { id: string; version: string; effectiveYear: number }[] = [],
): LedgerDiff {
  const now = new Map(
    watchableAnswers(current).map((a) => [`${a.section} ${a.label}`, a] as const),
  );

  const crossings: AnswerDiff[] = [];
  const material: AnswerDiff[] = [];
  const unchanged: AnswerDiff[] = [];

  for (const before of snapshot.answers) {
    const after = now.get(`${before.section} ${before.label}`);
    const base = { section: before.section, label: before.label, before: before.display };

    if (!after) {
      crossings.push({ ...base, after: null, kind: "gone" });
      continue;
    }
    if (before.display === after.display) {
      unchanged.push({ ...base, after: after.display, kind: "unchanged" });
      continue;
    }
    // One side is a money figure and the other is not, or both are non-numeric
    // and differ: the answer changed shape or status, which is a boundary move
    // however small the numbers look.
    if (before.amount === undefined || after.amount === undefined) {
      crossings.push({ ...base, after: after.display, kind: "threshold" });
      continue;
    }
    const delta = after.amount - before.amount;
    if (isMaterial(before.amount, after.amount)) {
      material.push({ ...base, after: after.display, kind: "material", delta });
    } else {
      unchanged.push({ ...base, after: after.display, kind: "unchanged", delta });
    }
  }

  const byId = new Map(currentShards.map((s) => [s.id, s]));
  const shardChanges: ShardChange[] = [];
  for (const before of snapshot.provenance.shards) {
    const after = byId.get(before.id);
    if (!after) continue;
    if (after.version === before.version && after.effectiveYear === before.effectiveYear) continue;
    shardChanges.push({
      id: before.id,
      before: before.version,
      after: after.version,
      effectiveYearBefore: before.effectiveYear,
      effectiveYearAfter: after.effectiveYear,
    });
  }

  return {
    crossings,
    material,
    unchanged,
    deadlines: snapshot.deadlines,
    shardChanges,
    nothingChanged: crossings.length === 0 && material.length === 0,
  };
}
