/**
 * The data-refresh runner (BUILD-SPEC.md §7.3). One workflow per source group
 * (.github/workflows/refresh-*.yml) invokes this on its cadence and on manual
 * dispatch:
 *
 *   node scripts/refresh/run.ts --group cpi
 *
 * For each adapter in the group it: fetches the source, parses it onto the
 * committed shard, stamps the retrieval date, diffs the result, and — when
 * values changed — writes the shard and appends a human-readable diff-log
 * entry. It then emits machine-readable outputs (`outcome`, `changed`,
 * `shards`) to `$GITHUB_OUTPUT` so the workflow can run the manifest rebuild +
 * the golden test gate and open a PR (or, on a fetch/parse failure, a fail-safe
 * alert PR). The runner never commits and never opens a PR itself — the test
 * gate and the PR live in the workflow, so bad data can never reach `main`.
 *
 * The orchestration that needs no network (parse -> stamp -> diff -> outcome ->
 * diff-log entry) is the pure {@link planRefresh}, unit-tested in
 * tests/build/dataRefresh.test.ts. Only fetch + file writes live in the CLI.
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decideOutcome, diffShards, renderDiffLogEntry, type RefreshOutcome } from "./contract.ts";
import { ADAPTERS, adaptersForGroup, type RefreshAdapter, type RefreshGroup } from "./adapters.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DATA_DIR = join(ROOT, "data");
const DIFF_LOG = join(ROOT, "docs", "source-diff-log.md");
/** New entries are prepended right after this marker in the diff log. */
const ENTRIES_MARKER = "<!-- entries -->";

export interface RefreshPlan {
  adapterId: string;
  outcome: RefreshOutcome;
  /** The new shard to write, present only when `outcome === "open-pr"`. */
  shard: Record<string, unknown> | null;
  /** The Markdown diff-log entry to prepend. */
  logEntry: string;
  reason?: string;
}

/**
 * Pure planning step: given the committed shard, the fetched raw text (or a
 * fetch error), and today's date, decide what the refresh would do. No I/O, so
 * tests drive every branch with synthetic inputs.
 */
export function planRefresh(
  adapter: RefreshAdapter,
  current: Record<string, unknown>,
  fetched: { ok: true; raw: string } | { ok: false; reason: string },
  today: string,
): RefreshPlan {
  if (!fetched.ok) {
    const outcome = decideOutcome({
      fetchOk: false,
      schemaValid: false,
      valuesChanged: false,
      testsPass: false,
    });
    return {
      adapterId: adapter.id,
      outcome,
      shard: null,
      reason: fetched.reason,
      logEntry: renderDiffLogEntry({
        date: today,
        source: adapter.source,
        datasetId: adapter.id,
        outcome,
        lines: [],
        reason: fetched.reason,
      }),
    };
  }

  const parsed = adapter.parse(fetched.raw, current);
  if (!parsed.ok) {
    const outcome = decideOutcome({
      fetchOk: true,
      schemaValid: false,
      valuesChanged: false,
      testsPass: false,
    });
    return {
      adapterId: adapter.id,
      outcome,
      shard: null,
      reason: parsed.reason,
      logEntry: renderDiffLogEntry({
        date: today,
        source: adapter.source,
        datasetId: adapter.id,
        outcome,
        lines: [],
        reason: parsed.reason,
      }),
    };
  }

  // Stamp the retrieval date on the fresh shard's citation.
  const shard = parsed.shard;
  const citation = shard.citation;
  if (citation && typeof citation === "object") {
    (citation as Record<string, unknown>).dateRetrieved = today;
  }

  const diff = diffShards(current, shard);
  // The runner cannot know the test result yet; it produces the candidate and
  // the workflow's test step is the real gate. So plan with testsPass=true and
  // let the workflow downgrade to "blocked" if the golden suite fails.
  const outcome = decideOutcome({
    fetchOk: true,
    schemaValid: true,
    valuesChanged: diff.changed,
    testsPass: true,
  });

  return {
    adapterId: adapter.id,
    outcome,
    shard: outcome === "open-pr" ? shard : null,
    logEntry: renderDiffLogEntry({
      date: today,
      source: adapter.source,
      datasetId: adapter.id,
      outcome,
      lines: diff.lines,
    }),
  };
}

