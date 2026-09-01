import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  looksLikeInterstitial,
  acceptChanges,
  fingerprint,
  normalizeSourceText,
  planWatch,
  readWatchFile,
  renderWatchReport,
  type WatchFile,
} from "../../scripts/refresh/watch-sources";

import { ManifestSchema } from "../../src/data/schemas";

/** A fetch result set, typed so a map mixing pages and errors is inferable. */
function fetched(...pairs: [string, string | Error][]): Map<string, string | Error> {
  return new Map<string, string | Error>(pairs);
}

/**
 * The Pillar 4 source watch (SPEC-4 §10.7).
 *
 * These six shards are prose transcribed from statutes and government consumer
 * pages, so they get a *review* workflow rather than a parse-and-rewrite one: a
 * scheduled job that notices when the source moved and asks a person to read
 * it. The tests pin the two properties that make that trustworthy — a template
 * tweak must not read as a rule change, and "we could not check" must never be
 * reported as "nothing moved".
 */
const ROOT = resolve(__dirname, "..", "..");
const watch = readWatchFile(resolve(ROOT, "scripts", "refresh", "source-watch.json"));

/**
 * A fixture page, padded to a realistic length.
 *
 * The watch refuses to fingerprint anything too short to be a statutory source,
 * because a WAF block page fingerprints just as cleanly as a regulation and then
 * reports "unchanged" forever. A one-sentence fixture would trip that guard, so
 * fixtures look like what they stand for: a real page of rule text.
 */
function page(body: string): string {
  return `<p>${body}</p>` + "<p>Further provisions of this section apply.</p>".repeat(60);
}

const FIXTURE: WatchFile = {
  entries: [
    {
      shard: "no-surprises-2026",
      url: "https://example.gov/a",
      why: "prose, not a table",
      fingerprint: fingerprint(page("Emergency room visits are protected.")),
      checkedOn: "2026-08-29",
    },
    {
      shard: "garnishment-limits-2026",
      url: "https://example.gov/b",
      why: "statutory text",
      fingerprint: fingerprint(page("25 per centum of disposable earnings.")),
      checkedOn: "2026-08-29",
    },
  ],
};

describe("normalizing a source page", () => {
  it("reduces a page to the text a reader would see", () => {
    const html =
      "<html><head><style>p{color:red}</style></head><body><nav>Home About</nav>" +
      "<p>Emergency&nbsp;room visits are protected.</p><!-- build 4471 -->" +
      "<script>track()</script><footer>Contact us</footer></body></html>";
    const text = normalizeSourceText(html);
    expect(text).toBe("Emergency room visits are protected.");
    expect(text).not.toContain("track");
    expect(text).not.toContain("Contact us");
  });

  it("ignores markup churn, so a template tweak is not a rule change", () => {
    const before = "<div class='a'><p>The limit is 25 per centum.</p></div>";
    const after = '<section id="x" data-v="9"><p>  The limit is 25 per centum.  </p></section>';
    expect(fingerprint(before)).toBe(fingerprint(after));
  });

  it("does not ignore a change to the words themselves", () => {
    expect(fingerprint("<p>25 per centum</p>")).not.toBe(fingerprint("<p>30 per centum</p>"));
  });
});

describe("planning a watch run", () => {
  it("reports unchanged when the source is the text last reviewed", () => {
    const results = planWatch(
      FIXTURE,
      fetched(
        ["https://example.gov/a", page("Emergency room visits are protected.")],
        ["https://example.gov/b", page("25 per centum of disposable earnings.")],
      ),
    );
    expect(results.every((r) => r.status === "unchanged")).toBe(true);
  });

  it("reports the shard by name when its source moved", () => {
    const results = planWatch(
      FIXTURE,
      fetched(
        ["https://example.gov/a", page("Emergency room visits are protected, mostly.")],
        ["https://example.gov/b", page("25 per centum of disposable earnings.")],
      ),
    );
    const changed = results.filter((r) => r.status === "changed");
    expect(changed).toHaveLength(1);
    expect(changed[0]?.shard).toBe("no-surprises-2026");
  });

  it("never reports an unreachable source as unchanged", () => {
    const results = planWatch(
      FIXTURE,
      fetched(
        ["https://example.gov/a", new Error("HTTP 503")],
        ["https://example.gov/b", page("25 per centum of disposable earnings.")],
      ),
    );
    const bad = results.find((r) => r.shard === "no-surprises-2026");
    expect(bad?.status).toBe("unreachable");
    expect(results.some((r) => r.status === "unchanged")).toBe(true);
  });

  it("treats a source that was never fetched as unreachable, not as fine", () => {
    const results = planWatch(FIXTURE, new Map());
    expect(results.every((r) => r.status === "unreachable")).toBe(true);
  });
});

