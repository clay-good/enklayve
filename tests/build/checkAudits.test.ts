import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  auditAges,
  auditRows,
  jurisdictionsNamedBy,
  renderAuditReport,
  staleAudits,
  STALE_DAYS,
  SUBJECTS,
  subjects,
} from "../../scripts/check-audits";

/**
 * How long since anybody re-read a jurisdiction against its own document.
 *
 * Every jurisdiction appears in the Source audits table at least once, and
 * `readmeCounts.test.ts` gates that — so the coverage question is answered
 * forever, and the question worth asking became how old the answer is. Arkansas
 * is the case the check is shaped around: a rate cut on May 6 against a state
 * form printed the previous October, invisible to the adapter (the page had not
 * moved), to the staleness banner (the year had not lapsed), and to the audit
 * table (a tick with no expiry).
 *
 * The date is an input, so every case here supplies one — a test that reads the
 * real clock would pass today and fail on a date nobody chose, which is the
 * whole reason this check lives on a schedule rather than in the gate.
 */
const ROOT = resolve(__dirname, "..", "..");
const day = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

describe("reading the Source audits table", () => {
  it("splits a cell into the jurisdictions it names", () => {
    expect(jurisdictionsNamedBy("Alabama, Kansas, Connecticut, Wisconsin")).toEqual([
      "Alabama",
      "Kansas",
      "Connecticut",
      "Wisconsin",
    ]);
  });

  it("drops the qualifier a row carries and the bold a federal row carries", () => {
    // The table writes what the row is *about* in parentheses, and bolds the
    // rows whose subject is a federal shard rather than a state.
    expect(jurisdictionsNamedBy("New York (Yonkers)")).toEqual(["New York"]);
    expect(jurisdictionsNamedBy("Utah (second pass)")).toEqual(["Utah"]);
    expect(jurisdictionsNamedBy("**Federal**")).toEqual(["Federal"]);
  });

  it("reads a row written in postal codes", () => {
    // One row covers seven conformity states at once and writes them short.
    expect(jurisdictionsNamedBy("CO, ID, IA, MT, ND, NM, DC")).toEqual([
      "CO",
      "ID",
      "IA",
      "MT",
      "ND",
      "NM",
      "DC",
    ]);
  });

  it("does not let one state's name stand in for another's", () => {
    // The reason this is a parser rather than a substring test. "Kansas" is
    // inside "Arkansas" and "Virginia" inside "West Virginia", so `includes`
    // reports a jurisdiction as audited off the back of a row about a different
    // one — a coverage check that silently grants coverage.
    const named = jurisdictionsNamedBy("Arkansas, West Virginia");
    expect(named).toEqual(["Arkansas", "West Virginia"]);
    expect(named).not.toContain("Kansas");
    expect(named).not.toContain("Virginia");
  });

  it("finds the real table's rows, dated and attributed", () => {
    const rows = auditRows(readFileSync(resolve(ROOT, "docs", "data-sources.md"), "utf8"));
    expect(rows.length, "the audit table lost its rows").toBeGreaterThan(20);
    expect(rows.every((r) => /^20\d\d-\d\d-\d\d$/.test(r.date))).toBe(true);
    expect(rows.every((r) => r.named.length > 0)).toBe(true);
  });

  it("returns nothing when the table is gone rather than guessing", () => {
    expect(auditRows("# A document with no audits section\n")).toEqual([]);
  });
});

describe("how old each shard's audit is", () => {
  const places = [
    { id: "state-ar-income-tax-2024", label: "Arkansas", aliases: ["Arkansas", "AR"] },
    { id: "state-ks-income-tax-2024", label: "Kansas", aliases: ["Kansas", "KS"] },
    { id: "amt-2024", label: "amt-2024", aliases: ["Federal benefits and screeners", "AMT"] },
  ];

  it("takes the most recent row naming a shard, by any of its aliases", () => {
    const rows = [
      { date: "2026-01-10", named: ["Arkansas"] },
      { date: "2026-05-06", named: ["AR"] },
      { date: "2026-03-01", named: ["Federal benefits and screeners"] },
      { date: "2026-04-02", named: ["AMT"] },
    ];
    const ages = auditAges(places, rows, day("2026-05-16"));
    // Named once by name and once by postal code; the later one is the answer.
    expect(ages.find((a) => a.id.startsWith("state-ar"))?.lastAudited).toBe("2026-05-06");
    expect(ages.find((a) => a.id.startsWith("state-ar"))?.daysSince).toBe(10);
    // A federal shard reached by two different subject phrases, one of them the
    // second pass that found the wrong phase-out rate.
    expect(ages.find((a) => a.id === "amt-2024")?.lastAudited).toBe("2026-04-02");
  });

  it("reports a shard no row names as never audited", () => {
    const ages = auditAges(
      places,
      [{ date: "2026-05-06", named: ["Arkansas"] }],
      day("2026-05-16"),
    );
    const ks = ages.find((a) => a.label === "Kansas");
    expect(ks?.lastAudited).toBeUndefined();
    expect(ks?.daysSince).toBe(Infinity);
  });

  it("counts never-audited as stale at every threshold", () => {
    const ages = auditAges(places, [], day("2026-05-16"));
    expect(staleAudits(ages, 100_000)).toHaveLength(3);
  });

  it("reports the oldest reading first, and only past the threshold", () => {
    const rows = [
      { date: "2026-01-01", named: ["Arkansas"] },
      { date: "2026-05-01", named: ["Kansas"] },
      { date: "2025-06-01", named: ["AMT"] },
    ];
    const ages = auditAges(places, rows, day("2026-06-01"));
    // AMT 365 days, Arkansas 151, Kansas 31.
    expect(staleAudits(ages, 180).map((a) => a.label)).toEqual(["amt-2024"]);
    expect(staleAudits(ages, 100).map((a) => a.label)).toEqual(["amt-2024", "Arkansas"]);
    expect(staleAudits(ages, 400)).toEqual([]);
  });
});

