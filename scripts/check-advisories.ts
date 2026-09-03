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
 * It turned out not to reach us (the flaw is in serialization; this app only
 * ever parses), and reaching that verdict is what this check is designed for.
 * An audit that reports every advisory as a build failure gets muted within a
 * month, because most advisories in a front-end dependency tree are unreachable
 * and the upgrade often is not available. An audit nobody runs is worse. So this
 * one asks a narrower question: **is there an advisory nobody has looked at
 * yet?** (That particular advisory is gone now — the patched 0.8.15 was taken
 * on 2026-09-03, see below — but it is the reason this file exists.)
 *
 * Every finding must appear in `scripts/advisory-triage.json` with the reason it
 * does not reach this app, or this fails. A reviewed advisory is quiet; a new
 * one is loud; a triage entry that has gone a year without being re-read against
 * the code warns, because "unreachable" is a claim about a codebase that moves.
 *
 * **And an entry may not stand while a fix is on the shelf.** The stated bar for
 * accepting an advisory is two halves — no upgrade is available *and* the
 * vulnerable path is unreachable — and only the second half was ever checked.
 * The first entry this file held got the first half wrong: `@xmldom/xmldom`
 * 0.8.15 backported the fix inside mammoth's own `^0.8.6` range and had been
 * published twelve days before the entry was written, but only the 0.9 upgrade
 * was tried, and 0.9 breaks the shipped `.docx` path. `npm audit` was reporting
 * `fixAvailable: true` in the same payload this script already parsed. It now
 * reads it: an accepted entry for an advisory npm calls fixable fails the run,
 * whatever the prose beside it says. Unreachable is a judgement worth trusting
 * for a year; "there is no fix" is a fact with an expiry date.
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
  /**
   * Whether npm says the tree can move off it. `fixAvailable` is reported per
   * *package*, not per advisory, so every advisory reaching this app through a
   * given package carries that package's answer. `false` and an object both
   * mean something: the object names the upgrade and whether it is a breaking
   * one, and npm reports `true` when a plain `npm audit fix` would do it.
   */
  fixAvailable: boolean;
}

/**
 * Flatten `npm audit --json` into one row per advisory. The shape is a map of
 * package name to a record whose `via` is a mixed array: objects are the
 * advisories themselves, bare strings are "this package is affected because a
 * dependency is", which would otherwise be counted as findings with no id.
 */
export function advisoriesFrom(report: unknown): Advisory[] {
  const vulns = (
    report as {
      vulnerabilities?: Record<string, { via?: unknown[]; fixAvailable?: unknown }>;
    }
  )?.vulnerabilities;
  if (!vulns) return [];
  const out = new Map<string, Advisory>();
  for (const entry of Object.values(vulns)) {
    // `fixAvailable: false` is the only answer that means "nothing to take".
    // An object is npm naming the version that fixes it, which is a fix.
    const fixAvailable = entry.fixAvailable !== undefined && entry.fixAvailable !== false;
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
        fixAvailable,
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

/**
 * Accepted entries for an advisory npm says the tree can move off.
 *
 * The bar for an entry is two halves — no upgrade is available AND the
 * vulnerable path is unreachable — and this is the first half, asked of npm
 * rather than of the prose. An entry standing over an available fix is not a
 * reviewed risk; it is an upgrade nobody did, wearing a reviewed risk's clothes.
 */
export function fixable(found: Advisory[], accepted: TriageEntry[]): Advisory[] {
  const acceptedIds = new Set(accepted.map((a) => a.id));
  return found.filter((a) => acceptedIds.has(a.id) && a.fixAvailable);
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
  const patchable = fixable(found, triage.accepted);
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
  for (const a of patchable) {
    lines.push(`  FIXABLE    ${a.severity.padEnd(8)} ${a.package} — npm reports a fix available.`);
    lines.push(`             Take the upgrade and drop its triage entry: ${a.url}`);
  }
  for (const a of old) {
    lines.push(`  RE-READ    ${a.package} (${a.id}) was last reviewed ${a.reviewed}.`);
  }
  if (untriaged.length === 0 && stale.length === 0 && patchable.length === 0 && old.length === 0) {
    lines.push("Every reported advisory has a reviewed reason it does not reach this app.");
  }
  const report = lines.join("\n");
  console.log(report);

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `untriaged=${untriaged.length}\nstale=${stale.length}\nfixable=${patchable.length}\n` +
        `report<<EOF\n${report}\nEOF\n`,
    );
  }

  // An advisory nobody has looked at fails the run, and so does one standing
  // behind a triage entry while npm reports a fix on the shelf: that is not a
  // reviewed risk, it is an upgrade nobody did. A resolved or overdue entry is
  // housekeeping — worth saying, not worth blocking on.
  if (untriaged.length > 0 || patchable.length > 0) process.exit(1);
}

/* c8 ignore start */
if (process.argv[1] && process.argv[1].endsWith("check-advisories.ts")) {
  main();
}
/* c8 ignore stop */