describe("the report a person reads", () => {
  it("says so plainly when nothing moved", () => {
    const report = renderWatchReport(
      planWatch(
        FIXTURE,
        fetched(
          ["https://example.gov/a", page("Emergency room visits are protected.")],
          ["https://example.gov/b", page("25 per centum of disposable earnings.")],
        ),
      ),
      "2026-10-08",
    );
    expect(report).toContain("byte-identical to the text last reviewed");
  });

  it("names the shard, and says nothing was edited", () => {
    const report = renderWatchReport(
      planWatch(
        FIXTURE,
        fetched(
          ["https://example.gov/a", page("Something else entirely.")],
          ["https://example.gov/b", new Error("HTTP 500")],
        ),
      ),
      "2026-10-08",
    );
    expect(report).toContain("no-surprises-2026");
    expect(report).toContain("Nothing was edited");
    // Unreachable is listed separately, because it is a different fact.
    expect(report).toContain("could not be checked");
    expect(report).toContain("HTTP 500");
  });
});

describe("accepting a reviewed change", () => {
  it("refreshes only the fingerprints that moved, and stamps the date", () => {
    const results = planWatch(
      FIXTURE,
      fetched(
        ["https://example.gov/a", page("Something else entirely.")],
        ["https://example.gov/b", page("25 per centum of disposable earnings.")],
      ),
    );
    const next = acceptChanges(FIXTURE, results, "2026-10-08");
    expect(next.entries[0]?.fingerprint).not.toBe(FIXTURE.entries[0]?.fingerprint);
    expect(next.entries[0]?.checkedOn).toBe("2026-10-08");
    expect(next.entries[1]).toEqual(FIXTURE.entries[1]);
  });
});

