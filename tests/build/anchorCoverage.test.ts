import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ADAPTERS } from "../../scripts/refresh/adapters";
import { stateName } from "../../src/data/usStates";

/**
 * Every adapter is anchoring, or says why it is not.
 *
 * `adapter-baseline.json` holds the short list — the adapters known to read
 * their source correctly — and it holds the short list on purpose: a report
 * naming every adapter that cannot anchor, every month, is an alert nobody
 * reads by the third time. But a healthy list with nothing beside it has its
 * own failure mode, and it is the one the watch-coverage list was written to
 * fix, one level up. Forty-two of fifty-nine adapters are on it. The other
 * seventeen read, to anyone opening the file, as seventeen pieces of unwritten
 * work — and on 2026-08-31 not one of them was. Every one already refused to
 * parse for a careful, specific reason, and every one of those reasons existed
 * only in the output of a dry run nobody had recently done.
 *
 * So this is the same bargain as watch-coverage: an adapter is on the healthy
 * list, or it is written down with a verdict a reader can argue with.
 *
 * The two verdicts are not interchangeable. WAITING ON THE SOURCE is a date —
 * the state has not published the shard's year, the adapter is right to refuse
 * a closed year that would report agreement forever, and it becomes work the
 * day the document appears. WILL NOT ANCHOR is a decision — there is no annual
 * figure on the page, or the page states a *different* figure that would be
 * right by accident. Without the distinction nobody can tell Oregon, which
 * needs one URL changed in a few months, from Delaware, whose deduction has not
 * moved since 1999.
 */
const ROOT = resolve(__dirname, "..", "..");
const baseline = JSON.parse(
  readFileSync(resolve(ROOT, "scripts/refresh/adapter-baseline.json"), "utf8"),
) as { note: string[]; knownAnchoring: string[]; unanchored: Record<string, string> };

const anchoring = new Set(baseline.knownAnchoring);
const ids = ADAPTERS.map((a) => a.id);

