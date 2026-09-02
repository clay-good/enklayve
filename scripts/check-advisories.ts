/**
 * The dependency-advisory check.
 *
 * This site's whole claim is that nothing leaves the device. That claim is only
 * as good as the code running on the device, and most of that code is other
 * people's: a document reader, a PDF renderer, an OCR engine. `npm audit` knows
 * when one of them has a published advisory, and nothing here was reading it —
 * so on 2026-09-02 a moderate advisory in `@xmldom/xmldom`, which ships in the
 * bundle that parses a household's Word documents, had been open for some time
 * with nobody in a position to say whether it mattered.
 *
 * It turned out not to matter (the flaw is in serialization; this app only ever
 * parses), and that is exactly the outcome this check is designed for. An audit
 * that reports every advisory as a build failure gets muted within a month,
 * because most advisories in a front-end dependency tree are unreachable and the
 * upgrade often is not available. An audit nobody runs is worse. So this one
 * asks a narrower question: **is there an advisory nobody has looked at yet?**
 *
 * Every finding must appear in `scripts/advisory-triage.json` with the reason it
 * does not reach this app, or this fails. A reviewed advisory is quiet; a new
 * one is loud; a triage entry that has gone a year without being re-read against
 * the code warns, because "unreachable" is a claim about a codebase that moves.
 *
 * Like check-links and check-adapters, it stays out of the unit CI: it needs the
 * network, and the advisory database changes under you.
 *
 *   npm run check:advisories
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TRIAGE_FILE = join(ROOT, "scripts", "advisory-triage.json");
/** How long a "does not reach us" judgement is trusted before it wants re-reading. */
const REVIEW_STALE_DAYS = 365;

interface TriageEntry {
  id: string;
  package: string;
  severity?: string;
  reviewed: string;
  why: string[];
}

/** One advisory, flattened out of `npm audit --json`'s per-package `via` lists. */
export interface Advisory {
  id: string;
  package: string;
  severity: string;
  title: string;
  url: string;
}

/**
 * Flatten `npm audit --json` into one row per advisory. The shape is a map of
 * package name to a record whose `via` is a mixed array: objects are the
 * advisories themselves, bare strings are "this package is affected because a
 * dependency is", which would otherwise be counted as findings with no id.
 */
export function advisoriesFrom(report: unknown): Advisory[] {
  const vulns = (report as { vulnerabilities?: Record<string, { via?: unknown[] }> })
    ?.vulnerabilities;
  if (!vulns) return [];
  const out = new Map<string, Advisory>();
  for (const entry of Object.values(vulns)) {
    for (const via of entry.via ?? []) {
      if (typeof via !== "object" || via === null) continue;
      const v = via as { url?: string; name?: string; severity?: string; title?: string };
      // The advisory id is the last segment of its GHSA url — the only stable
      // identifier in the payload (`source` is a numeric registry id that the
      // advisory pages do not show, so nobody could match it up by hand).
      const id = v.url?.split("/").pop();
      if (!id) continue;
      out.set(id, {
        id,
        package: v.name ?? "(unknown)",
        severity: v.severity ?? "unknown",
        title: v.title ?? "",
        url: v.url ?? "",
      });
    }
  }
  return [...out.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Advisories with no triage entry, and triage entries nothing reports any more. */
export function reconcile(
  found: Advisory[],
  accepted: TriageEntry[],
): { untriaged: Advisory[]; stale: TriageEntry[] } {
  const acceptedIds = new Set(accepted.map((a) => a.id));
  const foundIds = new Set(found.map((a) => a.id));
  return {
    untriaged: found.filter((a) => !acceptedIds.has(a.id)),
    // An entry for an advisory npm no longer reports means the dependency moved
    // on. Left in place it is a standing exception for a problem that is gone,
    // which is how an allowlist quietly stops being a list of decisions.
    stale: accepted.filter((a) => !foundIds.has(a.id)),
  };
}

/** Triage entries whose reasoning has not been re-read against the code in a year. */
export function overdue(accepted: TriageEntry[], now: Date): TriageEntry[] {
  const cutoff = now.getTime() - REVIEW_STALE_DAYS * 24 * 60 * 60 * 1000;
  return accepted.filter((a) => {
    const at = Date.parse(a.reviewed);
    return Number.isFinite(at) && at < cutoff;
  });
}

function main(): void {
  const triage = JSON.parse(readFileSync(TRIAGE_FILE, "utf8")) as { accepted: TriageEntry[] };
  let raw: string;
  try {
    raw = execFileSync("npm", ["audit", "--json"], { cwd: ROOT, encoding: "utf8" });
  } catch (error) {
    // `npm audit` exits non-zero *because* it found something. That is the
    // normal path here, not a failure — the output is on stdout either way.
    const out = (error as { stdout?: string }).stdout;
    if (!out) {
      console.error(`npm audit did not run: ${String(error)}`);
      process.exit(1);
    }
    raw = out;
  }

  const found = advisoriesFrom(JSON.parse(raw));
  const { untriaged, stale } = reconcile(found, triage.accepted);
  const old = overdue(triage.accepted, new Date());

  const lines: string[] = [];
  lines.push(`${found.length} advisories reported, ${triage.accepted.length} previously reviewed.`);
  for (const a of untriaged) {
    lines.push(`  UNTRIAGED  ${a.severity.padEnd(8)} ${a.package} — ${a.title}`);
    lines.push(`             ${a.url}`);
  }
  for (const a of stale) {
    lines.push(
      `  RESOLVED   ${a.package} (${a.id}) is no longer reported — drop its triage entry.`,
    );
  }
  for (const a of old) {
    lines.push(`  RE-READ    ${a.package} (${a.id}) was last reviewed ${a.reviewed}.`);
  }
  if (untriaged.length === 0 && stale.length === 0 && old.length === 0) {
    lines.push("Every reported advisory has a reviewed reason it does not reach this app.");
  }
  const report = lines.join("\n");
  console.log(report);

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `untriaged=${untriaged.length}\nstale=${stale.length}\nreport<<EOF\n${report}\nEOF\n`,
    );
  }

  // Only an advisory nobody has looked at fails the run. A resolved or overdue
  // entry is housekeeping — worth saying, not worth blocking on.
  if (untriaged.length > 0) process.exit(1);
}

/* c8 ignore start */
if (process.argv[1] && process.argv[1].endsWith("check-advisories.ts")) {
  main();
}
/* c8 ignore stop */
