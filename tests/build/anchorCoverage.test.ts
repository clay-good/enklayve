import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ADAPTERS } from "../../scripts/refresh/adapters";

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

  it("keeps the note explaining why a short healthy list needs a long explained one", () => {
    const note = baseline.note.join(" ");
    expect(note).toMatch(/should GROW/);
    expect(note).toMatch(/WAITING ON THE SOURCE/);
    expect(note).toMatch(/WILL NOT ANCHOR/);
  });
});
