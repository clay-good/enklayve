import { describe, it, expect, beforeAll } from "vitest";
import {
  LedgerSnapshotSchema,
  diffLedger,
  exportLedger,
  importLedger,
  isEncryptedLedger,
  isLedgerFile,
  isMaterial,
  parseDisplayedAmount,
  parseLedger,
  serializeLedger,
  takeSnapshot,
  watchableAnswers,
  MATERIAL_FLOOR_DOLLARS,
  type LedgerSnapshot,
} from "../../src/profile/ledger";
import { isEncrypted } from "../../src/profile/portable";
import { SituationStore } from "../../src/profile/situation";
import { buildReport, type ReportModel } from "../../src/readout/report";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import type { Deadline } from "../../src/engine/deadline";

/**
 * The Standing Ledger, Path 1 (SPEC-4-ledger.md).
 *
 * The tests are written against the three properties the feature stands on: a
 * snapshot round-trips exactly, the diff classifies correctly against a
 * synthetic dataset bump, and the snapshot shape cannot carry a document, an
 * unconfirmed value, or an identifier — enforced by schema, not convention.
 */
let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

const DEADLINE: Deadline = {
  label: "Elect COBRA continuation coverage",
  due: { daysFromTrigger: 60, trigger: "the day your coverage ended" },
  citation: {
    sourceUrl: "https://www.law.cornell.edu/uscode/text/29/1165",
    sourceDocument: "ERISA §605 — 29 U.S.C. §1165(a)(1)",
    effectiveYear: 2026,
    dateRetrieved: "2026-08-29",
  },
  isFloor: true,
};

function populated(): SituationStore {
  const p = new SituationStore();
  p.set("annualIncome", 82000, "typed");
  p.set("filingStatus", "single", "typed");
  p.set("stateCode", "tx", "typed");
  p.set("liquidSavings", 12000, "typed");
  p.set("essentialMonthlyExpenses", 3200, "typed");
  return p;
}

function snapshotOf(profile: SituationStore, model: ReportModel): LedgerSnapshot {
  return takeSnapshot(profile, data, watchableAnswers(model), [DEADLINE], "2026-08-29");
}

/** A report model with one line rewritten, standing in for a dataset bump. */
function withLine(model: ReportModel, label: string, value: string): ReportModel {
  return {
    ...model,
    sections: model.sections.map((s) => ({
      ...s,
      lines: s.lines.map((l) => (l.label === label ? { ...l, value } : l)),
    })),
  };
}

/** A report model with one line removed entirely. */
function withoutLine(model: ReportModel, label: string): ReportModel {
  return {
    ...model,
    sections: model.sections.map((s) => ({
      ...s,
      lines: s.lines.filter((l) => l.label !== label),
    })),
  };
}

