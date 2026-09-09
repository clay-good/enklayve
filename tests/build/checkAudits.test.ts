import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  auditAges,
  auditRows,
  jurisdictions,
  jurisdictionsNamedBy,
  renderAuditReport,
  staleAudits,
  STALE_DAYS,
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

describe("how old each jurisdiction's audit is", () => {
  const places = [
    { code: "AR", name: "Arkansas" },
    { code: "KS", name: "Kansas" },
    { code: "CO", name: "Colorado" },
  ];

  it("takes the most recent row naming a jurisdiction, by name or by code", () => {
    const rows = [
      { date: "2026-01-10", named: ["Arkansas"] },
      { date: "2026-05-06", named: ["Arkansas"] },
      { date: "2026-03-01", named: ["CO"] },
    ];
    const ages = auditAges(places, rows, day("2026-05-16"));
    expect(ages.find((a) => a.code === "AR")?.lastAudited).toBe("2026-05-06");
    expect(ages.find((a) => a.code === "AR")?.daysSince).toBe(10);
    // Named by its postal code, which is how one row of the real table is written.
    expect(ages.find((a) => a.code === "CO")?.lastAudited).toBe("2026-03-01");
  });

  it("reports a jurisdiction no row names as never audited", () => {
    const ages = auditAges(
      places,
      [{ date: "2026-05-06", named: ["Arkansas"] }],
      day("2026-05-16"),
    );
    const ks = ages.find((a) => a.code === "KS");
    expect(ks?.lastAudited).toBeUndefined();
    expect(ks?.daysSince).toBe(Infinity);
  });

  it("counts never-audited as stale at every threshold", () => {
    const ages = auditAges(places, [], day("2026-05-16"));
    expect(
      staleAudits(ages, 100_000)
        .map((a) => a.code)
        .sort(),
    ).toEqual(["AR", "CO", "KS"]);
  });

  it("reports the oldest reading first, and only past the threshold", () => {
    const rows = [
      { date: "2026-01-01", named: ["Arkansas"] },
      { date: "2026-05-01", named: ["Kansas"] },
      { date: "2025-06-01", named: ["Colorado"] },
    ];
    const ages = auditAges(places, rows, day("2026-06-01"));
    // Colorado 365 days, Arkansas 151, Kansas 31.
    expect(staleAudits(ages, 180).map((a) => a.code)).toEqual(["CO"]);
    expect(staleAudits(ages, 100).map((a) => a.code)).toEqual(["CO", "AR"]);
    expect(staleAudits(ages, 400)).toEqual([]);
  });
});

describe("the report a person reads", () => {
  it("says so plainly when every jurisdiction is current", () => {
    expect(renderAuditReport([], 51, 180)).toContain("All 51 jurisdictions");
    expect(renderAuditReport([], 51, 180)).toContain("Nothing to do");
  });

  it("separates the never-read from the long-unread, and says what to do", () => {
    const report = renderAuditReport(
      [
        { code: "KS", name: "Kansas", daysSince: Infinity },
        { code: "AR", name: "Arkansas", lastAudited: "2025-06-01", daysSince: 365 },
      ],
      51,
      180,
    );
    expect(report).toContain("never been read");
    expect(report).toContain("**Kansas** (`KS`)");
    expect(report).toContain("last audited 2025-06-01, 365 days ago");
    // The instruction is the point of the issue body: an adapter agreeing is
    // not an audit, and the state's own form can be older than its own law.
    expect(report).toContain("Act 2 of the 2026 First Extraordinary Session");
    expect(report).toContain("docs/data-sources.md#source-audits");
  });
});

describe("the shipped state of the record", () => {
  it("shipped 51 jurisdictions, every one of them audited", () => {
    const places = jurisdictions(resolve(ROOT, "data"));
    expect(places.length).toBe(51);
    const rows = auditRows(readFileSync(resolve(ROOT, "docs", "data-sources.md"), "utf8"));
    const never = auditAges(places, rows, day("2026-09-09")).filter(
      (a) => a.lastAudited === undefined,
    );
    expect(
      never.map((a) => a.name),
      "a jurisdiction nobody has audited — add a row to the Source audits table in " +
        "docs/data-sources.md saying what was checked, even when nothing changed",
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
