/**
 * What production actually serves (SPEC §2, SPEC-3 §3).
 *
 * Every other check in this repository reads the repository. The release audit
 * string-matches the Worker for `connect-src 'none'`; `worker.test.ts` drives
 * its fetch handler and asserts every header; `workerRouting.test.ts` holds the
 * config that decides whether that handler runs at all. All of them passed on
 * 2026-09-03 while `https://enklayve.com/` was answering with no
 * Content-Security-Policy, no HSTS, no Referrer-Policy and no
 * X-Content-Type-Options, on every path, cache busted.
 *
 * The cause was a default in Workers Static Assets — a request matching a file
 * under `[assets] directory` is served without invoking the Worker — and the
 * point here is not that default. It is that a promise about what a *server*
 * sends can only be checked against the server. The launch checklist had the
 * item and it was a box somebody ticked; this makes it a command somebody runs.
 *
 * Out of the unit CI on purpose, for the reason `check:links` is: it needs the
 * network, and a site mid-deploy is not a broken site. It runs on a schedule and
 * on demand, and it is the thing to run after a deploy that changes headers,
 * caching, or routing.
 *
 * Usage: `npm run check:live [-- https://staging.example.com]`
 */
import { appendFileSync } from "node:fs";

const DEFAULT_ORIGIN = "https://enklayve.com";
const TIMEOUT_MS = 20_000;

/** One thing production must be true about, and what it was instead. */
interface Finding {
  path: string;
  problem: string;
}

async function head(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // A cache-busting query and a no-cache request, because an edge HIT from
    // before a deploy is exactly what would hide the failure this check exists
    // for. GET rather than HEAD: some edges answer HEAD from a different path.
    return await fetch(url, {
      headers: { "cache-control": "no-cache", pragma: "no-cache" },
      signal: controller.signal,
      redirect: "manual",
    });
  } finally {
    clearTimeout(timer);
  }
}

const bust = (origin: string, path: string): string =>
  `${origin}${path}${path.includes("?") ? "&" : "?"}live=${Date.now()}${Math.random().toString(36).slice(2)}`;

/**
 * The header contract, checked against the response rather than the source.
 * Each entry is the header, and a predicate on the value it must carry.
 */
const REQUIRED: [string, (v: string) => boolean, string][] = [
  [
    "content-security-policy",
    (v) => v.includes("connect-src 'none'") && v.includes("default-src 'self'"),
    "must carry `connect-src 'none'` and `default-src 'self'` — this is the privacy claim",
  ],
  ["strict-transport-security", (v) => /max-age=\d{7,}/.test(v), "must set a long HSTS max-age"],
  ["referrer-policy", (v) => v.includes("no-referrer"), "must be `no-referrer`"],
  ["x-content-type-options", (v) => v.includes("nosniff"), "must be `nosniff`"],
  ["permissions-policy", (v) => v.length > 0, "must be present"],
];

export async function checkOrigin(origin: string): Promise<Finding[]> {
  const findings: Finding[] = [];

  // 1. The header family, on a page.
  const home = await head(bust(origin, "/"));
  if (home.status !== 200) {
    findings.push({ path: "/", problem: `answered ${home.status}, so nothing below was checked` });
    return findings;
  }
  for (const [header, ok, why] of REQUIRED) {
    const value = home.headers.get(header) ?? "";
    if (!ok(value)) {
      findings.push({
        path: "/",
        problem: `\`${header}\` ${why} — got ${value === "" ? "nothing at all" : `\`${value}\``}`,
      });
    }
  }

  // 2. The page itself must not be cached hard, or a deploy never reaches anyone.
  const homeCache = home.headers.get("cache-control") ?? "";
  if (/max-age=[1-9]/.test(homeCache) && !homeCache.includes("must-revalidate")) {
    findings.push({ path: "/", problem: `\`cache-control: ${homeCache}\` pins the app shell` });
  }

  // 3. A hashed asset that does not exist must be a 404, not the shell wearing
  //    its URL — and must not be cached for a year while it is wrong.
  const ghost = await head(bust(origin, "/assets/index-doesnotexist0000.js"));
  const ghostType = ghost.headers.get("content-type") ?? "";
  if (ghost.status === 200 && ghostType.includes("text/html")) {
    findings.push({
      path: "/assets/index-doesnotexist0000.js",
      problem:
        "a missing chunk answered `200 text/html` — the single-page-app fallback under an asset " +
        "URL, which a browser parses as a module and reports as a syntax error",
    });
  }
  if (ghost.status === 200 && (ghost.headers.get("cache-control") ?? "").includes("immutable")) {
    findings.push({
      path: "/assets/index-doesnotexist0000.js",
      problem: "a missing chunk was served `immutable`, which would make one bad deploy permanent",
    });
  }

  return findings;
}

/** The report a person reads. */
export function renderLiveReport(origin: string, findings: Finding[]): string {
  if (findings.length === 0) {
    return `${origin} serves the header contract, and a missing chunk is a miss. Nothing to do.`;
  }
  return [
    `${origin} does not serve what this repository promises:`,
    "",
    ...findings.map((f) => `- \`${f.path}\` — ${f.problem}`),
    "",
    "Every check that reads the repository can pass while this fails; that is the",
    "whole reason this one exists. Start with `wrangler.toml`: with Workers Static",
    "Assets, a request matching a file under `[assets] directory` is answered",
    "without invoking the Worker unless `run_worker_first` says otherwise.",
  ].join("\n");
}

/* c8 ignore start — the CLI shell: argv, fetch, and output only. */
if (import.meta.url === `file://${process.argv[1]}`) {
  const origin = (process.argv[2] ?? DEFAULT_ORIGIN).replace(/\/$/, "");
  const findings = await checkOrigin(origin);
  const report = renderLiveReport(origin, findings);
  process.stdout.write(`${report}\n`);

  // The workflow gates on this rather than re-deriving anything from the log,
  // and the script writes it rather than the YAML wrapping the call — a
  // scheduled check runs exactly one script, so `contributing.md` can name the
  // command a contributor types. A test holds that.
  const out = process.env.GITHUB_OUTPUT;
  if (out) {
    appendFileSync(out, `findings=${findings.length}\n`);
    appendFileSync(out, `report<<EOF\n${report}\nEOF\n`);
  }
  if (findings.length > 0) process.exitCode = 1;
}
/* c8 ignore stop */