describe("anchoring coverage over the refresh adapters", () => {
  it("accounts for every adapter, by the healthy list or by a written reason", () => {
    const unaccounted = ids.filter((id) => !anchoring.has(id) && !(id in baseline.unanchored));
    expect(
      unaccounted,
      `these adapters are neither known-anchoring nor explained: ${unaccounted.join(", ")}` +
        " — dry-run each (`node scripts/refresh/run.ts --adapter <id> --dry-run`) and either add" +
        " it to knownAnchoring or record why it cannot anchor in adapter-baseline.json",
    ).toEqual([]);
  });

  it("never claims an adapter is both healthy and explained", () => {
    const both = Object.keys(baseline.unanchored).filter((id) => anchoring.has(id));
    expect(both, `${both.join(", ")} is on knownAnchoring — drop the unanchored entry`).toEqual([]);
  });

  it("explains only adapters that exist", () => {
    const known = new Set(ids);
    for (const id of Object.keys(baseline.unanchored)) {
      expect(known.has(id), `${id} is explained but is not an adapter`).toBe(true);
    }
  });

  it("gives each one a verdict, not a shrug", () => {
    for (const [id, reason] of Object.entries(baseline.unanchored)) {
      expect(reason.length, `${id}'s reason is too short to be one`).toBeGreaterThan(120);
      expect(
        reason,
        `${id} must open with WAITING ON THE SOURCE or WILL NOT ANCHOR — a reader has to be` +
          " able to tell a date from a decision",
      ).toMatch(/^(WAITING ON THE SOURCE|WILL NOT ANCHOR)\./);
    }
  });

  it("says what would close a WAITING entry, since it is work with a date on it", () => {
    // These become work when a state posts a document. An entry that does not
    // say which document, or what to do with it, is where that work goes to be
    // forgotten — the failure the watch-coverage list names in its own note.
    const waiting = Object.entries(baseline.unanchored).filter(([, r]) =>
      r.startsWith("WAITING ON THE SOURCE"),
    );
    expect(waiting.length).toBeGreaterThan(0);
    for (const [id, reason] of waiting) {
      expect(
        reason,
        `${id} is waiting on something but does not say what happens when it arrives`,
      ).toMatch(/\bthe day\b|becomes work/i);
    }
  });

  it("watches the wait, wherever the entry tells a person to repoint the adapter", () => {
    // The eleven WAITING entries split again, and the split is the difference
    // between a refusal that ends by itself and one that does not. Seven watch
    // a page that will eventually state the figure: the parser runs first, so
    // the day it does, the adapter anchors and nobody has to notice. Four are
    // parked on a document at a DIFFERENT url — a booklet, a schedule, a year's
    // forms index — and the menu page they watch will never state a deduction
    // however much the state publishes. Those entries say "repoint this
    // adapter", which is a task with no owner and no trigger, and the cost of
    // forgetting is a shard a year behind a citation that still looks live.
    //
    // So the marker in the prose is the rule: an entry that asks a person to
    // repoint must carry a probe that tells them when.
    const repoint = Object.entries(baseline.unanchored).filter(
      ([, r]) => r.startsWith("WAITING ON THE SOURCE") && /\brepoint (this adapter|it)\b/i.test(r),
    );
    expect(repoint.length).toBeGreaterThan(0);
    for (const [id] of repoint) {
      const adapter = ADAPTERS.find((a) => a.id === id);
      expect(
        adapter?.awaiting,
        `${id} says to repoint it and nothing watches for the day`,
      ).toBeTruthy();
    }
  });

  it("aims each wait probe at the awaited year and at the published one", () => {
    // A probe with no calibration is a probe that reports patience forever in
    // the same words it uses when the wait is real. And a probe whose two
    // halves are identical is not calibrated at all — it would answer both
    // questions the same way by construction.
    for (const adapter of ADAPTERS) {
      const awaiting = adapter.awaiting;
      if (!awaiting) continue;
      expect(
        awaiting.what.length,
        `${adapter.id} does not say what it is waiting for`,
      ).toBeGreaterThan(20);
      const arrived = `${awaiting.arrived.url} ${awaiting.arrived.match?.source ?? ""}`;
      const published = `${awaiting.calibration.url} ${awaiting.calibration.match?.source ?? ""}`;
      expect(arrived, `${adapter.id}'s probe cannot tell the two years apart`).not.toBe(published);
      // Same shape on both sides: one half matching text while the other only
      // asks whether a url answers compares two different questions.
      expect(Boolean(awaiting.arrived.match)).toBe(Boolean(awaiting.calibration.match));
    }
  });

  it("names every wait probe in the README, where the enumeration is the claim", () => {
    // The probes above are held to their own shape; nothing held the prose that
    // tells a reader they exist. On 2026-09-03 that prose said "Four cannot" and
    // named Oregon, Nebraska, Arkansas and Vermont, and there were five: the
    // California probe had been added for a shard whose adapter ANCHORS AND
    // AGREES, which is the case the four-refusal framing has no room for. Nobody
    // was wrong for long, because nobody could be told.
    //
    // So the README paragraph is read back the way readmeCounts reads the
    // by-the-numbers table. Held one way on purpose: every probe must be named,
    // and a state named there need not have one, because the same paragraph
    // narrates states that used to be stale and are not waiting on anything now.
    const paragraph = readFileSync(resolve(ROOT, "README.md"), "utf8")
      .split("\n")
      .find((line) => line.includes("calibrated on the year that IS published"));
    expect(
      paragraph,
      "the README paragraph describing the wait probes has moved or been reworded — this test" +
        " anchors on 'calibrated on the year that IS published'",
    ).toBeDefined();
    // Every probe today belongs to a state adapter, so the state's own name is
    // what a reader looks for. Anything else has to be named by its id, which
    // will read badly in the prose and is meant to: it is the signal to write
    // the sentence rather than to widen the pattern.
    const named = (id: string): string => {
      const code = /^state-([a-z]{2})-/.exec(id)?.[1];
      return code ? stateName(code.toUpperCase()) : id;
    };
    const unnamed = ADAPTERS.filter((a) => a.awaiting)
      .map((a) => ({ id: a.id, name: named(a.id) }))
      .filter(({ name }) => !paragraph?.includes(name));
    expect(
      unnamed.map((u) => `${u.id} (${u.name})`),
      "these adapters carry a wait probe that the README never mentions — a probe a reader has" +
        " not heard of is a probe nobody will miss when it is deleted",
    ).toEqual([]);
  });

  it("keeps the note explaining why a short healthy list needs a long explained one", () => {
    const note = baseline.note.join(" ");
    expect(note).toMatch(/should GROW/);
    expect(note).toMatch(/WAITING ON THE SOURCE/);
    expect(note).toMatch(/WILL NOT ANCHOR/);
  });
});
