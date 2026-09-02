import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { advisoriesFrom, reconcile, overdue } from "../../scripts/check-advisories";

/**
 * The dependency-advisory triage (scripts/check-advisories.ts).
 *
 * The check itself needs the network, so what is tested here is everything
 * around that: reading `npm audit --json`'s shape, deciding what is new, and the
 * triage file's own contract. The last one matters most — the file is a list of
 * reasons the build is allowed to stay green, and a reason nobody can check is
 * indistinguishable from no reason at all.
 */
const ROOT = resolve(__dirname, "..", "..");
const triage = JSON.parse(
  readFileSync(resolve(ROOT, "scripts", "advisory-triage.json"), "utf8"),
) as {
  note: string[];
  accepted: { id: string; package: string; reviewed: string; why: string[] }[];
};

/** The shape `npm audit --json` actually returns, trimmed to what is read. */
const REPORT = {
  vulnerabilities: {
    "@xmldom/xmldom": {
      severity: "moderate",
      via: [
        {
          source: 1158518,
          name: "@xmldom/xmldom",
          title: "xmldom: XML fragment injection during serialization",
          url: "https://github.com/advisories/GHSA-6gmq-8vp8-gcm6",
          severity: "moderate",
        },
      ],
    },
    mammoth: { severity: "moderate", via: ["@xmldom/xmldom"] },
  },
};

describe("reading npm audit", () => {
  it("flattens one row per advisory, keyed by its GHSA id", () => {
    const found = advisoriesFrom(REPORT);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      id: "GHSA-6gmq-8vp8-gcm6",
      package: "@xmldom/xmldom",
      severity: "moderate",
    });
  });

  it("does not count a package that is only affected THROUGH another as a finding", () => {
    // `mammoth`'s `via` is the bare string "@xmldom/xmldom" — the same advisory
    // reported a second time, one level up. Counting it would report two
    // problems where there is one, and the second would have no id to triage by.
    expect(advisoriesFrom(REPORT).map((a) => a.package)).toEqual(["@xmldom/xmldom"]);
  });

  it("reads a clean audit as no advisories rather than throwing", () => {
    expect(advisoriesFrom({ vulnerabilities: {} })).toEqual([]);
    expect(advisoriesFrom({})).toEqual([]);
  });
});

describe("reconciling findings against the triage file", () => {
  const accepted = [
    { id: "GHSA-6gmq-8vp8-gcm6", package: "@xmldom/xmldom", reviewed: "2026-09-02", why: ["…"] },
  ];

  it("is quiet when every finding has been reviewed", () => {
    const { untriaged, stale } = reconcile(advisoriesFrom(REPORT), accepted);
    expect(untriaged).toEqual([]);
    expect(stale).toEqual([]);
  });

  it("reports an advisory nobody has looked at — the one case that fails the run", () => {
    const { untriaged } = reconcile(advisoriesFrom(REPORT), []);
    expect(untriaged.map((a) => a.id)).toEqual(["GHSA-6gmq-8vp8-gcm6"]);
  });

  it("reports a triage entry for an advisory that is no longer reported", () => {
    // Left in place, that is a standing exception for a problem that is gone,
    // which is how an allowlist stops being a list of decisions.
    const { stale } = reconcile([], accepted);
    expect(stale.map((a) => a.id)).toEqual(["GHSA-6gmq-8vp8-gcm6"]);
  });

  it("asks for a re-read once a judgement is a year old, and not before", () => {
    const now = new Date("2027-09-03T00:00:00Z");
    expect(overdue(accepted, now).map((a) => a.id)).toEqual(["GHSA-6gmq-8vp8-gcm6"]);
    expect(overdue(accepted, new Date("2027-08-01T00:00:00Z"))).toEqual([]);
  });
});

describe("the triage file's own contract", () => {
  it("gives every accepted advisory an id, a package, a review date, and a reason", () => {
    expect(triage.accepted.length).toBeGreaterThan(0);
    for (const entry of triage.accepted) {
      expect(entry.id, "an advisory with no id cannot be matched to a finding").toMatch(/^GHSA-/);
      expect(entry.package).toBeTruthy();
      expect(entry.reviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isFinite(Date.parse(entry.reviewed))).toBe(true);
    }
  });

  it("makes every reason long enough to actually name the unreachable path", () => {
    // The failure this guards against is an entry reading "not exploitable",
    // which is a decision with no argument attached and cannot be re-checked.
    for (const entry of triage.accepted) {
      expect(
        entry.why.join(" ").length,
        `${entry.id}'s reason is too short to check`,
      ).toBeGreaterThan(200);
    }
  });

  it("never lists the same advisory twice", () => {
    const ids = triage.accepted.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