describe("the report a person reads", () => {
  it("says so plainly when every shard is current", () => {
    expect(renderAuditReport([], 81, 180)).toContain("All 81 shards");
    expect(renderAuditReport([], 81, 180)).toContain("Nothing to do");
  });

  it("separates the never-read from the long-unread, and says what to do", () => {
    const report = renderAuditReport(
      [
        { id: "state-ks-income-tax-2024", label: "Kansas", daysSince: Infinity },
        { id: "amt-2024", label: "amt-2024", lastAudited: "2025-06-01", daysSince: 365 },
      ],
      81,
      180,
    );
    expect(report).toContain("never been read");
    expect(report).toContain("**Kansas** (`state-ks-income-tax-2024`)");
    expect(report).toContain("last audited 2025-06-01, 365 days ago");
    // A shard whose only name is its id is printed once, not twice.
    expect(report).toContain("- `amt-2024` — last audited");
    expect(report).not.toContain("**amt-2024** (`amt-2024`)");
    // The instruction is the point of the issue body: an adapter agreeing is
    // not an audit, and the state's own form can be older than its own law.
    expect(report).toContain("Act 2 of the 2026 First Extraordinary Session");
    expect(report).toContain("docs/data-sources.md#source-audits");
  });
});

describe("the roster is every shard, not only the states", () => {
  const ids = (
    JSON.parse(readFileSync(resolve(ROOT, "data", "manifest.json"), "utf8")) as {
      datasets: { id: string }[];
    }
  ).datasets.map((d) => d.id);
  const roster = subjects(resolve(ROOT, "data"), ids);

  it("covers every dataset the manifest ships", () => {
    // The federal figures are the most-read on this site and move on the same
    // annual cycle, so scoping the question to `state-*.json` would have been
    // the narrowing this project keeps finding one directory over.
    expect(roster).toHaveLength(ids.length);
    expect(roster.filter((r) => r.id.startsWith("state-"))).toHaveLength(51);
  });

  it("names a state by its own name and postal code, from the shard", () => {
    const ar = roster.find((r) => r.id === "state-ar-income-tax-2024");
    expect(ar?.label).toBe("Arkansas");
    expect(ar?.aliases).toEqual(["Arkansas", "AR"]);
  });

  it("routes a federal shard through every subject phrase that covers it", () => {
    // The AMT shard is reached twice: once by the sweep of the seven benefit
    // shards, and once by the second pass that found §55(d)(4)(A)(ii)(IV).
    expect(roster.find((r) => r.id === "amt-2024")?.aliases.sort()).toEqual([
      "AMT",
      "Federal benefits and screeners",
    ]);
  });
});

describe("the subject map is held to the table from both directions", () => {
  const doc = readFileSync(resolve(ROOT, "docs", "data-sources.md"), "utf8");
  const cellPhrases = new Set(auditRows(doc).flatMap((r) => r.named));
  const manifestIds = new Set(
    (
      JSON.parse(readFileSync(resolve(ROOT, "data", "manifest.json"), "utf8")) as {
        datasets: { id: string }[];
      }
    ).datasets.map((d) => d.id),
  );

  it("points at no shard the manifest does not ship", () => {
    // A phantom id silently drops a real shard out of the freshness question.
    const phantom = Object.entries(SUBJECTS).flatMap(([phrase, ids]) =>
      ids.filter((id) => !manifestIds.has(id)).map((id) => `${phrase} → ${id}`),
    );
    expect(phantom).toEqual([]);
  });

  it("has no key that no row writes", () => {
    // The stale-allowlist failure: a dead key grants an audit to a shard nobody
    // has read, and reads as coverage forever.
    const dead = Object.keys(SUBJECTS).filter((phrase) => !cellPhrases.has(phrase));
    expect(
      dead,
      "these subject phrases appear in no Source audits row — the row was reworded and the map " +
        "still claims its shards were audited",
    ).toEqual([]);
  });

  it("gives an audit half a year before it wants re-reading", () => {
    // Not from any legislature's calendar — they run from a 45-day session to a
    // permanent one — but because half a year is long enough that a session's
    // enactments have passed behind the reading, and short enough to land in
    // both sweeps: after the spring adjournments, and again in the autumn.
    expect(STALE_DAYS).toBe(180);
  });
});
