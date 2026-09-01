/**
 * The source watch: shards whose sources must be READ on a change, not parsed.
 *
 * Six hand-authored Pillar 4 shards (SPEC-4 §10.7) and, since 2026-08-30, a
 * growing set of tax shards. Delaware was the first — its standard deduction is
 * statutory and unindexed, so there is no annual figure for an adapter to anchor
 * and a change to it is an amendment somebody has to read — and the same shape
 * has since taken in the federal statutes (§164's SALT limitation, §163(h)(4)'s
 * car loan deduction, and §63(b)'s list of what a filer subtracts without
 * itemizing) and the six states whose income tax starts at federal taxable
 * income, where the question watched is not a figure at all but whether the
 * state still inherits the federal deduction.
 *
 * The existing data-refresh pipeline fetches a source, *parses figures out of
 * it*, and opens a PR with the new numbers. That is exactly right for a bracket
 * table and exactly wrong for these six. A shard that carries what the No
 * Surprises Act protects, or what a state agency's notice must tell you, is
 * prose transcribed from a statute or a consumer page — auto-rewriting it from
 * a scraped page would let the site's most safety-critical sentences change
 * without anyone reading them.
 *
 * Delaware arrives at the same place from the other direction: not a figure too
 * consequential to auto-rewrite, but one that never moves on a schedule. 30 Del.
 * C. §1108 has set it at $3,250 / $6,500 for every taxable period beginning
 * after December 31, 1999, and the section states that as a history of periods
 * without ever using a filing-status label a parser knows. An annual value
 * adapter asking it for this year's figure asks a question with no annual
 * answer, and reports the absence as a broken parser.
 *
 * So these shards get the other half of the guarantee instead: a scheduled job
 * that notices when the source itself moved and asks a human to go re-read it.
 * It fingerprints the visible text of each source, compares against the
 * committed fingerprint, and reports which shards need review. It never edits a
 * shard.
 *
 * The orchestration that needs no network — normalize, fingerprint, compare,
 * decide — is the pure {@link planWatch}, unit-tested. Only the fetch and the
 * file write live in the CLI.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchSource } from "../fetch-source.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
/**
 * The watch list lives beside this script rather than in `data/`, because it is
 * build metadata, not a dataset: it carries no figure a tile computes from, and
 * `data/` is glob-bundled into the app, so a file there would ship to every
 * visitor for no reason. The release audit's "every dataset carries a citation"
 * rule caught exactly this when it briefly lived there.
 */
const WATCH_FILE = join(HERE, "source-watch.json");
/** Below this many characters of visible text, a page is an interstitial, not a source. */
const MIN_SOURCE_TEXT = 2_000;

export interface WatchEntry {
  /** The manifest shard id this source backs. */
  shard: string;
  /** The page to watch. */
  url: string;
  /** Why this shard cannot be auto-parsed, so the choice is arguable later. */
  why: string;
  /** sha256 of the normalized visible text, last time a human reviewed it. */
  fingerprint: string;
  /** ISO date the fingerprint was taken. */
  checkedOn: string;
}

export interface WatchFile {
  entries: WatchEntry[];
}

export type WatchResult =
  | { shard: string; url: string; status: "unchanged" }
  | { shard: string; url: string; status: "changed"; fingerprint: string }
  | { shard: string; url: string; status: "unreachable"; reason: string };

/**
 * Chrome a site prints about itself, which changes when the rule does not.
 *
 * Every entry here must be a phrase that is *definitionally* not the rule, and
 * must say which site prints it and why it moves. The bar is high on purpose:
 * a pattern that is too generous hides the change this watch exists to catch,
 * and "strip anything that looks like a date" would hide an effective date,
 * which is part of a rule rather than furniture around it.
 *
 * eCFR is the standing case, and it took out the two highest-harm regulation
 * watches on the site at once. Every eCFR page carries "Displaying title 45, up
 * to date as of 8/28/2026. Title 45 was last amended 8/28/2026." — a statement
 * about the whole CFR *title*, which for titles 26 and 45 is amended more or
 * less continuously. So §155.420 and §1.401(a)(9)-9 both reported "this source
 * changed, a person must read it" on 2026-09-01 when neither had. eCFR's own
 * versioner API says §155.420 was last amended 2026-07-20 and §1.401(a)(9)-9
 * has no version at all in 2026, both before the fingerprints were taken. An
 * alert that fires when nothing happened is the one people learn to close
 * unread, and these two are the ACA special-enrollment window and the RMD
 * Uniform Lifetime Table.
 */
