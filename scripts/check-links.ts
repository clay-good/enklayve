/**
 * The external-link check (SPEC §2 principle 5, SPEC-3 §3).
 *
 * The whole trust model of this site is that every rule links its source. A
 * link that has rotted quietly breaks that, and the worst case is not a 404 —
 * it is a **redirect to the wrong page**. Agencies reuse article ids: at the
 * time this was written, the CFPB's "what does it mean to refinance my
 * mortgage" URL redirected to an article about USDA rural housing loans, and
 * "what is a balance transfer" redirected to one about mortgage payment
 * calculations. A reader following either lands on something plausible,
 * authoritative, and unrelated, and has no way to know.
 *
 * So this reports redirects as loudly as failures. A permanent redirect is not
 * a pass: it means the canonical URL moved, and the repo should carry the
 * destination, which is also the only way to notice when the destination is not
 * what the link promised.
 *
 * It runs on a schedule and on demand, never in the unit suite — it needs the
 * network, and a test that fails when a government site has a bad afternoon
 * teaches people to ignore failing tests.
 */
import { readFileSync, readdirSync, statSync, appendFileSync } from "node:fs";
import { resolve, dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { BROWSER_USER_AGENT } from "./user-agent.ts";
import { BAD_CERTIFICATE, INCOMPLETE_CERT_CHAIN } from "./fetch-source.ts";
import { repairedCaBundle, requestWithChain } from "./chain-repair.ts";
import { ADAPTERS } from "./refresh/adapters.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// `scripts` is here for the refresh adapters: each one names the page it
// watches, and those URLs live nowhere else. Without this root, an adapter
// could point at a 404 for a year with nothing to notice — which is exactly
// what happened to California's, North Carolina's, Utah's and Ohio's.
const SEARCH_ROOTS = ["src", "data", "docs", "scripts"];
const EXTENSIONS = new Set([".ts", ".json", ".md", ".css", ".html"]);

/** A URL that is a fixture or our own site, not a source link the site ships. */
const NOT_SHIPPED = /(example\.(gov|com|org|invalid)|enklayve\.com)/;

// Parentheses are in the character class because federal citations put them in
// the path: the eCFR states a Treasury regulation as `.../section-1.401(a)(9)-9`.
// Without them the pattern stopped at the `(`, and the truncated `.../section-1.401`
// was checked instead — reported as a broken link every month, sending a reader
// to repair a URL that works, while the URL actually shipped was never checked at
// all. The trailing-punctuation trim below is what keeps a URL wrapped in
// brackets, in prose or in markdown, from swallowing the closing one.
const URL_PATTERN = /https:\/\/[A-Za-z0-9._~:/?#[\]@!$&*+;=%()-]+/g;

/** Every `.ts`/`.json`/`.md`/`.css`/`.html` file under the search roots. */
export function sourceFiles(root = ROOT, roots: string[] = SEARCH_ROOTS): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (EXTENSIONS.has(extname(name))) out.push(p);
    }
  };
  for (const r of roots) walk(join(root, r));
  return out;
}

/**
 * Pull every shipped external URL out of a file's text. Trailing punctuation is
 * trimmed because a URL at the end of a sentence in a `sourceNote` picks up the
 * period; template literals and fixture hosts are dropped because they are not
 * links anyone can follow.
 */
export function extractUrls(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(URL_PATTERN)) {
    // A template literal — `.../about-form-1099-${variant}` — matches up to the
    // `$` and would be checked as a truncated URL that 404s forever. The `{`
    // that follows is what identifies it, since `$` itself is legal in a URL.
    if (text[(m.index ?? 0) + m[0].length] === "{") continue;
    const url = m[0].replace(/[.,;)\\"']+$/, "");
    if (NOT_SHIPPED.test(url)) continue;
    out.push(url);
  }
  return out;
}

/**
 * URLs an adapter has declared do not exist yet.
 *
 * Four adapters are parked on a document a state has not published, and one of
 * them — Oregon's OR-40 booklet — names the year-carrying URL it is waiting for.
 * That URL 404ing is not a broken link; it is the entire signal, and the adapter
 * check is what watches it. Reported here it would be a permanent red on a
 * monthly check, which is how a check stops being read.
 *
 * Derived from the adapters rather than listed, so it cannot drift: an awaited
 * URL that starts answering leaves this set at the same moment the adapter check
 * says the wait is over.
 */
