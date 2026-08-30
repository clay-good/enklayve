import { describe, it, expect } from "vitest";
import { decrypt, encrypt, iterationsFor } from "../../src/profile/portable";

/**
 * The work factor an encrypted export is read at.
 *
 * The envelope records `iterations` because the number is meant to rise —
 * OWASP's PBKDF2-SHA256 guidance goes up as hardware does. Reading used to
 * ignore the recorded value and use the module constant, so the day anyone
 * raised that constant (the obvious, correct security maintenance) every file a
 * user had already exported would have become permanently undecryptable, and
 * they would have been told "wrong passphrase or corrupted file".
 *
 * There are no accounts here. The exported file is the only copy, and carrying
 * it is the mechanic the product is built around.
 */
describe("the work factor an envelope is read at", () => {
  it("takes the count the file records, so a raised constant cannot orphan it", () => {
    expect(iterationsFor({ kdf: "PBKDF2-SHA256", iterations: 210_000 })).toBe(210_000);
    // The scenario this exists for: a file written before the constant moved.
    expect(iterationsFor({ kdf: "PBKDF2-SHA256", iterations: 120_000 })).toBe(120_000);
    // And after it moves the other way.
    expect(iterationsFor({ kdf: "PBKDF2-SHA256", iterations: 1_000_000 })).toBe(1_000_000);
  });

  it("refuses a count that would freeze the tab, by name", () => {
    // A billion iterations is not a stronger file, it is an unresponsive page —
    // and the message must not say "wrong passphrase", which sends someone to
    // retype something that was right.
    expect(() => iterationsFor({ iterations: 1_000_000_000 })).toThrow(/outside the/);
    expect(() => iterationsFor({ iterations: 1_000_000_000 })).not.toThrow(/passphrase/);
  });

  it("refuses a count too low to have been written by this", () => {
    expect(() => iterationsFor({ iterations: 100 })).toThrow(/outside the/);
    expect(() => iterationsFor({ iterations: 0 })).toThrow(/outside the/);
    expect(() => iterationsFor({ iterations: -1 })).toThrow(/outside the/);
  });

  it("refuses a count that is not a whole number", () => {
    expect(() => iterationsFor({ iterations: 210_000.5 })).toThrow(/whole number/);
    expect(() => iterationsFor({ iterations: "210000" })).toThrow(/whole number/);
    expect(() => iterationsFor({ iterations: NaN })).toThrow(/whole number/);
  });

  it("refuses a key derivation it does not implement", () => {
    // The field is recorded; ignoring it would mean deriving with PBKDF2 from a
    // file that says it used something else, and reporting the mismatch as a
    // wrong passphrase.
    expect(() => iterationsFor({ kdf: "scrypt", iterations: 210_000 })).toThrow(/unsupported/);
  });

  it("falls back to the current constant when the field is absent", () => {
    // Every envelope this has written records one, so an absent field is a
    // hand-edited or truncated file rather than an older format.
    expect(iterationsFor({})).toBe(210_000);
    expect(iterationsFor({ kdf: "PBKDF2-SHA256" })).toBe(210_000);
  });
});

describe("round-tripping a file written at another work factor", () => {
  it("decrypts a file whose recorded count is not today's constant", async () => {
    // The regression this guards: raise the constant, and yesterday's export
    // stops opening. Rewriting the envelope's count simulates exactly that.
    const envelope = await encrypt('{"hello":"world"}', "correct horse battery staple");
    const lowered = JSON.stringify({ ...JSON.parse(envelope), iterations: 150_000 });

    // It must now FAIL, because the ciphertext was produced at 210,000 — which
    // proves the recorded count is genuinely being used to derive the key.
    await expect(decrypt(lowered, "correct horse battery staple")).rejects.toThrow(
      /wrong passphrase or corrupted/,
    );

    // And the untouched envelope still opens.
    await expect(decrypt(envelope, "correct horse battery staple")).resolves.toBe(
      '{"hello":"world"}',
    );
  }, 30_000);

  it("says an unsupported work factor is not a wrong passphrase", async () => {
    const envelope = await encrypt("{}", "pass");
    const absurd = JSON.stringify({ ...JSON.parse(envelope), iterations: 1_000_000_000 });
    await expect(decrypt(absurd, "pass")).rejects.toThrow(/outside the/);
  }, 30_000);
});