/** Serialize a shard exactly like the committed data files (2-space + newline). */
export function serializeShard(shard: Record<string, unknown>): string {
  return `${JSON.stringify(shard, null, 2)}\n`;
}

/** Prepend a diff-log entry after the entries marker. */
export function insertLogEntry(logContents: string, entry: string): string {
  const idx = logContents.indexOf(ENTRIES_MARKER);
  if (idx === -1) {
    // No marker: append at the end (still a valid log).
    return `${logContents.trimEnd()}\n\n${entry}`;
  }
  const cut = idx + ENTRIES_MARKER.length;
  return `${logContents.slice(0, cut)}\n\n${entry}${logContents.slice(cut)}`;
}

// --- CLI ---------------------------------------------------------------------

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function fetchSource(
  url: string,
): Promise<{ ok: true; raw: string } | { ok: false; reason: string }> {
  try {
    const response = await fetch(url, { headers: { "user-agent": "enklayve-data-refresh" } });
    if (!response.ok) {
      return { ok: false, reason: `source returned HTTP ${response.status}` };
    }
    return { ok: true, raw: await response.text() };
  } catch (error) {
    return { ok: false, reason: `fetch failed: ${(error as Error).message}` };
  }
}

function emitOutput(key: string, value: string): void {
  const out = process.env.GITHUB_OUTPUT;
  if (out) appendFileSync(out, `${key}=${value}\n`);
}

function parseArgs(argv: string[]): { adapters: RefreshAdapter[]; dryRun: boolean } {
  const dryRun = argv.includes("--dry-run");
  const groupIdx = argv.indexOf("--group");
  const adapterIdx = argv.indexOf("--adapter");
  if (groupIdx !== -1) {
    const group = argv[groupIdx + 1] as RefreshGroup | undefined;
    if (!group) throw new Error("--group requires a value");
    const adapters = adaptersForGroup(group);
    if (adapters.length === 0) throw new Error(`no adapters in group "${group}"`);
    return { adapters, dryRun };
  }
  if (adapterIdx !== -1) {
    const id = argv[adapterIdx + 1];
    const adapter = ADAPTERS.find((a) => a.id === id);
    if (!adapter) throw new Error(`no adapter with id "${id}"`);
    return { adapters: [adapter], dryRun };
  }
  throw new Error("usage: run.ts --group <group> | --adapter <id> [--dry-run]");
}

async function runCli(): Promise<void> {
  const { adapters, dryRun } = parseArgs(process.argv.slice(2));
  const date = today();
  const changedShards: string[] = [];
  const outcomes: RefreshOutcome[] = [];

  for (const adapter of adapters) {
    const shardPath = join(DATA_DIR, `${adapter.id}.json`);
    const current = JSON.parse(readFileSync(shardPath, "utf8")) as Record<string, unknown>;
    const fetched = await fetchSource(adapter.sourceUrl);
    const plan = planRefresh(adapter, current, fetched, date);
    outcomes.push(plan.outcome);

    console.log(`\n[${adapter.id}] ${plan.outcome}${plan.reason ? ` — ${plan.reason}` : ""}`);

    if (!dryRun) {
      // Append the diff-log entry for every run that produced a record
      // (a change or an alert); a no-op leaves the log untouched.
      if (plan.outcome === "open-pr" || plan.outcome === "alert-pr") {
        const log = readFileSync(DIFF_LOG, "utf8");
        writeFileSync(DIFF_LOG, insertLogEntry(log, plan.logEntry), "utf8");
      }
      if (plan.outcome === "open-pr" && plan.shard) {
        writeFileSync(shardPath, serializeShard(plan.shard), "utf8");
        changedShards.push(adapter.id);
      }
    }
  }

  // Roll the group's outcome up: an alert wins (needs a human), then open-pr.
  const groupOutcome: RefreshOutcome = outcomes.includes("alert-pr")
    ? "alert-pr"
    : outcomes.includes("open-pr")
      ? "open-pr"
      : outcomes.includes("blocked")
        ? "blocked"
        : "no-op";

  emitOutput("outcome", groupOutcome);
  emitOutput("changed", changedShards.length > 0 ? "true" : "false");
  emitOutput("shards", changedShards.join(","));
  console.log(`\nGroup outcome: ${groupOutcome} (changed: ${changedShards.join(", ") || "none"})`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