export function awaitedUrls(
  adapters: readonly { awaiting?: { arrived: { url: string } } }[],
): Set<string> {
  return new Set(adapters.flatMap((a) => (a.awaiting ? [a.awaiting.arrived.url] : [])));
}

export interface LinkResult {
  url: string;
  /** The HTTP status, or 0 when the request never got an answer. */
  status: number;
  /** Where a redirect points, or the failure reason. */
  detail: string;
  /** Which files ship this URL, so a fix has somewhere to go. */
  files: string[];
}

export type LinkStatus = "ok" | "redirect" | "broken" | "unreachable";

/**
 * A TLS chain the server did not serve completely. The page is fine in a
 * browser, so calling it "broken" would send someone to replace a link that
 * works — it gets its own category instead. Every other transport failure (DNS,
 * refused, timeout after retries) really is a broken link, and so, since
 * 2026-08-30, is a certificate that is expired, self-signed, or issued for
 * another hostname: a browser refuses those too, so a reader following the link
 * gets an interstitial rather than the page. They used to land here, under a
 * sentence promising the page was almost certainly fine.
 *
 * The pattern itself lives beside the shared fetch, because the adapter check
 * needs the same fact about the same servers and the two used to disagree: this
 * one told a reader Mississippi's certificate chain was short, while the adapter
 * check called the identical failure a bad afternoon and waited for it to pass.
 */
const CERT_ERROR = INCOMPLETE_CERT_CHAIN;

/**
 * Classify one checked URL. Pure, so the reporting is testable without a
 * network.
 */
export function classify(result: Pick<LinkResult, "status" | "detail">): LinkStatus {
  if (result.status === 0) return CERT_ERROR.test(result.detail) ? "unreachable" : "broken";
  if (result.status >= 200 && result.status < 300) return "ok";
  if (result.status >= 300 && result.status < 400) return "redirect";
  return "broken";
}

/** The report a person reads. Broken first, then redirects, each naming its files. */
export function renderLinkReport(results: LinkResult[]): string {
  const broken = results.filter((r) => classify(r) === "broken");
  const redirects = results.filter((r) => classify(r) === "redirect");
  const unreachable = results.filter((r) => classify(r) === "unreachable");
  const ok = results.length - broken.length - redirects.length - unreachable.length;
  const lines: string[] = [
    `Checked ${results.length} external links.`,
    `${ok} ok · ${redirects.length} redirected · ${broken.length} broken · ${unreachable.length} unreachable.`,
    "",
  ];

  if (broken.length > 0) {
    lines.push("## Broken", "");
    if (broken.some((r) => BAD_CERTIFICATE.test(r.detail))) {
      lines.push(
        "One or more of these is a **certificate a browser refuses too** — expired, issued for" +
          " another hostname, or signed by nothing anyone trusts. That is not the missing" +
          ' intermediate under "Unreachable" below: a reader following this link gets a' +
          " full-page security warning and never sees the page. Replacing the URL may not be the" +
          " fix; a lapsed certificate is the agency's to renew, and a hostname mismatch usually" +
          " means the link points at the wrong host.",
        "",
      );
    }
    for (const r of broken) {
      lines.push(`- \`${r.status}\` ${r.url}${r.detail ? ` — ${r.detail}` : ""}`);
      lines.push(`  - in ${r.files.join(", ")}`);
    }
    lines.push("");
  }
  if (redirects.length > 0) {
    lines.push(
      "## Redirected",
      "",
      "A redirect is not a pass. The canonical URL moved, and an agency that reuses" +
        " article ids can point an old link at an unrelated page — check that each" +
        " destination is still what the link promised before updating it.",
      "",
    );
    for (const r of redirects) {
      lines.push(`- \`${r.status}\` ${r.url}\n  - → ${r.detail}\n  - in ${r.files.join(", ")}`);
    }
    lines.push("");
  }
  if (unreachable.length > 0) {
    lines.push(
      "## Unreachable",
      "",
      "The server did not serve a complete certificate chain. A browser and curl" +
        " repair that by fetching the missing intermediate; Node does not. The page" +
        " itself is almost certainly fine — open it in a browser before replacing it.",
      "",
    );
    for (const r of unreachable) {
      lines.push(`- ${r.url} — ${r.detail}\n  - in ${r.files.join(", ")}`);
    }
    lines.push("");
  }
  if (broken.length === 0 && redirects.length === 0 && unreachable.length === 0) {
    lines.push("Every link resolves directly. Nothing to do.");
  }
  return lines.join("\n");
}

