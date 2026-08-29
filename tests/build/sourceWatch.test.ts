import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
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

const FIXTURE: WatchFile = {
  entries: [
    {
      shard: "no-surprises-2026",
      url: "https://example.gov/a",
      why: "prose, not a table",
      fingerprint: fingerprint("<p>Emergency room visits are protected.</p>"),
      checkedOn: "2026-08-29",
    },
    {
      shard: "garnishment-limits-2026",
      url: "https://example.gov/b",
      why: "statutory text",
      fingerprint: fingerprint("<p>25 per centum of disposable earnings.</p>"),
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
        ["https://example.gov/a", "<p>Emergency room visits are protected.</p>"],
        ["https://example.gov/b", "<p>25 per centum of disposable earnings.</p>"],
      ),
    );
    expect(results.every((r) => r.status === "unchanged")).toBe(true);
  });

  it("reports the shard by name when its source moved", () => {
    const results = planWatch(
      FIXTURE,
      fetched(
        ["https://example.gov/a", "<p>Emergency room visits are protected, mostly.</p>"],
        ["https://example.gov/b", "<p>25 per centum of disposable earnings.</p>"],
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
        ["https://example.gov/b", "<p>25 per centum of disposable earnings.</p>"],
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
          ["https://example.gov/a", "<p>Emergency room visits are protected.</p>"],
          ["https://example.gov/b", "<p>25 per centum of disposable earnings.</p>"],
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
          ["https://example.gov/a", "<p>Something else entirely.</p>"],
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
        ["https://example.gov/a", "<p>Something else entirely.</p>"],
        ["https://example.gov/b", "<p>25 per centum of disposable earnings.</p>"],
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
