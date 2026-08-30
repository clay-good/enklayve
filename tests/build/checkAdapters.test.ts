import { describe, it, expect } from "vitest";
import {
  classifyAnchor,
  renderAnchorReport,
  type AnchorResult,
} from "../../scripts/check-adapters";
import { ADAPTERS } from "../../scripts/refresh/adapters";
import { extractUrls, sourceFiles } from "../../scripts/check-links";
import { isPdf } from "../../scripts/fetch-source";
import { againstBaseline, willNotClearOnItsOwn } from "../../scripts/check-adapters";
import { describeFetchError } from "../../scripts/fetch-source";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The adapter-anchoring check.
 *
 * A refresh adapter is only doing its job while the page it points at still
 * *states* the figure it anchors. When an agency moves a number into a PDF or
 * behind client-side rendering, the adapter stops parsing — which opens a
 * fail-safe alert PR rather than shipping bad data, correctly — but the shard
 * then quietly stops being watched and sits at whatever year it was authored
 * in, still carrying a live and apparently valid .gov citation.
 *
 * That is not hypothetical: the 2026-08-29 source audit found Illinois,
 * Michigan, Missouri and Georgia a year or two stale for exactly this reason.
 * These tests cover the pure classification and reporting; the fetch itself
 * runs on a schedule, never here.
 */
const ROOT = resolve(__dirname, "..", "..");

function result(over: Partial<AnchorResult>): AnchorResult {
  return {
    adapterId: "state-xx-income-tax-2024",
    group: "state-xx",
    url: "https://example.test/rates",
    status: "agrees",
    ...over,
  };
}

describe("classifying one adapter's outcome", () => {
  it("separates a page that never arrived from one the parser could not read", () => {
    // Unreachable is the agency's problem and may be transient; unparsed is
    // ours and means a shard has stopped being watched. Conflating them would
    // bury the actionable case under the noisy one.
    expect(
      classifyAnchor({ ok: false, reason: "HTTP 503" }, () => ({ ok: true, diff: [] })),
    ).toEqual({ status: "unreachable", detail: "HTTP 503" });
    expect(
      classifyAnchor({ ok: true, raw: "<html>nothing useful</html>" }, () => ({
        ok: false,
        reason: "could not anchor the flat income-tax rate",
      })),
    ).toEqual({ status: "unparsed", detail: "could not anchor the flat income-tax rate" });
  });

  it("counts a source that answered and declined to serve as unreachable", () => {
    // The BLS CPI API replies 200 with valid JSON and no series when its daily
    // quota is spent — a CI runner shares its IP with everyone on that runner.
    // Filed as unparsed it reads "the API changed shape", which sends someone to
    // rewrite a parser that is fine. Nothing here is broken, so nothing fails.
    expect(
      classifyAnchor({ ok: true, raw: '{"status":"REQUEST_NOT_PROCESSED"}' }, () => ({
        ok: false,
        denied: true,
        reason: "BLS declined the request (REQUEST_NOT_PROCESSED): daily threshold reached",
      })),
    ).toEqual({
      status: "unreachable",
      detail: "BLS declined the request (REQUEST_NOT_PROCESSED): daily threshold reached",
    });
  });

  it("files a refusal that is a decision apart from one that is a defect", () => {
    // Delaware's deduction is statutory and has not moved since 2000; six
    // states have not published the shard's year; Connecticut has no standard
    // deduction at all. Every one of those used to print the same sentence a
    // genuinely broken parser prints, and a reader who opens a report and finds
    // six entries needing nothing does not open the seventh.
    expect(
      classifyAnchor({ ok: true, raw: "a menu" }, () => ({
        ok: false,
        settled: true,
        reason: "Delaware's standard deduction does not index",
      })),
    ).toEqual({ status: "settled", detail: "Delaware's standard deduction does not index" });

    // Without the flag it is still the thing that wants fixing.
    expect(
      classifyAnchor({ ok: true, raw: "a menu" }, () => ({
        ok: false,
        reason: "could not anchor any standard-deduction figure by filing status",
      })).status,
    ).toBe("unparsed");
  });

  it("does not run the parser at all when the fetch failed", () => {
    let ran = false;
    classifyAnchor({ ok: false, reason: "timeout" }, () => {
      ran = true;
      return { ok: true, diff: [] };
    });
    expect(ran).toBe(false);
  });

  it("separates an adapter that agrees with its shard from one that would change it", () => {
    // Agreeing is the healthy steady state. Would-change is not a failure — a
    // real refresh proposes changes — but it is the only line worth reading,
    // because a change is either a state updating its figures or a parser
    // reading the wrong number, and only the diff tells them apart.
    expect(
      classifyAnchor({ ok: true, raw: "rate is 4.95%" }, () => ({ ok: true, diff: [] })),
    ).toEqual({ status: "agrees" });
    expect(
      classifyAnchor({ ok: true, raw: "x" }, () => ({
        ok: true,
        diff: ["standardDeductionByFilingStatus.single: 5706 -> 2019"],
      })),
    ).toEqual({
      status: "wouldChange",
      diff: ["standardDeductionByFilingStatus.single: 5706 -> 2019"],
    });
  });
});