describe("the committed watch list", () => {
  const manifest = ManifestSchema.parse(
    JSON.parse(readFileSync(resolve(ROOT, "data", "manifest.json"), "utf8")),
  );

  it("covers every hand-authored Pillar 4 shard", () => {
    // SPEC-4 §10.7: every new shard gets a refresh workflow. For these six that
    // workflow is a review, not a rewrite — but the coverage requirement is the
    // same, and this is what enforces it when a seventh shard is added.
    const watched = new Set(watch.entries.map((e) => e.shard));
    for (const id of [
      "bill-triage-2026",
      "free-filing-2026",
      "no-surprises-2026",
      "garnishment-limits-2026",
      "enrollment-windows-2026",
      "life-events-2026",
    ]) {
      expect(watched.has(id), `${id} has no source watch`).toBe(true);
    }
  });

  it("watches Delaware, whose standard deduction is statutory and does not index", () => {
    // The other direction into this list: not a figure too consequential to
    // auto-rewrite, but one that never moves on a schedule. 30 Del. C. §1108
    // has set it at $3,250 / $6,500 since tax year 2000, so an annual value
    // adapter asks a question with no annual answer and reports the absence as
    // a broken parser.
    const de = watch.entries.find((e) => e.shard === "state-de-income-tax-2024");
    expect(de, "Delaware has no source watch").toBeDefined();
    expect(de?.url).toContain("delcode.delaware.gov");
    expect(de?.why).toMatch(/does not index/);
  });

  it("watches Medicaid's expansion map, which its adapter never looked at", () => {
    // The threshold this shard carries — 138% of the poverty line — has not
    // moved since 2014, and its adapter watches that. What changes is the MAP:
    // NFIB v. Sebelius made expansion optional, so a ballot measure or a
    // legislature can flip a state, and telling a household in a non-expansion
    // state that it may qualify is the worst answer this shard can give. The
    // map was watched by nothing, behind a citation note that said a refresh
    // watch covered it.
    const medicaid = watch.entries.find((e) => e.shard === "medicaid-2024");
    expect(medicaid, "Medicaid's expansion map has no source watch").toBeDefined();
    expect(medicaid?.url).toContain("medicaid.gov");
    // It gets a fingerprint rather than a parser because the only CMS page that
    // states the map row by row is dated December 2023 — a closed document a
    // parser would confirm forever and could never see change.
    expect(medicaid?.why).toMatch(/December 1, 2023/);
    expect(medicaid?.why).toMatch(/map/i);
  });

  it("watches only shards that actually exist in the manifest", () => {
    const known = new Set(manifest.datasets.map((d) => d.id));
    for (const entry of watch.entries) {
      expect(known.has(entry.shard), `${entry.shard} is watched but not bundled`).toBe(true);
    }
  });

  it("carries a real fingerprint, a source URL, and a stated reason for each", () => {
    for (const entry of watch.entries) {
      expect(entry.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.url).toMatch(/^https:\/\//);
      expect(entry.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // Why this shard cannot be auto-parsed is recorded, so the choice stays
      // arguable rather than becoming folklore.
      expect(entry.why.length).toBeGreaterThan(40);
    }
  });
});

describe("refusing to fingerprint an interstitial", () => {
  const long = (body: string): string => body + " lorem ipsum".repeat(400);

  it("rejects a page too short to be a statutory source", () => {
    // The real 45 CFR 155.420 normalizes to ~36,000 characters. eCFR's refusal
    // page is 1,180 — and it fingerprints just as cleanly, which is the danger.
    expect(looksLikeInterstitial("Short.")).toMatch(/too short to be the source/);
    expect(looksLikeInterstitial(long("A real regulation"))).toBeNull();
  });

  it("rejects the refusal eCFR actually served for years", () => {
    // Verbatim from what a bot user agent got until 2026-08-29. The committed
    // fingerprint was a fingerprint of THIS, so the ACA special-enrollment
    // window had never once been watched.
    const blocked = long(
      "Federal Register :: Request Access Request Access Due to aggressive automated " +
        "scraping of FederalRegister.gov and eCFR.gov, programmatic access to these sites is limited.",
    );
    expect(looksLikeInterstitial(blocked)).toMatch(/access interstitial/);
  });

  it("rejects the other shapes of standing-in-front-of-the-source", () => {
    expect(looksLikeInterstitial(long("Access Denied. You do not have permission."))).toMatch(
      /access interstitial/,
    );
    expect(looksLikeInterstitial(long("Checking your browser before accessing the site."))).toMatch(
      /access interstitial/,
    );
    expect(looksLikeInterstitial(long("Please enable JavaScript to view this page."))).toMatch(
      /access interstitial/,
    );
  });

  it("does not trip on a real page that merely mentions access far down", () => {
    // The phrases are only checked near the top, where an interstitial puts
    // them. A regulation that says "access" in its body is not a refusal.
    const real = long("Special enrollment periods.") + " request access to the exchange records.";
    expect(looksLikeInterstitial(real)).toBeNull();
  });
});

/**
 * Chrome a site prints about itself.
 *
 * On 2026-09-01 the two eCFR watches — the ACA special-enrollment window and
 * the RMD Uniform Lifetime Table, the two highest-harm regulation watches on
 * the site — both reported that their source had changed. Neither had. eCFR's
 * versioner API puts §155.420's last amendment at 2026-07-20 and gives
 * §1.401(a)(9)-9 no version at all in 2026, both before the fingerprints were
 * taken; the Uniform Lifetime Table matched the shard row for row, all 49 of
 * them, and §155.420(c)(1) still reads "60 days from the date of a triggering
 * event to select a QHP" exactly as the shard's note says.
 *
 * What moved was the banner every eCFR page carries about the whole CFR title.
 * An alert that fires when nothing happened is the one people learn to close
 * unread, which is the failure this whole watch is built to avoid.
 */
describe("not fingerprinting what a site says about itself", () => {
  const page = (banner: string, body: string): string =>
    `<html><body><p>${banner}</p><div>${body}</div></body></html>`;
  const BANNER_A =
    "Displaying title 45, up to date as of 8/28/2026. Title 45 was last amended 8/28/2026.";
  const BANNER_B =
    "Displaying title 45, up to date as of 9/30/2026. Title 45 was last amended 9/30/2026.";
  const RULE = "has 60 days from the date of a triggering event to select a QHP.";

  it("ignores the eCFR currency banner moving", () => {
    expect(fingerprint(page(BANNER_A, RULE))).toBe(fingerprint(page(BANNER_B, RULE)));
  });

  it("drops the banner rather than the sentence beside it", () => {
    expect(normalizeSourceText(page(BANNER_A, RULE))).toBe(RULE);
  });

  it("still sees the rule change under an unmoved banner", () => {
    // The half that matters. A normalization that quietly swallowed the body
    // would pass the test above and hide exactly what this watch is for.
    const moved = "has 30 days from the date of a triggering event to select a QHP.";
    expect(fingerprint(page(BANNER_A, RULE))).not.toBe(fingerprint(page(BANNER_A, moved)));
  });

  it("leaves an effective date in the rule alone", () => {
    // "Strip anything that looks like a date" would have been the easy rule and
    // the wrong one: an effective date is part of a regulation, not furniture
    // around it.
    const a =
      "This section applies to distribution calendar years beginning on or after January 1, 2022.";
    const b =
      "This section applies to distribution calendar years beginning on or after January 1, 2027.";
    expect(fingerprint(page(BANNER_A, a))).not.toBe(fingerprint(page(BANNER_A, b)));
  });
});
