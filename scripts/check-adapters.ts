/**
 * The adapter-anchoring check.
 *
 * Each refresh adapter (scripts/refresh/adapters.ts) fetches one page and
 * regexes the figure it is responsible for out of it. That only works while the
 * page still *says* the figure in the shape the parser expects. Agencies move
 * numbers into PDFs, behind client-side rendering, or onto a different page
 * entirely, and when that happens the adapter stops anchoring anything.
 *
 * The failure is quiet in the worst way. A refresh that cannot parse opens a
 * fail-safe alert PR rather than a data PR — correct behaviour, and the shard
 * keeps its last-good values — but the *shard stops being watched*. It then sits
 * at whatever year it was authored in while its citation still points at a live
 * .gov page, which is a wrong number wearing a correct citation. The 2026-08-29
 * source audit found exactly that in Illinois, Michigan, Missouri and Georgia:
 * four shards a year or two stale behind adapters that could no longer read
 * their own sources.
 *
 * So this runs every adapter's parser against its live source and reports which
 * ones can still anchor. It is a *dry run*: nothing is written, no shard is
 * changed, and a parse that succeeds is not asserted to produce any particular
 * value — only that the source still speaks the parser's language.
 *
 * Like check-links, it runs on a schedule and on demand, never in the unit
 * suite: it needs the network, and a test that fails when a state's website has
 * a bad afternoon teaches people to ignore failing tests.
 *
 *   npm run check:adapters
 *   npm run check:adapters -- --group state-il
 */
import { readFileSync, appendFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADAPTERS,
  adaptersForGroup,
  type RefreshAdapter,
  type RefreshGroup,
} from "./refresh/adapters.ts";
import { fetchSource } from "./fetch-source.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(ROOT, "data");
const CONCURRENCY = 6;

/** Why an adapter could not anchor: the page, or the parser reading it. */
export type AnchorStatus = "anchored" | "unparsed" | "unreachable";

export interface AnchorResult {
  adapterId: string;
  group: string;
  url: string;
  status: AnchorStatus;
  detail?: string;
}

/**
 * Classify one adapter's outcome. `unreachable` means the page did not come
 * back at all — a network or HTTP problem, which may be transient and is not
 * the adapter's fault. `unparsed` means the page came back and the parser could
 * not find its figure, which is the condition worth acting on: the source moved
 * and the shard is no longer being watched.
 */
export function classifyAnchor(
  fetched: { ok: true; raw: string } | { ok: false; reason: string },
  parse: () => { ok: true } | { ok: false; reason: string },
): { status: AnchorStatus; detail?: string } {
  if (!fetched.ok) return { status: "unreachable", detail: fetched.reason };
  const parsed = parse();
  if (!parsed.ok) return { status: "unparsed", detail: parsed.reason };
  return { status: "anchored" };
}

/** Group results into the report the workflow posts and a human reads. */
export function renderAnchorReport(results: readonly AnchorResult[]): string {
  const by = (s: AnchorStatus): AnchorResult[] => results.filter((r) => r.status === s);
  const anchored = by("anchored");
  const unparsed = by("unparsed");
  const unreachable = by("unreachable");

  const lines: string[] = [];
  lines.push(`Checked ${results.length} refresh adapters.`);
  lines.push(
    `${anchored.length} anchored · ${unparsed.length} could not parse · ${unreachable.length} unreachable.`,
  );

  if (unparsed.length > 0) {
    lines.push("");
    lines.push("## Could not anchor");
    lines.push("");
    lines.push(
      "The page came back but the parser could not find its figure. The source has moved" +
        " — into a PDF, behind client-side rendering, or onto another page — so this shard is" +
        " no longer being watched and will sit at whatever year it was authored in. Point the" +
        " adapter at a page that states the number, or convert it to a change-watch and record" +
        " the shard's figures as a reviewer step.",
    );
    lines.push("");
    for (const r of unparsed) {
      lines.push(`- \`${r.adapterId}\` (${r.group})`);
      lines.push(`  - ${r.url}`);
      lines.push(`  - ${r.detail ?? "no reason given"}`);
    }
  }

  if (unreachable.length > 0) {
    lines.push("");
    lines.push("## Unreachable");
    lines.push("");
    lines.push(
      "The page did not come back. This may be transient — a government site having a bad" +
        " afternoon is not an adapter defect — so it is reported separately and does not fail" +
        " the check on its own.",
    );
    lines.push("");
    for (const r of unreachable) {
      lines.push(`- \`${r.adapterId}\` (${r.group})`);
      lines.push(`  - ${r.url}`);
      lines.push(`  - ${r.detail ?? "no reason given"}`);
    }
  }

  return lines.join("\n");
}

/* c8 ignore start -- network + CLI */

async function check(adapter: RefreshAdapter): Promise<AnchorResult> {
  const current = JSON.parse(readFileSync(join(DATA_DIR, `${adapter.id}.json`), "utf8")) as Record<
    string,
    unknown
  >;
  const fetched = await fetchSource(adapter.sourceUrl);
  const { status, detail } = classifyAnchor(fetched, () => {
    if (!fetched.ok) return { ok: false, reason: fetched.reason };
    try {
      const outcome = adapter.parse(fetched.raw, current);
      return outcome.ok ? { ok: true } : { ok: false, reason: outcome.reason };
    } catch (error) {
      return { ok: false, reason: `parser threw: ${(error as Error).message}` };
    }
  });
  return { adapterId: adapter.id, group: adapter.group, url: adapter.sourceUrl, status, detail };
}

async function main(): Promise<void> {
  const groupIdx = process.argv.indexOf("--group");
  const adapters =
    groupIdx === -1 ? [...ADAPTERS] : adaptersForGroup(process.argv[groupIdx + 1] as RefreshGroup);
  if (adapters.length === 0) throw new Error("no adapters selected");

  const results: AnchorResult[] = [];
  let next = 0;
  async function worker(): Promise<void> {
    while (next < adapters.length) {
      results.push(await check(adapters[next++]!));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  results.sort((a, b) => a.adapterId.localeCompare(b.adapterId));

  const report = renderAnchorReport(results);
  process.stdout.write(`${report}\n`);

  const out = process.env.GITHUB_OUTPUT;
  if (out) {
    const unparsed = results.filter((r) => r.status === "unparsed").length;
    const unreachable = results.filter((r) => r.status === "unreachable").length;
    appendFileSync(out, `unparsed=${unparsed}\nunreachable=${unreachable}\n`);
    appendFileSync(out, `report<<EOF\n${report}\nEOF\n`);
  }
  // Only an unparsed adapter fails the check. Unreachable is reported and left
  // alone: it is usually the agency's afternoon, not our defect.
  if (results.some((r) => r.status === "unparsed")) process.exitCode = 1;
}

if (process.argv[1] && process.argv[1].endsWith("check-adapters.ts")) {
  await main();
}
/* c8 ignore stop */
