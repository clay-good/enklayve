import {
  DATASET_SCHEMAS,
  ManifestSchema,
  type DatasetKind,
  type Manifest,
  type ManifestEntry,
} from "./schemas";
import { sha256Hex } from "./integrity";

/**
 * Data access layer with the fail-safe gate (BUILD-SPEC.md §7, §8).
 *
 * For each manifest entry the loader, in order:
 *   1. recomputes the shard's sha256 and compares it to the pinned hash,
 *   2. parses the JSON,
 *   3. validates it against the zod schema for its kind,
 *   4. checks the effective year against the dataset's staleness window.
 *
 * Any failure marks the dataset unusable. A tile depending on it can read
 * {@link LoadedDataset.status} (or {@link needsVerifyBanner}) and show the
 * "verify before relying" banner instead of presenting a wrong number. The
 * gate is per dataset, so a stale California shard never breaks the other
 * jurisdictions (BUILD-SPEC.md §8).
 */

export type DatasetStatus =
  /** Hash verified, schema valid, effective year fresh — safe to compute from. */
  | "ok"
  /** Effective year is older than the dataset's staleness window. */
  | "stale"
  /** Hash mismatch or schema validation failure — never compute from this. */
  | "invalid";

export interface LoadedDataset<T = unknown> {
  readonly id: string;
  readonly kind: DatasetKind;
  readonly status: DatasetStatus;
  readonly effectiveYear: number;
  /** Parsed + validated data, or null when status is "invalid". */
  readonly data: T | null;
  /** Human-readable reasons the dataset is not "ok" (empty when ok). */
  readonly problems: string[];
}

/** A tile should show the "verify before relying" banner for any non-ok status. */
export function needsVerifyBanner(status: DatasetStatus): boolean {
  return status !== "ok";
}

function currentUtcYear(): number {
  return new Date().getUTCFullYear();
}

/**
 * Load and gate a single shard. `shardText` is the exact bytes the manifest
 * hash was computed over (bundled into the build as a raw string).
 */
export async function loadDataset(
  entry: ManifestEntry,
  shardText: string,
  asOfYear: number = currentUtcYear(),
): Promise<LoadedDataset> {
  const problems: string[] = [];

  // 1. Integrity.
  const actualHash = await sha256Hex(shardText);
  if (actualHash !== entry.contentHash.toLowerCase()) {
    problems.push(
      `content hash mismatch (expected ${entry.contentHash.slice(0, 12)}…, got ${actualHash.slice(0, 12)}…)`,
    );
    return invalid(entry, problems);
  }

  // 2. Parse.
  let parsed: unknown;
  try {
    parsed = JSON.parse(shardText);
  } catch (err) {
    problems.push(`JSON parse error: ${(err as Error).message}`);
    return invalid(entry, problems);
  }

  // 3. Schema.
  const schema = DATASET_SCHEMAS[entry.kind];
  const result = schema.safeParse(parsed);
  if (!result.success) {
    problems.push(`schema validation failed: ${result.error.issues.map((i) => i.message).join("; ")}`);
    return invalid(entry, problems);
  }

  // 4. Staleness.
  const yearsBehind = asOfYear - entry.effectiveYear;
  if (yearsBehind > entry.staleAfterYears) {
    problems.push(
      `effective year ${entry.effectiveYear} is ${yearsBehind} year(s) behind ${asOfYear} (window ${entry.staleAfterYears})`,
    );
    return {
      id: entry.id,
      kind: entry.kind,
      status: "stale",
      effectiveYear: entry.effectiveYear,
      data: result.data,
      problems,
    };
  }

  return {
    id: entry.id,
    kind: entry.kind,
    status: "ok",
    effectiveYear: entry.effectiveYear,
    data: result.data,
    problems,
  };
}

function invalid(entry: ManifestEntry, problems: string[]): LoadedDataset {
  return {
    id: entry.id,
    kind: entry.kind,
    status: "invalid",
    effectiveYear: entry.effectiveYear,
    data: null,
    problems,
  };
}

export interface LoadedManifest {
  readonly datasets: LoadedDataset[];
  readonly byId: Map<string, LoadedDataset>;
  /** True when at least one dataset is stale or invalid. */
  readonly hasFailSafe: boolean;
}

/**
 * Validate the manifest, then load and gate every shard it references.
 * `shards` maps each entry id to the exact shard text. A missing shard is
 * reported as an invalid dataset rather than throwing, so one absent file does
 * not take the whole site down.
 */
export async function loadManifest(
  rawManifest: unknown,
  shards: Record<string, string>,
  asOfYear: number = currentUtcYear(),
): Promise<LoadedManifest> {
  const manifest: Manifest = ManifestSchema.parse(rawManifest);

  const datasets = await Promise.all(
    manifest.datasets.map(async (entry) => {
      const shardText = shards[entry.id];
      if (shardText === undefined) {
        return invalid(entry, [`shard "${entry.shard}" not bundled`]);
      }
      return loadDataset(entry, shardText, asOfYear);
    }),
  );

  const byId = new Map(datasets.map((d) => [d.id, d]));
  const hasFailSafe = datasets.some((d) => d.status !== "ok");
  return { datasets, byId, hasFailSafe };
}