describe("a source that will not come back", () => {
  it("reads the reason out of the cause chain Node hides it in", () => {
    // Node reports every transport failure as the same four words and puts the
    // reason in `cause`. Unwrapped, Mississippi's adapter reported "fetch
    // failed: fetch failed" every month — a sentence naming neither the problem
    // nor anybody who could fix it — while the link check on the same server
    // said "unable to verify the first certificate".
    const cause = Object.assign(new Error("unable to verify the first certificate"), {
      code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    });
    const wrapped = new TypeError("fetch failed", { cause });
    expect(describeFetchError(wrapped)).toBe(
      "unable to verify the first certificate [UNABLE_TO_VERIFY_LEAF_SIGNATURE]",
    );
  });

  it("keeps the wrapper when the wrapper is all there is", () => {
    expect(describeFetchError(new TypeError("fetch failed"))).toBe("fetch failed");
    expect(describeFetchError(new Error("The operation was aborted"))).toBe(
      "The operation was aborted",
    );
  });

  it("does not loop on a cause chain that points back at itself", () => {
    const a = new Error("outer");
    const b = new Error("inner", { cause: a });
    (a as { cause?: unknown }).cause = b;
    expect(describeFetchError(a)).toBe("outer: inner");
  });

  it("tells a bad afternoon apart from a wall", () => {
    // A quota and a 503 clear by themselves; an incomplete certificate chain
    // fails identically every run, so the shard behind it has stopped being
    // watched for good while the report says to wait it out.
    expect(
      willNotClearOnItsOwn(
        "fetch failed: unable to verify the first certificate [UNABLE_TO_VERIFY_LEAF_SIGNATURE]",
      ),
    ).toBe(true);
    expect(willNotClearOnItsOwn("source returned HTTP 503")).toBe(false);
    expect(willNotClearOnItsOwn("BLS declined the request (REQUEST_NOT_PROCESSED)")).toBe(false);
    expect(willNotClearOnItsOwn(undefined)).toBe(false);
  });

  it("reports the permanent one apart from the transient one, and gates on neither", () => {
    const report = renderAnchorReport([
      result({
        adapterId: "state-ms-income-tax-2024",
        status: "unreachable",
        detail: "fetch failed: unable to verify the first certificate",
      }),
      result({ adapterId: "cpi-u-annual", status: "unreachable", detail: "daily threshold" }),
    ]);
    expect(report).toContain("2 unreachable (1 of them permanently)");
    expect(report).toMatch(/## Unreachable, and not by accident/);
    expect(report).toMatch(/## Unreachable\n/);
    // Each entry appears under exactly one heading.
    const walled = report.indexOf("## Unreachable, and not by accident");
    const afternoon = report.indexOf("## Unreachable\n");
    expect(walled).toBeLessThan(afternoon);
    expect(report.slice(walled, afternoon)).toContain("state-ms-income-tax-2024");
    expect(report.slice(walled, afternoon)).not.toContain("cpi-u-annual");
    expect(report.slice(afternoon)).toContain("cpi-u-annual");
    // It fails every run by definition, so it must not fail the check: an alarm
    // that always fires is not an alarm.
    expect(againstBaseline([], []).regressions).toEqual([]);
  });

  it("says nothing at all when every source came back", () => {
    const report = renderAnchorReport([result({ status: "agrees" })]);
    expect(report).not.toContain("## Unreachable");
    expect(report).toContain("0 unreachable.");
  });
});

describe("the report", () => {
  it("counts every status and names each adapter that cannot anchor", () => {
    const report = renderAnchorReport([
      result({ adapterId: "a", status: "agrees" }),
      result({ adapterId: "b", status: "unparsed", detail: "could not anchor the rate" }),
      result({ adapterId: "c", status: "unreachable", detail: "HTTP 404" }),
    ]);
    expect(report).toMatch(/Checked 3 refresh adapters/);
    // The report must never let a green line read as a data guarantee. Pointing
    // Maine's deduction adapter at a form that does state the deduction made it
    // "anchor" a bracket threshold and the personal exemption instead.
    expect(report).toMatch(/never that the value is right/);
    expect(report).toMatch(/1 agree with their shard · 0 would change it · 1 could not parse/);
    expect(report).toContain("0 settled");
    expect(report).toMatch(/## Could not anchor/);
    expect(report).toMatch(/could not anchor the rate/);
    expect(report).toMatch(/## Unreachable/);
    expect(report).toMatch(/HTTP 404/);
  });

  it("omits a section entirely when nothing is in it", () => {
    // An all-green report should be its summary lines, not a set of empty
    // headings inviting a reader to scan for problems that are not there.
    const report = renderAnchorReport(
      [result({ adapterId: "a" }), result({ adapterId: "b" })],
      ["a", "b"],
    );
    expect(report).not.toMatch(/## /);
    expect(report).toMatch(/2 agree with their shard · 0 would change it/);
  });
});

describe("what the check can be run against", () => {
  it("every adapter names a shard that exists, so the check can never skip one", () => {
    // The check reads each adapter's committed shard to parse onto. An adapter
    // whose id does not match a file would throw mid-run and take the whole
    // report with it.
    for (const adapter of ADAPTERS) {
      const path = resolve(ROOT, "data", `${adapter.id}.json`);
      expect(existsSync(path), `${adapter.id} has no shard`).toBe(true);
      expect(() => JSON.parse(readFileSync(path, "utf8"))).not.toThrow();
    }
  });

  it("every adapter's source URL is one the link check also sweeps", () => {
    // An adapter names the page it watches, and for most of them that URL lives
    // only in scripts/refresh/adapters.ts. If the link check does not sweep that
    // file, an adapter can point at a 404 for a year with nothing to notice —
    // which is what had happened to California's, North Carolina's, Utah's and
    // Ohio's. This is the invariant that keeps the two checks joined up.
    const seen = new Set<string>();
    for (const file of sourceFiles()) {
      for (const url of extractUrls(readFileSync(file, "utf8"))) seen.add(url);
    }
    const invisible = ADAPTERS.filter((a) => !seen.has(a.sourceUrl)).map((a) => a.id);
    expect(invisible).toEqual([]);
  });
});

describe("reading a source that is a PDF", () => {
  it("recognises a PDF by content type or by path, and markup as neither", () => {
    // Agencies keep moving figures off HTML pages and into a form or bulletin.
    // While the pipeline could only read markup, every one of those shards was
    // unwatched — which is how four of them went a year or two stale behind
    // live, correct-looking citations.
    expect(isPdf("https://x.test/a", "application/pdf")).toBe(true);
    expect(isPdf("https://x.test/a", "application/pdf; charset=binary")).toBe(true);
    // Some servers send octet-stream for a .pdf path, so the path decides too.
    expect(isPdf("https://x.test/facts-2026.pdf", "application/octet-stream")).toBe(true);
    expect(isPdf("https://x.test/facts-2026.PDF?v=2", null)).toBe(true);
    expect(isPdf("https://x.test/rates.html", "text/html")).toBe(false);
    // A path that merely mentions pdf is not one.
    expect(isPdf("https://x.test/pdf-guide", "text/html")).toBe(false);
  });
});

describe("the would-change section", () => {
  it("prints every diff line, because the diff is the only thing that decides", () => {
    const report = renderAnchorReport([
      result({
        adapterId: "state-ca-income-tax-2024",
        status: "wouldChange",
        diff: [
          "standardDeductionByFilingStatus.single: 5706 -> 2019",
          "standardDeductionByFilingStatus.head_of_household: 11412 -> 2019",
        ],
      }),
    ]);
    expect(report).toMatch(/## Would change its shard/);
    expect(report).toMatch(/5706 -> 2019/);
    expect(report).toMatch(/11412 -> 2019/);
    // A would-change is not stated as a failure: a real refresh proposes changes.
    expect(report).toMatch(/either a state that updated its figures/);
  });

  it("lists the settled refusals in their own section, away from the ones to fix", () => {
    const report = renderAnchorReport([
      result({
        adapterId: "state-de-income-tax-2024",
        status: "settled",
        detail: "Delaware's standard deduction does not index",
      }),
      result({
        adapterId: "state-mo-income-tax-2024",
        status: "unparsed",
        detail: "no graduated schedule matched the committed bracket structure",
      }),
    ]);
    const settledAt = report.indexOf("## Settled");
    const unparsedAt = report.indexOf("## Could not anchor");
    expect(settledAt).toBeGreaterThan(-1);
    expect(unparsedAt).toBeGreaterThan(settledAt);
    expect(report).toContain("1 could not parse · 1 settled");
    // Each section carries only its own adapters.
    expect(report.slice(settledAt, unparsedAt)).toContain("state-de-income-tax-2024");
    expect(report.slice(settledAt, unparsedAt)).not.toContain("state-mo-income-tax-2024");
  });
});

describe("the known-anchoring baseline", () => {
  it("fails only when an adapter that was watching its shard stops", () => {
    // Forty-odd adapters cannot anchor today. Reporting all of them monthly
    // would be an alert nobody reads by the third time — the failure the
    // shell-size gate exists to escape. So the baseline holds the SHORT healthy
    // list and only a fall out of it fails.
    const baseline = ["fica-2024", "state-pa-income-tax-2024"];
    expect(
      againstBaseline(["fica-2024", "state-pa-income-tax-2024"], baseline).regressions,
    ).toEqual([]);
    expect(againstBaseline(["fica-2024"], baseline).regressions).toEqual([
      "state-pa-income-tax-2024",
    ]);
  });

  it("notices an adapter anchoring that the baseline does not list yet", () => {
    // Not a failure — anchoring is not correctness, so it wants a dry run first
    // — but it is how the healthy list grows, so it has to be said.
    const { recovered, regressions } = againstBaseline(
      ["fica-2024", "state-in-income-tax-2024"],
      ["fica-2024"],
    );
    expect(recovered).toEqual(["state-in-income-tax-2024"]);
    expect(regressions).toEqual([]);
  });

  it("every id in the committed baseline is a real adapter", () => {
    // A typo here would silently exempt an adapter from the gate forever.
    const file = JSON.parse(
      readFileSync(resolve(ROOT, "scripts", "refresh", "adapter-baseline.json"), "utf8"),
    ) as { knownAnchoring: string[] };
    const ids = new Set(ADAPTERS.map((a) => a.id));
    expect(file.knownAnchoring.filter((id) => !ids.has(id))).toEqual([]);
    expect(file.knownAnchoring.length).toBeGreaterThan(0);
  });
});