const SOURCE_CHROME: RegExp[] = [
  /Displaying title \d+, up to date as of \d{1,2}\/\d{1,2}\/\d{4}\.\s*Title \d+ was last amended \d{1,2}\/\d{1,2}\/\d{4}\./gi,
];

/**
 * Reduce an HTML page to the visible text a reader would see, so a fingerprint
 * tracks *content* rather than markup. Scripts, styles, and chrome are dropped;
 * whitespace is collapsed. A CMS template tweak should not read as a rule
 * change, and a rule change should not hide behind one.
 */
export function normalizeSourceText(html: string): string {
  let text = html
    .replace(/<(script|style|svg|nav|footer|header)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ");
  for (const pattern of SOURCE_CHROME) text = text.replace(pattern, " ");
  return text.replace(/\s+/g, " ").trim();
}

export function fingerprint(html: string): string {
  return createHash("sha256").update(normalizeSourceText(html)).digest("hex");
}

/**
 * Decide what the watch would report. `fetched` maps a URL to its page text, or
 * to an Error when the fetch failed — an unreachable source is reported rather
 * than treated as unchanged, because "we could not check" and "nothing moved"
 * are different facts.
 */
/**
 * Is this page an interstitial rather than the source?
 *
 * A fingerprint is only worth anything if it is a fingerprint of the *rule*. A
 * WAF block page, a cookie wall, or a JavaScript-required stub also has stable
 * text, so it fingerprints cleanly and reports "unchanged" forever — a watch
 * that is green precisely because it is watching nothing.
 *
 * That is not hypothetical. Until 2026-08-29 this watch sent a bot user agent,
 * and eCFR answered it with "Due to aggressive automated scraping of
 * FederalRegister.gov and eCFR.gov, programmatic access to these sites is
 * limited" — 1,180 characters where the real 45 CFR 155.420 is 36,762. The
 * committed fingerprint was a fingerprint of that refusal, so the ACA
 * special-enrollment window, one of the highest-harm figures on the site, had
 * never actually been watched.
 *
 * Two signals, both deliberately blunt. A statutory or agency source is never
 * this short, and the phrases below only appear on pages whose entire purpose is
 * to refuse. Either one means report `unreachable` — a watch must say it cannot
 * see a source, never quietly fingerprint the thing standing in front of it.
 */
export function looksLikeInterstitial(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length < MIN_SOURCE_TEXT) {
    return `page has only ${trimmed.length} characters of visible text; too short to be the source`;
  }
  const refusals = [
    /programmatic access to these sites/i,
    /request access/i,
    /access denied/i,
    /are you a (?:human|robot)/i,
    /enable javascript to (?:view|continue)/i,
    /checking your browser before/i,
  ];
  for (const pattern of refusals) {
    if (pattern.test(trimmed.slice(0, 2000))) {
      return `page looks like an access interstitial, not the source (matched ${String(pattern)})`;
    }
  }
  return null;
}

export function planWatch(file: WatchFile, fetched: Map<string, string | Error>): WatchResult[] {
  return file.entries.map((entry) => {
    const got = fetched.get(entry.url);
    if (got === undefined || got instanceof Error) {
      return {
        shard: entry.shard,
        url: entry.url,
        status: "unreachable" as const,
        reason: got instanceof Error ? got.message : "not fetched",
      };
    }
    // Never fingerprint an interstitial: it is stable, so it would report
    // "unchanged" forever while the rule underneath it moved freely.
    const interstitial = looksLikeInterstitial(got);
    if (interstitial !== null) {
      return {
        shard: entry.shard,
        url: entry.url,
        status: "unreachable" as const,
        reason: interstitial,
      };
    }
    const now = fingerprint(got);
    return now === entry.fingerprint
      ? { shard: entry.shard, url: entry.url, status: "unchanged" as const }
      : { shard: entry.shard, url: entry.url, status: "changed" as const, fingerprint: now };
  });
}