/* c8 ignore start — the CLI shell: file reads, fetch, and output only. */
const USER_AGENT = BROWSER_USER_AGENT;
const CONCURRENCY = 8;
const TIMEOUT_MS = 30_000;

/**
 * Check one URL, retrying once on a transport failure. A government site
 * dropping a single connection is common and means nothing; reporting it as a
 * dead link is how a monitor earns a reputation for crying wolf, and a monitor
 * people ignore is worse than none. An HTTP status is never retried — a 404 is
 * an answer.
 */
async function check(url: string, files: string[]): Promise<LinkResult> {
  let last = "";
  // HEAD first: several cited sources are multi-megabyte PDFs, and downloading
  // them just to learn the status is what made this time out on a slow link.
  // Some servers reject HEAD, so a non-2xx HEAD is confirmed with a GET before
  // it is reported as a failure.
  for (const method of ["HEAD", "GET"] as const) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          method,
          redirect: "manual",
          headers: { "user-agent": USER_AGENT },
          signal: controller.signal,
        });
        const result = {
          url,
          status: res.status,
          detail: res.headers.get("location") ?? "",
          files,
        };
        if (method === "GET" || classify(result) !== "broken") return result;
        break; // HEAD said broken — confirm with a GET before believing it.
      } catch (err) {
        last = String((err as Error).cause ?? err).slice(0, 140);
      } finally {
        clearTimeout(timer);
      }
    }
  }
  // A chain the server did not serve completely is not a dead link — it is the
  // missing intermediate a browser fetches and Node does not. The refresh
  // pipeline repairs it, so this must too, or the two checks go back to
  // disagreeing about the same server: Mississippi's whole estate was reported
  // here as unverifiable while the adapters were reading its pages.
  if (CERT_ERROR.test(last)) {
    const repaired = await checkWithRepairedChain(url, files);
    if (repaired) return repaired;
  }
  return { url, status: 0, detail: `${last} (after retries)`, files };
}

/** The same HEAD-then-GET, once the missing intermediate has been fetched. */
async function checkWithRepairedChain(
  url: string,
  files: string[],
): Promise<LinkResult | undefined> {
  const ca = await repairedCaBundle(new URL(url).hostname);
  if (!ca) return undefined;
  for (const method of ["HEAD", "GET"] as const) {
    try {
      const res = await requestWithChain(url, {
        method,
        headers: { "user-agent": USER_AGENT },
        ca,
        timeoutMs: TIMEOUT_MS,
      });
      const location = res.headers["location"];
      const result = {
        url,
        status: res.status,
        detail: (Array.isArray(location) ? location[0] : location) ?? "",
        files,
      };
      if (method === "GET" || classify(result) !== "broken") return result;
    } catch {
      // Fall through to the GET, then to the caller's original diagnosis.
    }
  }
  return undefined;
}

async function main(): Promise<void> {
  const byUrl = new Map<string, Set<string>>();
  const awaited = awaitedUrls(ADAPTERS);
  for (const file of sourceFiles()) {
    const rel = file.slice(ROOT.length + 1);
    for (const url of extractUrls(readFileSync(file, "utf8"))) {
      if (awaited.has(url)) continue;
      if (!byUrl.has(url)) byUrl.set(url, new Set());
      byUrl.get(url)!.add(rel);
    }
  }

  const urls = [...byUrl.keys()].sort();
  const results: LinkResult[] = [];
  let next = 0;

  async function worker(): Promise<void> {
    while (next < urls.length) {
      const url = urls[next++]!;
      const files = [...byUrl.get(url)!].sort();
      results.push(await check(url, files));
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  results.sort((a, b) => a.url.localeCompare(b.url));

  const report = renderLinkReport(results);
  process.stdout.write(`${report}\n`);

  const out = process.env.GITHUB_OUTPUT;
  if (out) {
    const broken = results.filter((r) => classify(r) === "broken").length;
    const redirects = results.filter((r) => classify(r) === "redirect").length;
    const unreachable = results.filter((r) => classify(r) === "unreachable").length;
    appendFileSync(out, `broken=${broken}\nredirects=${redirects}\nunreachable=${unreachable}\n`);
    appendFileSync(out, `report<<EOF\n${report}\nEOF\n`);
  }
  if (results.some((r) => classify(r) === "broken")) process.exitCode = 1;
}

if (process.argv[1] && process.argv[1].endsWith("check-links.ts")) {
  await main();
}
/* c8 ignore stop */
