import { describe, it, expect } from "vitest";
import { renderLiveReport } from "../../scripts/check-live";

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
