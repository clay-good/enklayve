import { describe, it, expect } from "vitest";
import { edgeRefused, renderLiveReport } from "../../scripts/check-live";

/**
 * The reporting half of the live check, which is the half a test can hold.
 *
 * `checkOrigin` makes network calls and is deliberately not exercised here —
 * the unit suite reaches nothing, and a site mid-deploy is not a broken site.
 * What is worth pinning is that the report says something useful when it fails,
 * because the failure it reports is one nobody has been looking for: on
 * 2026-09-03 every check that reads this repository passed while production
 * served no Content-Security-Policy at all.
 *
 * A report that only said "headers missing" would send someone to `worker/`,
 * where the headers are correct and always have been. It names `wrangler.toml`
 * instead.
 */
describe("the live-check report", () => {
  it("says plainly when there is nothing to do", () => {
    const report = renderLiveReport("https://enklayve.com", []);
    expect(report).toContain("Nothing to do");
    expect(report).not.toContain("does not serve");
  });

  it("names the path and the problem, so a fix has somewhere to go", () => {
    const report = renderLiveReport("https://enklayve.com", [
      { path: "/", problem: "`content-security-policy` — got nothing at all" },
    ]);
    expect(report).toContain("https://enklayve.com does not serve");
    expect(report).toContain("`/`");
    expect(report).toContain("got nothing at all");
  });

  it("points at the config rather than at the header code, which is not the bug", () => {
    // The headers were right in `worker/index.ts` the entire time. What was
    // wrong was that nothing invoked it. A report that does not say so costs
    // the next person the same afternoon.
    const report = renderLiveReport("https://x.test", [{ path: "/", problem: "no CSP" }]);
    expect(report).toContain("wrangler.toml");
    expect(report).toContain("run_worker_first");
    expect(report).toContain("without invoking the Worker");
  });
});

/**
 * A status this check cannot interpret is a statement about the checker.
 *
 * The scheduled run on 2026-09-07 was answered 403 by the edge before the
 * Worker ever ran, and filed a bug saying production does not serve what this
 * repository promises, pointing at `wrangler.toml`. A browser, and this same
 * script from a laptop, got a clean 200 and the full header contract at the
 * same time. The check that exists because it is the only one that can see
 * production had cried wolf about production, which is the one way to make the
 * next red run go unread.
 */
describe("telling a refusal at the door from a broken site", () => {
  const cf = (extra: Record<string, string> = {}): Headers =>
    new Headers({ server: "cloudflare", "cf-ray": "9a0b1c2d3e4f5678-DFW", ...extra });

  it("reads Cloudflare's own word for it", () => {
    expect(edgeRefused(403, cf({ "cf-mitigated": "challenge" }), "")).toBe(true);
  });

  it("reads the interstitial when there is no header to read", () => {
    expect(edgeRefused(403, cf(), "<title>Attention Required! | Cloudflare</title>")).toBe(true);
    expect(edgeRefused(503, cf(), "<title>Just a moment...</title>")).toBe(true);
    expect(edgeRefused(429, cf(), "Sorry, you have been blocked")).toBe(true);
  });

  it("does not excuse a 403 the site itself sent", () => {
    // The whole value of this check is that it fails on a real refusal. An edge
    // in front of the site is not evidence on its own -- every response here
    // comes through one.
    expect(edgeRefused(403, cf(), "<h1>Forbidden</h1>")).toBe(false);
    expect(edgeRefused(403, new Headers(), "Attention Required")).toBe(false);
  });

  it("does not excuse a status that is not a refusal", () => {
    // A 500 or a 404 is the site answering, whoever is asking.
    expect(edgeRefused(500, cf({ "cf-mitigated": "challenge" }), "")).toBe(false);
    expect(edgeRefused(404, cf(), "Just a moment...")).toBe(false);
  });

  it("reports a refusal as one, and never sends the reader to wrangler.toml", () => {
    const report = renderLiveReport("https://enklayve.com", [
      {
        path: "/",
        problem: "answered 403 from the edge, before the site was reached",
        blocked: true,
      },
    ]);
    expect(report).toContain("refused this check before it reached the site");
    expect(report).toContain("Nothing was learned about production either way");
    expect(report).toContain("enklayve-check-live");
    expect(report).not.toContain("does not serve what this repository promises");
    expect(report).not.toContain("wrangler.toml");
  });

  it("still reports the site when one finding is about the site", () => {
    // A mixed report is a report about production. Only an all-blocked run is
    // a report about the checker.
    const report = renderLiveReport("https://enklayve.com", [
      { path: "/", problem: "answered 403 from the edge", blocked: true },
      { path: "/", problem: "`content-security-policy` — got nothing at all" },
    ]);
    expect(report).toContain("does not serve what this repository promises");
    expect(report).toContain("wrangler.toml");
  });
});
