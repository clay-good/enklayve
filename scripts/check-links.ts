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
import {
  BAD_CERTIFICATE,
  INCOMPLETE_CERT_CHAIN,
  LOCAL_RESOLVER_FAILURE,
  resolverFailureFor,
} from "./fetch-source.ts";
import { repairedCaBundle, requestWithChain } from "./chain-repair.ts";
import { ADAPTERS } from "./refresh/adapters.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// `scripts` is here for the refresh adapters: each one names the page it
// watches, and those URLs live nowhere else. Without this root, an adapter
// could point at a 404 for a year with nothing to notice — which is exactly
// what happened to California's, North Carolina's, Utah's and Ohio's.
const SEARCH_ROOTS = ["src", "data", "docs", "scripts"];
// The repository root is not a search root -- walking it would descend into
// node_modules and dist -- so its markdown was swept by nothing, and that is
// where the most-read links in the project live. The README alone carries the
// state-by-state sources: a Wisconsin form, a Rhode Island advisory, a Nebraska
// schedule. Same bug as `scripts/` a month ago, one directory further out.
// Named individually until 2026-09-02, which put the bug back one level: adding
// CODE_OF_CONDUCT.md to the root added five external links that this list did
// not name, so the sweep went on reporting the same 240 and the new file was
// checked by nothing. A list of files is a promise someone has to remember to
// keep. Every markdown file in the root is read instead — the root is still not
// walked, because walking it descends into node_modules and dist.
const rootMarkdown = (root: string): string[] =>
  readdirSync(root)
    .filter((name) => extname(name) === ".md")
    .sort();
const EXTENSIONS = new Set([".ts", ".json", ".md", ".css", ".html"]);

/**
 * A URL that is a fixture or our own site, not a source link the site ships.
 *
 * `.example` is in here as a TLD as well as a second-level label, because RFC
 * 2606 §2 reserves it exactly like `.invalid` and somebody writing
 * `https://staging.example` in a usage line is not shipping a citation. That
 * cost two false "broken" entries on 2026-09-03 — a check asking a person to go
 * fix a hostname that is reserved to never resolve.
 */
