import { describe, it, expect } from "vitest";
import { SituationStore } from "../../src/profile/situation";
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
});
