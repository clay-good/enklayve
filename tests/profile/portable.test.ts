import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SituationStore } from "../../src/profile/situation";
import type { SituationKey, SituationValues } from "../../src/profile/situation";
import {
  serialize,
  exportProfile,
  importProfile,
  encrypt,
  decrypt,
  isEncrypted,
} from "../../src/profile/portable";

function seeded(): SituationStore {
  const s = new SituationStore();
  s.set("filingStatus", "married_jointly");
  s.set("stateCode", "ca");
  s.set("annualIncome", 142000);
  s.set("ages", [41, 39, 9, 6], "extracted");
  return s;
}

/**
 * A value for every field My Situation declares, each distinguishable from the
 * others, so a field dropped in the file comes back named.
 *
 * The round-trip case below seeds four fields of sixteen. That is the shape
 * this repository keeps finding: a hand-kept list that silently stops covering
 * what it is named for. The stakes are higher here than in most of them — this
 * is the file a household exports and keeps, the one they reopen months later,
 * and a field the serializer forgets is not a wrong number on a screen but a
 * number that is simply gone, in a file they were told holds their situation.
 *
 * So the roster is read off `SituationValues` itself and every declared field
 * must appear here. Adding a field to My Situation without a value in this map
 * fails, which is the moment to ask whether the format carries it.
 */
const EVERY_FIELD: SituationValues = {
  filingStatus: "married_jointly",
  stateCode: "md",
  // Maryland, because a county is only reachable in a state that levies one:
  // a format that carried the state and dropped the county would re-price the
  // household on reopening.
  county: "md-montgomery",
  householdSize: 4,
  ages: [41, 39, 9, 6],
  qualifyingChildren: 2,
  annualIncome: 142_000,
  qualifiedTipsAnnual: 1_234,
  qualifiedOvertimeAnnual: 2_345,
  preTaxContributions: 3_456,
  retirementContributionsAnnual: 4_567,
  employerMatchAnnual: 5_678,
  employerMatchCaptured: 678,
  debts: [{ name: "Card", balance: 9_876, ratePct: 22 }],
  essentialMonthlyExpenses: 3_210,
  totalMonthlyExpenses: 4_321,
  liquidSavings: 54_321,
  planDeductible: 54_321,
};

/** The fields the interface declares, read off the source rather than listed. */
const DECLARED = (() => {
  const src = readFileSync(
    resolve(__dirname, "..", "..", "src", "profile", "situation.ts"),
    "utf8",
  );
  const body = /export interface SituationValues \{([\s\S]*?)\n\}/.exec(src)?.[1] ?? "";
  return [...body.matchAll(/^ {2}(\w+)[?]?:/gm)].map((m) => m[1]!);
})();

describe("portable profile", () => {
  it("round-trips a plain export through import", async () => {
    const src = seeded();
    const file = serialize(src);

    const dest = new SituationStore();
    await importProfile(dest, file);
    expect(dest.get("annualIncome")).toBe(142000);
    expect(dest.get("filingStatus")).toBe("married_jointly");
    expect(dest.get("ages")).toEqual([41, 39, 9, 6]);
    expect(dest.sourceOf("ages")).toBe("extracted");
  });

  it("encrypts and decrypts with the right passphrase", async () => {
    const plaintext = serialize(seeded());
    const envelope = await encrypt(plaintext, "correct horse battery staple");
    expect(isEncrypted(envelope)).toBe(true);
    expect(envelope).not.toContain("142000"); // ciphertext, not cleartext
    const back = await decrypt(envelope, "correct horse battery staple");
    expect(back).toBe(plaintext);
  });

  it("fails to decrypt with the wrong passphrase", async () => {
    const envelope = await encrypt(serialize(seeded()), "right");
    await expect(decrypt(envelope, "wrong")).rejects.toThrow();
  });

  it("imports an encrypted export end-to-end", async () => {
    const src = seeded();
    const file = await exportProfile(src, "s3cret");
    expect(isEncrypted(file)).toBe(true);

    const dest = new SituationStore();
    await importProfile(dest, file, "s3cret");
    expect(dest.get("annualIncome")).toBe(142000);
  });

  it("requires a passphrase when importing an encrypted file", async () => {
    const file = await exportProfile(seeded(), "s3cret");
    await expect(importProfile(new SituationStore(), file)).rejects.toThrow(/passphrase/);
  });

  it("rejects a file that is not an enklayve profile", async () => {
    await expect(importProfile(new SituationStore(), '{"hello":"world"}')).rejects.toThrow();
  });

  it("carries every field My Situation declares", async () => {
    expect(DECLARED.length).toBeGreaterThan(10);
    expect(
      DECLARED.filter((f) => !(f in EVERY_FIELD)),
      "a field My Situation declares and this round trip never puts in the file",
    ).toEqual([]);

    const src = new SituationStore();
    for (const [key, value] of Object.entries(EVERY_FIELD)) {
      src.set(key as SituationKey, value as never);
    }
    const dest = new SituationStore();
    await importProfile(dest, serialize(src));

    const read = (s: SituationStore): Record<string, unknown> =>
      Object.fromEntries(s.entries().map((e) => [e.key, e.value]));
    expect(read(dest), "a field went into the file and did not come back").toEqual(read(src));
  });

  it("carries where each field came from, not only what it says", async () => {
    // Provenance is what the Report prints beside a figure -- "you typed this"
    // against "your W-2 said this" -- so a file that keeps the number and loses
    // the source reopens making a claim nobody made.
    const src = new SituationStore();
    src.set("annualIncome", 142_000, "extracted");
    src.set("liquidSavings", 54_321, "typed");
    const dest = new SituationStore();
    await importProfile(dest, serialize(src));
    expect(dest.sourceOf("annualIncome")).toBe("extracted");
    expect(dest.sourceOf("liquidSavings")).toBe("typed");
  });
});
