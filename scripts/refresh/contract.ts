/**
 * The data-refresh workflow contract (BUILD-SPEC.md §7.3), as pure functions.
 *
 * Every refresh job — one per source group, see the .github/workflows/refresh-*
 * files — follows the same shape that is already proven across the family:
 *
 *   1. Fetch the source and parse it with a source-specific adapter into
 *      normalized JSON (the adapters live in ./adapters.ts).
 *   2. Diff the new shard against the committed one and append a human-readable
 *      entry to the source diff log (docs/source-diff-log.md).
 *   3. Run the full golden test suite against the new data.
 *   4. Open a pull request only if the tests pass and values actually changed.
 *      If the source 404s or fails validation, open an *alert* PR instead of
 *      shipping a wrong number.
 *   5. Never auto-commit a data change to `main` without passing the test gate.
 *
 * This module owns steps 2 and 4 (the diff and the open-PR-vs-alert decision)
 * plus the diff-log rendering. It is intentionally free of I/O so it can be
 * unit-tested with synthetic inputs — the runner (./run.ts) wires the fetch,
 * the shard write, and the git/PR side effects around it, and the workflow
 * gates the PR on `npm run test`.
 */

/** A single human-readable change line, or the conclusion that nothing changed. */
export interface DiffResult {
  changed: boolean;
  lines: string[];
}

/**
 * Fields that legitimately change on every run and must not, by themselves,
 * count as a data change (the retrieval date is stamped fresh each fetch).
 */
const DEFAULT_IGNORE = ["citation.dateRetrieved"];

/**
 * Deep-diff two shard objects, returning one `path: old -> new` line per
 * changed leaf (added, removed, or modified). Paths in `ignore` are skipped.
 * Determinism: keys are walked in sorted order so the diff is reproducible.
 */
export function diffShards(
  before: unknown,
  after: unknown,
  ignore: string[] = DEFAULT_IGNORE,
): DiffResult {
  const ignoreSet = new Set(ignore);
  const lines: string[] = [];
  walk("", before, after, ignoreSet, lines);
  return { changed: lines.length > 0, lines };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function format(value: unknown): string {
  if (value === undefined) return "(absent)";
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}

function walk(
  path: string,
  before: unknown,
  after: unknown,
  ignore: Set<string>,
  lines: string[],
): void {
  if (ignore.has(path)) return;

  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    for (const key of keys) {
      walk(path ? `${path}.${key}` : key, before[key], after[key], ignore, lines);
    }
    return;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    for (let i = 0; i < length; i++) {
      walk(`${path}[${i}]`, before[i], after[i], ignore, lines);
    }
    return;
  }

  if (format(before) !== format(after)) {
    lines.push(`${path || "(root)"}: ${format(before)} -> ${format(after)}`);
  }
}

/**
 * The four terminal states of a refresh job, mirroring BUILD-SPEC.md §7.3:
 *   - `open-pr`  — source fetched, schema valid, tests pass, values changed.
 *   - `alert-pr` — source unreachable or failed validation; open an alert PR
 *                  rather than ship a wrong number (the fail-safe branch).
 *   - `blocked`  — the new data fails the golden test gate; propose nothing
 *                  (never auto-commit data that breaks a golden case, §7.3.5).
 *   - `no-op`    — fetched and valid, but nothing changed; do nothing.
 */
export type RefreshOutcome = "open-pr" | "alert-pr" | "blocked" | "no-op";

export interface OutcomeInput {
  /** Did the source fetch succeed (no 404 / network error)? */
  fetchOk: boolean;
  /** Did the adapter produce a structurally valid normalized shard? */
  schemaValid: boolean;
  /** Did any committed value change (the diff is non-empty)? */
  valuesChanged: boolean;
  /** Did the full golden suite pass against the new data? */
  testsPass: boolean;
}

/**
 * Decide the terminal state from the four gate signals. The order matters:
 * a fetch or validation failure short-circuits to the fail-safe alert before
 * the diff or the test result is even considered.
 */
export function decideOutcome(input: OutcomeInput): RefreshOutcome {
  if (!input.fetchOk || !input.schemaValid) return "alert-pr";
  if (!input.valuesChanged) return "no-op";
  if (!input.testsPass) return "blocked";
  return "open-pr";
}

/** A one-line summary of an outcome, for the job log and the diff-log entry. */
export function describeOutcome(outcome: RefreshOutcome): string {
  switch (outcome) {
    case "open-pr":
      return "values changed and tests pass — opening a data pull request";
    case "alert-pr":
      return "source unreachable or failed validation — opening a fail-safe alert";
    case "blocked":
      return "new data fails the golden test gate — proposing nothing";
    case "no-op":
      return "source fetched and valid, but no values changed — nothing to do";
  }
}

export interface DiffLogEntry {
  /** ISO date (YYYY-MM-DD) the job ran. Passed in so the entry is reproducible. */
  date: string;
  /** Human-readable source name, e.g. "BLS CPI-U public API". */
  source: string;
  /** The manifest shard id touched, e.g. "cpi-u-annual". */
  datasetId: string;
  outcome: RefreshOutcome;
  /** Change lines from {@link diffShards}; empty for a no-op/alert. */
  lines: string[];
  /** For an alert, why the source failed. */
  reason?: string;
}

/**
 * Render one Markdown entry to prepend to docs/source-diff-log.md. Newest
 * entries go on top, so the log reads as a reverse-chronological journal of
 * every data change (§7.3 step 2: "describing what changed and the old to new
 * values").
 */
export function renderDiffLogEntry(entry: DiffLogEntry): string {
  const header = `## ${entry.date} — ${entry.datasetId} (${entry.source})`;
  const body: string[] = [`_${describeOutcome(entry.outcome)}_`, ""];

  if (entry.outcome === "alert-pr") {
    body.push(`> **Alert:** ${entry.reason ?? "source failed"}. The committed shard is unchanged;`);
    body.push("> the runtime fail-safe gate will show a verify-before-relying banner if this");
    body.push("> dataset falls outside its refresh window before a good refresh lands.");
  } else if (entry.lines.length > 0) {
    for (const line of entry.lines) body.push(`- ${line}`);
  } else {
    body.push("- (no value changes)");
  }

  return `${header}\n\n${body.join("\n")}\n`;
}