describe("what a snapshot may hold", () => {
  it("records the situation, the answers, the deadlines, and the shard provenance", () => {
    const profile = populated();
    const model = buildReport(profile, data);
    const snap = snapshotOf(profile, model);

    expect(snap.format).toBe("enklayve.ledger");
    expect(snap.version).toBe(1);
    expect(snap.takenOn).toBe("2026-08-29");
    expect(snap.situation.values.annualIncome).toBe(82000);
    expect(snap.answers.length).toBeGreaterThan(0);
    expect(snap.deadlines).toHaveLength(1);
    expect(snap.provenance.schemaVersion).toBeGreaterThan(0);
    // Every bundled shard is pinned by id, version, and effective year.
    const shard = snap.provenance.shards.find((s) => s.id === "federal-income-tax-2024");
    expect(shard?.version.length).toBeGreaterThan(0);
    expect(shard?.effectiveYear).toBeGreaterThan(2000);
  });

  it("rejects a snapshot carrying anything the schema does not name", () => {
    const profile = populated();
    const snap = snapshotOf(profile, buildReport(profile, data));

    // A document, a name, an SSN — none of these can ride along, because the
    // schema is strict rather than permissive. This is the privacy property.
    for (const smuggled of [
      { documentText: "W-2 Wage and Tax Statement ..." },
      { name: "A Person" },
      { ssn: "000-00-0000" },
      { accountNumber: "1234567890" },
    ]) {
      const tampered = JSON.stringify({ ...snap, ...smuggled });
      expect(() => parseLedger(tampered)).toThrow(/isn't a valid enklayve ledger/);
    }
  });

  it("rejects an extra key smuggled inside a watched answer or a deadline", () => {
    const profile = populated();
    const snap = snapshotOf(profile, buildReport(profile, data));

    const inAnswer = structuredClone(snap) as unknown as Record<string, unknown>;
    (inAnswer.answers as Record<string, unknown>[])[0]!.sourceDocumentText = "a scanned bill";
    expect(() => parseLedger(JSON.stringify(inAnswer))).toThrow(/isn't a valid enklayve ledger/);

    const inDeadline = structuredClone(snap) as unknown as Record<string, unknown>;
    (inDeadline.deadlines as Record<string, unknown>[])[0]!.patientName = "A Person";
    expect(() => parseLedger(JSON.stringify(inDeadline))).toThrow(/isn't a valid enklayve ledger/);
  });

  it("will not accept a deadline without its citation", () => {
    const profile = populated();
    const snap = structuredClone(snapshotOf(profile, buildReport(profile, data))) as LedgerSnapshot;
    delete (snap.deadlines[0] as unknown as Record<string, unknown>).citation;
    expect(LedgerSnapshotSchema.safeParse(snap).success).toBe(false);
  });

  it("rejects a malformed file whole, with a plain-English reason", () => {
    expect(() => parseLedger("not json at all")).toThrow(/isn't valid JSON/);
    expect(() => parseLedger(JSON.stringify({ format: "enklayve.situation" }))).toThrow(
      /Nothing was changed/,
    );
  });
});

describe("round-tripping the carried file", () => {
  it("survives serialize and parse bit-for-bit", () => {
    const profile = populated();
    const snap = snapshotOf(profile, buildReport(profile, data));
    const text = serializeLedger(snap);
    const back = parseLedger(text);
    expect(serializeLedger(back)).toBe(text);
    expect(back).toEqual(snap);
  });

  it("carries the county, so a restored ledger recomputes the same tax it stored", () => {
    // The ledger's whole promise is that dropping the file back recomputes YOUR
    // answers against today's data and shows only what moved. A county tax that
    // did not survive the file would read as a change in the figures on the day
    // it was restored — a movement the reader would go looking for a cause of,
    // caused by the file forgetting where they live.
    const p = new SituationStore();
    p.set("annualIncome", 82000, "typed");
    p.set("filingStatus", "single", "typed");
    p.set("stateCode", "md", "typed");
    p.set("county", "md-worcester", "typed");
    const snap = snapshotOf(p, buildReport(p, data));
    const back = parseLedger(serializeLedger(snap));
    expect(back.situation.values.county).toBe("md-worcester");

    const restored = new SituationStore();
    restored.load(back.situation);
    expect(restored.get("county")).toBe("md-worcester");
    // And the report recomputed from the restored profile is the one that was
    // stored — which is only true because the county came back with it.
    expect(buildReport(restored, data).sections).toEqual(buildReport(p, data).sections);
    // The check has teeth: a different county really does change the report.
    const elsewhere = new SituationStore();
    elsewhere.load({
      ...back.situation,
      values: { ...back.situation.values, county: "md-dorchester" },
    });
    expect(buildReport(elsewhere, data).sections).not.toEqual(buildReport(p, data).sections);
  });

  it("round-trips through the encrypted envelope under its own format id", async () => {
    const profile = populated();
    const snap = snapshotOf(profile, buildReport(profile, data));

    const sealed = await exportLedger(snap, "correct horse battery staple");
    expect(isEncryptedLedger(sealed)).toBe(true);
    expect(isLedgerFile(sealed)).toBe(false);
    // The envelope is the situation export's, reused — same KDF, same cipher.
    const envelope = JSON.parse(sealed) as Record<string, unknown>;
    expect(envelope.format).toBe("enklayve.ledger.encrypted");
    expect(envelope.kdf).toBe("PBKDF2-SHA256");
    expect(envelope.iterations).toBe(210_000);
    // ...but it is not mistaken for a saved situation.
    expect(isEncrypted(sealed, "enklayve.situation.encrypted")).toBe(false);

    const opened = await importLedger(sealed, "correct horse battery staple");
    expect(serializeLedger(opened)).toBe(serializeLedger(snap));
  });

  it("refuses an encrypted ledger with no passphrase, and with the wrong one", async () => {
    const profile = populated();
    const sealed = await exportLedger(snapshotOf(profile, buildReport(profile, data)), "right");
    await expect(importLedger(sealed)).rejects.toThrow(/needs its passphrase/);
    await expect(importLedger(sealed, "wrong")).rejects.toThrow(/wrong passphrase/);
  });

  it("exports plain JSON when no passphrase is given", async () => {
    const profile = populated();
    const plain = await exportLedger(snapshotOf(profile, buildReport(profile, data)));
    expect(isLedgerFile(plain)).toBe(true);
    expect(isEncryptedLedger(plain)).toBe(false);
  });
});

describe("the materiality floor (§3.1)", () => {
  it("is the greater of $25 or 1%", () => {
    // Small answer: the $25 arm governs.
    expect(isMaterial(100, 120)).toBe(false);
    expect(isMaterial(100, 126)).toBe(true);
    // Large answer: the 1% arm governs, so $25 is noise.
    expect(isMaterial(50_000, 50_400)).toBe(false);
    expect(isMaterial(50_000, 50_600)).toBe(true);
    expect(MATERIAL_FLOOR_DOLLARS).toBe(25);
  });

  it("is symmetric, so a fall counts the same as a rise", () => {
    expect(isMaterial(1000, 900)).toBe(true);
    expect(isMaterial(900, 1000)).toBe(true);
  });
});

describe("reading a value back out of a report line", () => {
  it("recovers a currency figure and refuses everything else", () => {
    expect(parseDisplayedAmount("$11,212.00")).toBe(11212);
    expect(parseDisplayedAmount("-$450.50")).toBe(-450.5);
    // A percentage, a status, and a sentence are not money and must not be
    // coerced into it — that is what keeps a status change a threshold crossing.
    expect(parseDisplayedAmount("12.3%")).toBeNull();
    expect(parseDisplayedAmount("Eligible")).toBeNull();
    expect(parseDisplayedAmount("Build a starter cushion")).toBeNull();
  });
});

describe("the recompute diff against a synthetic dataset bump", () => {
  const profile = populated();
  let base: ReportModel;
  let snap: LedgerSnapshot;
  beforeAll(() => {
    base = buildReport(profile, data);
    snap = snapshotOf(profile, base);
  });

  it("reports nothing changed when the data has not moved — calmly, not as an empty state", () => {
    const diff = diffLedger(snap, base);
    expect(diff.nothingChanged).toBe(true);
    expect(diff.crossings).toEqual([]);
    expect(diff.material).toEqual([]);
    expect(diff.unchanged.length).toBe(snap.answers.length);
  });

  it("classifies a money move past the floor as material, and names the movement", () => {
    const takeHome = snap.answers.find((a) => a.label === "Annual take-home");
    expect(takeHome?.amount).toBeDefined();
    const bumped = withLine(base, "Annual take-home", "$1,000.00");
    const diff = diffLedger(snap, bumped);
    const line = diff.material.find((m) => m.label === "Annual take-home");
    expect(line?.kind).toBe("material");
    expect(line?.after).toBe("$1,000.00");
    expect(line?.delta).toBe(1000 - takeHome!.amount!);
    expect(diff.nothingChanged).toBe(false);
  });

  it("records a sub-floor move as unchanged, so rounding does not manufacture news", () => {
    const takeHome = snap.answers.find((a) => a.label === "Annual take-home")!;
    const nudged = takeHome.amount! + 1;
    const diff = diffLedger(
      snap,
      withLine(base, "Annual take-home", `$${nudged.toLocaleString("en-US")}.00`),
    );
    expect(diff.material.find((m) => m.label === "Annual take-home")).toBeUndefined();
    expect(diff.nothingChanged).toBe(true);
  });

  it("treats a status change as a threshold crossing whatever its magnitude", () => {
    const status = snap.answers.find((a) => a.amount === undefined);
    expect(status).toBeDefined();
    const diff = diffLedger(snap, withLine(base, status!.label, "Something else entirely"));
    const crossing = diff.crossings.find((c) => c.label === status!.label);
    expect(crossing?.kind).toBe("threshold");
    // No dollar floor can suppress it — there is no delta to measure.
    expect(crossing?.delta).toBeUndefined();
  });

  it("treats an answer that changed shape as a crossing — the boundary wins", () => {
    // A money answer that became a status ("$0.00" -> "Not eligible") is the
    // exact case a dollar floor would wrongly hide.
    const money = snap.answers.find((a) => a.amount !== undefined)!;
    const diff = diffLedger(snap, withLine(base, money.label, "Not eligible"));
    expect(diff.crossings.find((c) => c.label === money.label)?.kind).toBe("threshold");
  });

  it("reports an answer that disappeared rather than dropping it silently", () => {
    const money = snap.answers.find((a) => a.amount !== undefined)!;
    const diff = diffLedger(snap, withoutLine(base, money.label));
    const gone = diff.crossings.find((c) => c.label === money.label);
    expect(gone?.kind).toBe("gone");
    expect(gone?.after).toBeNull();
  });

  it("names the shards that moved between the snapshot and the current bundle", () => {
    const current = snap.provenance.shards.map((s) =>
      s.id === "federal-income-tax-2024"
        ? { ...s, version: "9.9.9", effectiveYear: s.effectiveYear + 1 }
        : s,
    );
    const diff = diffLedger(snap, base, current);
    expect(diff.shardChanges).toHaveLength(1);
    expect(diff.shardChanges[0]).toMatchObject({
      id: "federal-income-tax-2024",
      after: "9.9.9",
    });
  });

  it("carries the snapshot's deadlines through with their citations intact", () => {
    const diff = diffLedger(snap, base);
    expect(diff.deadlines).toHaveLength(1);
    expect(diff.deadlines[0]?.citation.sourceDocument).toContain("1165");
  });
});