const NOT_SHIPPED = /(example\.(gov|com|org|invalid)|\.example(?![A-Za-z0-9-])|enklayve\.com)/;

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
  for (const f of rootMarkdown(root)) out.push(join(root, f));
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
    // A markdown link inside a badge closes one URL and opens another:
    // `[![CI](…/badge.svg)](…/ci.yml)`. `)` and `[` are both legal in a path
    // (the eCFR states a regulation as `…/section-1.401(a)(9)-9`), so the match
    // ran straight through `)](` into the second URL and checked neither. No
    // real URL contains `](`.
    const linked = m[0].split("](")[0]!;
    // Markdown emphasis rides along the same way a sentence's period does:
    // `**[Report a vulnerability](…/new)**` left a trailing `)**`.
    const url = linked.replace(/[.,;)*_\\"']+$/, "");
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
 * Statuses that refuse the *client* rather than deny the *document*.
 *
 * `sourceStatus` in `fetch-source.ts` has said this since it was written — "only
 * 404 and 410 are an absence; a 403 from a WAF, a 500, a rate limit, none of
 * those is a statement about the document" — and this check said the opposite
 * about the same servers, which is how a sibling check ends up sending someone
 * to replace a citation the other one is happily reading. NAIC's consumer life
 * insurance page answered 403 to this sweep on 2026-09-03 and rendered
 * perfectly in a browser the same minute: an agency turned on bot protection,
 * and nothing about the page changed.
 *
 * 401 and 429 join it for the same reason. A 404 or a 410 is the server
 * describing the document and stays broken, as does a 5xx: a page that is
 * erroring for everyone is a page the reader does not get either.
 */
const REFUSES_THE_CLIENT = new Set([401, 403, 429]);

/**
 * A TLS chain the server did not serve completely. The page is fine in a
 * browser, so calling it "broken" would send someone to replace a link that
 * works — it gets its own category instead. A refused connection or a timeout
 * after retries really is a broken link, and so, since 2026-08-30, is a
 * certificate that is expired, self-signed, or issued for another hostname: a
 * browser refuses those too, so a reader following the link gets an
 * interstitial rather than the page. They used to land here, under a sentence
 * promising the page was almost certainly fine.
 *
 * DNS left this sentence on 2026-09-02. "Every other transport failure (DNS,
 * refused, timeout)" was right about the common case and wrong about the one
 * that matters: `getaddrinfo` asks the operating system, and the operating
 * system can be wrong by itself. The sweep reported `www.oregonlegislature.gov`
 * broken while its A record answered on the first direct ask. A name that
 * resolves directly is now unreachable rather than broken; a name that resolves
 * nowhere is still a dead link.
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
  if (result.status === 0) {
    // A chain the server did not serve, or a name this machine's resolver could
    // not find while a direct DNS query answers for it. Both are the checker's
    // environment rather than the link, and reporting either as broken sends
    // somebody to replace a citation that works.
    if (CERT_ERROR.test(result.detail)) return "unreachable";
    if (LOCAL_RESOLVER_FAILURE.test(result.detail)) return "unreachable";
    return "broken";
  }
  if (result.status >= 200 && result.status < 300) return "ok";
  if (result.status >= 300 && result.status < 400) return "redirect";
  // A refusal aimed at this client is the checker's problem, not the link's.
  if (REFUSES_THE_CLIENT.has(result.status)) return "unreachable";
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
      "Not a broken link: something between this check and the page failed, so" +
        " the page itself is almost certainly fine — open it in a browser before" +
        " replacing it. Three causes reach this list, and each entry says which.",
      "",
      "- **An incomplete certificate chain.** The server did not serve its" +
        " intermediate. A browser and curl repair that by fetching the missing" +
        " certificate; Node does not, and where the repair here also fails, the" +
        " reader still sees the page.",
      "- **A name this machine could not look up**, while a direct DNS query" +
        " answers for it. `getaddrinfo` goes through the operating system, which" +
        " can be wrong on its own — a stale negative cache, a VPN's resolver, a" +
        " sandboxed runner. The link is fine; the machine that checked it was not.",
      "- **A server that refused this client** — a `401`, `403` or `429` from" +
        " bot protection. That is a statement about the request, not about the" +
        " document: a `404` or a `410` is the server saying the page is gone, and" +
        " those stay broken. This one needs a human with a browser, and the answer" +
        " is usually that the page is fine. Confirm it before touching the URL —" +
        " and if it really has been withdrawn, the fix is a new citation, not a" +
        " different user agent.",
      "",
    );
    for (const r of unreachable) {
      // A transport failure carries its reason in `detail`; a refusal's reason
      // *is* the status, and printing an empty dash beside a URL says nothing.
      const why = REFUSES_THE_CLIENT.has(r.status)
        ? `\`${r.status}\` — the server refused this client${r.detail ? ` (${r.detail})` : ""}`
        : r.detail;
      lines.push(`- ${r.url} — ${why}\n  - in ${r.files.join(", ")}`);
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
 * How long to wait before asking a second time about a status that says broken.
 * Long enough for a rate limiter's window or a cache's bad entry to have moved
 * on, short enough that it costs nothing on a healthy run — this delay is only
 * ever paid on a URL that is one answer away from being reported.
 */
const CONFIRM_DELAY_MS = 3_000;

/** One request, reduced to what this check reads: a status and a redirect target. */
export interface Attempt {
  status: number;
  location: string;
}

/** The single HTTP request, injectable so the retry policy is testable offline. */
export type Request = (url: string, method: "HEAD" | "GET") => Promise<Attempt>;

const fetchOnce: Request = async (url, method) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      redirect: "manual",
      headers: { "user-agent": USER_AGENT },
      signal: controller.signal,
    });
    return { status: res.status, location: res.headers.get("location") ?? "" };
  } finally {
    clearTimeout(timer);
  }
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
/* c8 ignore stop */

