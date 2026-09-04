import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The Worker actually runs in production.
 *
 * Everything else in this repo checks the code that sets the security headers.
 * Nothing checked that the code is reachable, and on 2026-09-03 it was not:
 * `https://enklayve.com/` was answering with no Content-Security-Policy, no
 * HSTS, no Referrer-Policy and no X-Content-Type-Options, on every path tried
 * and with the cache busted.
 *
 * The cause is a default in Workers Static Assets. A request that matches a
 * file under `[assets] directory` is answered by the asset server *without
 * invoking the Worker*, so `worker/index.ts` — where every one of those headers
 * is set — never ran for `/`, `/index.html`, `/assets/*` or `/robots.txt`.
 * Which is to say: the entire privacy story, the one the README states as
 * "the browser physically cannot send your data out", was true of the code and
 * absent from the site. `run_worker_first` is what puts the Worker back in
 * front of the request.
 *
 * This test cannot reach production — the unit suite makes no network calls, on
 * purpose. What it can do is hold the configuration invariant that failed: if
 * the Worker is where the headers live, the config must say the Worker runs.
 * The live check belongs in the launch checklist, where it is now written down
 * with the date it was last actually performed.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const wrangler = readFileSync(resolve(ROOT, "wrangler.toml"), "utf8");
const worker = readFileSync(resolve(ROOT, "worker/index.ts"), "utf8");

/** Strip comments, so a rule described in prose cannot pass for a rule set. */
const live = wrangler
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("#"))
  .join("\n");

describe("the deployed Worker sits in front of the assets", () => {
  it("sets run_worker_first, without which no header this repo writes is served", () => {
    expect(live).toMatch(/^\s*run_worker_first\s*=\s*true\s*$/m);
  });

  it("still declares the assets binding the Worker serves through", () => {
    // `run_worker_first` only helps because the Worker proxies to ASSETS. If
    // the binding went away the Worker would run and have nothing to serve.
    expect(live).toMatch(/^\s*binding\s*=\s*"ASSETS"\s*$/m);
    expect(worker).toContain("env.ASSETS.fetch");
  });

  it("keeps the Worker as the entry point, not the asset directory", () => {
    expect(live).toMatch(/^\s*main\s*=\s*"worker\/index\.ts"\s*$/m);
  });

  it("names every header the Worker must attach, so a deletion is visible here", () => {
    // Not a substitute for the live check — a header set in code and never
    // served is exactly the bug this file exists for — but a list in one place
    // makes the checklist's live check something to compare against.
    for (const header of [
      "Content-Security-Policy",
      "Strict-Transport-Security",
      "Referrer-Policy",
      "X-Content-Type-Options",
      "Permissions-Policy",
    ]) {
      expect(worker, `${header} is no longer set by the Worker`).toContain(header);
    }
    expect(worker).toContain("connect-src 'none'");
  });
});