/** The human-readable report the workflow puts in its alert. */
export function renderWatchReport(results: WatchResult[], today: string): string {
  const changed = results.filter((r) => r.status === "changed");
  const unreachable = results.filter((r) => r.status === "unreachable");
  const lines: string[] = [`Source watch, ${today}.`, ""];

  if (changed.length === 0 && unreachable.length === 0) {
    lines.push("Every watched source is byte-identical to the text last reviewed.");
    return lines.join("\n");
  }
  if (changed.length > 0) {
    lines.push("**These sources changed and their shards need re-reading by a person:**", "");
    for (const r of changed) lines.push(`- \`${r.shard}\` — ${r.url}`);
    lines.push(
      "",
      "Nothing was edited. Read the source, update the shard by hand if the rule moved, and refresh the fingerprint with `node scripts/refresh/watch-sources.ts --accept`.",
      "",
    );
  }
  if (unreachable.length > 0) {
    lines.push("**These sources could not be checked:**", "");
    for (const r of unreachable) {
      lines.push(`- \`${r.shard}\` — ${r.url} (${(r as { reason: string }).reason})`);
    }
    lines.push("", "Unreachable is not the same as unchanged, so they are listed separately.");
  }
  return lines.join("\n");
}

/**
 * The identity of a watch entry: a shard AND a url, not a shard.
 *
 * One shard can be watched at more than one source, and the federal income tax
 * shard is watched at three — §164 for the SALT limitation, §163 for the car
 * loan deduction, §63 for the list of deductions a filer takes without
 * itemizing, which is also the list six states inherit. Keying the accept step
 * by shard alone wrote whichever result came last onto every entry for that
 * shard, so accepting a real change to one statute silently stamped its
 * fingerprint onto another statute nobody had read. The entry that lost then
 * reports "changed" against text that never moved, which is the failure mode
 * this watch exists to be trusted against.
 */
function entryKey(e: { shard: string; url: string }): string {
  return `${e.shard}\n${e.url}`;
}

/** Apply new fingerprints to the watch file (the `--accept` path). */
export function acceptChanges(file: WatchFile, results: WatchResult[], today: string): WatchFile {
  const byEntry = new Map(results.map((r) => [entryKey(r), r]));
  return {
    entries: file.entries.map((entry) => {
      const r = byEntry.get(entryKey(entry));
      return r?.status === "changed"
        ? { ...entry, fingerprint: r.fingerprint, checkedOn: today }
        : entry;
    }),
  };
}

export function readWatchFile(path = WATCH_FILE): WatchFile {
  return JSON.parse(readFileSync(path, "utf8")) as WatchFile;
}

/* c8 ignore start — the CLI shell: fetch and file writes only. */
async function main(): Promise<void> {
  const accept = process.argv.includes("--accept");
  const today = new Date().toISOString().slice(0, 10);
  const file = readWatchFile();

  const fetched = new Map<string, string | Error>();
  for (const entry of file.entries) {
    try {
      // The shared fetcher: a browser user agent (government WAFs refuse
      // anything else) and PDF text extraction, so a watch can point at the
      // bulletin or form where an agency actually publishes the figure.
      const res = await fetchSource(entry.url);
      if (!res.ok) throw new Error(res.reason);
      fetched.set(entry.url, res.raw);
    } catch (err) {
      fetched.set(entry.url, err as Error);
    }
  }

  const results = planWatch(file, fetched);
  const report = renderWatchReport(results, today);
  process.stdout.write(`${report}\n`);

  if (accept) {
    writeFileSync(WATCH_FILE, `${JSON.stringify(acceptChanges(file, results, today), null, 2)}\n`);
  }

  const out = process.env.GITHUB_OUTPUT;
  if (out) {
    const changed = results.filter((r) => r.status === "changed").length;
    const unreachable = results.filter((r) => r.status === "unreachable").length;
    appendFileSync(out, `changed=${changed}\nunreachable=${unreachable}\n`);
    appendFileSync(out, `report<<EOF\n${report}\nEOF\n`);
  }
}

if (process.argv[1] && process.argv[1].endsWith("watch-sources.ts")) {
  await main();
}
/* c8 ignore stop */