/**
 * Check one URL, retrying once on a transport failure and once on a status that
 * says the link is broken. A government site dropping a single connection is
 * common and means nothing; reporting it as a dead link is how a monitor earns
 * a reputation for crying wolf, and a monitor people ignore is worse than none.
 *
 * "An HTTP status is never retried — a 404 is an answer" is what this said
 * until 2026-09-02, and it is the same mistake as the resolver one two commits
 * earlier, arriving through the last door left open. A status is an answer from
 * the *server*, and a server can be wrong for a minute: on that day the sweep
 * reported Wisconsin's `2026-Form1-ES-Inst.pdf` as a hard 404 and the very same
 * URL answered 200 on the next ask, unchanged. Eight-way concurrency against
 * one agency is enough to meet a rate limiter, and several of them answer a
 * throttle with a 404 rather than a 429. The report that run produced asked a
 * person to go replace a citation that works, which is the one answer these
 * checks must never give.
 *
 * So a broken status is confirmed once, after a pause, before it is believed. A
 * healthy link pays nothing: the second ask happens only on the answer that was
 * about to become a line in the report.
 */
export async function check(
  url: string,
  files: string[],
  request: Request = fetchOnce,
  pause: (ms: number) => Promise<void> = sleep,
): Promise<LinkResult> {
  let last = "";
  /** A GET that answered badly, kept in case the confirming ask never lands. */
  let answered: LinkResult | undefined;
  // HEAD first: several cited sources are multi-megabyte PDFs, and downloading
  // them just to learn the status is what made this time out on a slow link.
  // Some servers reject HEAD, so a non-2xx HEAD is confirmed with a GET before
  // it is reported as a failure.
  for (const method of ["HEAD", "GET"] as const) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const res = await request(url, method);
        const result = { url, status: res.status, detail: res.location, files };
        // Anything that is not already an answer worth reporting gets asked
        // again. That includes a refusal: plenty of servers refuse a HEAD and
        // serve the GET, so escalating on a 403 is the difference between
        // "unreachable" and the 200 that was there all along.
        const verdict = classify(result);
        if (verdict === "ok" || verdict === "redirect") return result;
        // HEAD said no — a GET answers that better than a second HEAD would.
        if (method === "HEAD") break;
        if (attempt > 0) return result; // Said twice. It is the link.
        answered = result;
        await pause(CONFIRM_DELAY_MS);
      } catch (err) {
        last = String((err as Error).cause ?? err).slice(0, 140);
      }
    }
  }
  // The server answered, and then the confirming ask failed to arrive at all.
  // The status is the more useful of those two things to put in front of a
  // reader, and the transport diagnosis below is about a server that never
  // answered — which this one did.
  if (answered) return answered;
  // A chain the server did not serve completely is not a dead link — it is the
  // missing intermediate a browser fetches and Node does not. The refresh
  // pipeline repairs it, so this must too, or the two checks go back to
  // disagreeing about the same server: Mississippi's whole estate was reported
  // here as unverifiable while the adapters were reading its pages.
  if (CERT_ERROR.test(last)) {
    const repaired = await checkWithRepairedChain(url, files);
    if (repaired) return repaired;
  }
  // A name `getaddrinfo` refused is usually a dead host and occasionally a
  // broken resolver, and the two look identical from inside `fetch`. Ask DNS
  // directly before calling it a dead link: if the name has an address, the
  // machine running this is what could not find it.
  const resolver = await resolverFailureFor(url, last);
  if (resolver) return { url, status: 0, detail: resolver, files };
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
      // Same escalation rule as the plain path: only an answer worth reporting
      // stops the HEAD from being retried as a GET.
      const verdict = classify(result);
      if (method === "GET" || verdict === "ok" || verdict === "redirect") return result;
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
