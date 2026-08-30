/**
 * Portable, user-held profile export/import (BUILD-SPEC-2 §3.2, §5.2).
 *
 * The user may export My Situation to a local file they keep and re-import it
 * later. The export can be passphrase-encrypted on the device, reusing the
 * encryptalotta technique: PBKDF2 → AES-GCM, all via Web Crypto, which is a
 * local computation and therefore allowed under the strict `connect-src 'none'`
 * CSP. The product never writes the profile to storage and never sends it
 * anywhere — the user holds the only copy.
 */
import { SituationStore, type SituationSnapshot } from "./situation";
import { MAX_DOCUMENT_BYTES, tooLargeMessage } from "../readout/extractText";

const FORMAT_VERSION = 1;
const PBKDF2_ITERATIONS = 210_000;

/**
 * The iteration counts a file may ask this to run.
 *
 * The envelope records `iterations` because the number is meant to rise: OWASP's
 * PBKDF2-SHA256 guidance goes up as hardware does, and 210,000 is a figure from
 * one revision of it. Reading used to ignore the recorded value and use the
 * constant, which meant the day anyone raised the constant — the obvious, correct
 * security maintenance — **every file a user had already exported became
 * permanently undecryptable**, reported to them as "wrong passphrase or corrupted
 * file". There are no accounts here; the exported file is the only copy, and this
 * is the mechanic the product tells people to carry. So the recorded value is
 * honored.
 *
 * It is honored inside bounds, because it arrives in a file. A count of a
 * billion is not a stronger file, it is a frozen tab, and one of a hundred is a
 * file that was not written by this. Both are refused by name, so neither is
 * reported as a wrong passphrase.
 */
const MIN_ITERATIONS = 100_000;
const MAX_ITERATIONS = 5_000_000;
const enc = new TextEncoder();
const dec = new TextDecoder();

interface PlainFile {
  format: "enklayve.situation";
  version: number;
  snapshot: SituationSnapshot;
}

/** The format ids the encrypted envelope may carry. A ledger snapshot reuses
 * this exact envelope — same KDF, same cipher, same iteration count — under its
 * own id, so there is one piece of crypto in the codebase rather than two. */
export type EncryptedFormat = "enklayve.situation.encrypted" | "enklayve.ledger.encrypted";

interface EncryptedEnvelope {
  format: EncryptedFormat;
  version: number;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Decode base64 into a fresh ArrayBuffer (a non-shared BufferSource for WebCrypto). */
function base64ToBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const buf = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
  return buf;
}

/** Copy any view into a fresh ArrayBuffer so WebCrypto sees a non-shared buffer. */
function toBuffer(view: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(view.byteLength);
  new Uint8Array(buf).set(view);
  return buf;
}

/** Serialize the current profile to a plain JSON string. */
export function serialize(store: SituationStore): string {
  const file: PlainFile = {
    format: "enklayve.situation",
    version: FORMAT_VERSION,
    snapshot: store.snapshot(),
  };
  return JSON.stringify(file, null, 2);
}

/** True when `text` is an encrypted export envelope (needs a passphrase).
 * `format` narrows it to one kind of export; omitted, any encrypted envelope
 * matches, which is what the Readout dropzone wants before it knows which. */
export function isEncrypted(text: string, format?: EncryptedFormat): boolean {
  try {
    const actual = (JSON.parse(text) as { format?: string }).format;
    if (format) return actual === format;
    return actual === "enklayve.situation.encrypted" || actual === "enklayve.ledger.encrypted";
  } catch {
    return false;
  }
}

async function deriveKey(
  passphrase: string,
  salt: ArrayBuffer,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    toBuffer(enc.encode(passphrase)),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * The work factor to run for this envelope, or a refusal naming why.
 *
 * A file with no `iterations` at all is read at the current constant: every
 * envelope this has ever written records one, so an absent field is a
 * hand-edited or truncated file rather than an older format, and the constant
 * is the only defensible guess.
 */
export function iterationsFor(envelope: { kdf?: string; iterations?: unknown }): number {
  if (envelope.kdf !== undefined && envelope.kdf !== "PBKDF2-SHA256") {
    throw new Error(`this file uses an unsupported key derivation (${envelope.kdf})`);
  }
  const raw = envelope.iterations;
  if (raw === undefined || raw === null) return PBKDF2_ITERATIONS;
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    throw new Error("this file's iteration count is not a whole number");
  }
  if (raw < MIN_ITERATIONS || raw > MAX_ITERATIONS) {
    throw new Error(
      `this file asks for ${raw.toLocaleString("en-US")} PBKDF2 iterations, outside the ` +
        `${MIN_ITERATIONS.toLocaleString("en-US")}–${MAX_ITERATIONS.toLocaleString("en-US")} ` +
        "this will run",
    );
  }
  return raw;
}

/** Encrypt a plaintext export under a passphrase, returning the JSON envelope. */
export async function encrypt(
  plaintext: string,
  passphrase: string,
  format: EncryptedFormat = "enklayve.situation.encrypted",
): Promise<string> {
  if (!passphrase) throw new Error("a passphrase is required to encrypt the profile");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, toBuffer(salt));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toBuffer(iv) },
    key,
    toBuffer(enc.encode(plaintext)),
  );
  const envelope: EncryptedEnvelope = {
    format,
    version: FORMAT_VERSION,
    kdf: "PBKDF2-SHA256",
    iterations: PBKDF2_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ct)),
  };
  return JSON.stringify(envelope);
}

/** Decrypt an envelope produced by {@link encrypt}. Throws on a wrong passphrase. */
export async function decrypt(envelopeText: string, passphrase: string): Promise<string> {
  const envelope = JSON.parse(envelopeText) as EncryptedEnvelope;
  // Outside the try: an unsupported work factor is not a wrong passphrase, and
  // must not be reported as one.
  const iterations = iterationsFor(envelope);
  const key = await deriveKey(passphrase, base64ToBuffer(envelope.salt), iterations);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBuffer(envelope.iv) },
      key,
      base64ToBuffer(envelope.ciphertext),
    );
    return dec.decode(plain);
  } catch {
    throw new Error("could not decrypt, wrong passphrase or corrupted file");
  }
}

/**
 * Produce the file content to export: a plain JSON profile, or an encrypted
 * envelope when a passphrase is supplied.
 */
export async function exportProfile(store: SituationStore, passphrase?: string): Promise<string> {
  const plain = serialize(store);
  return passphrase ? encrypt(plain, passphrase) : plain;
}

function loadPlain(store: SituationStore, text: string): void {
  const parsed = JSON.parse(text) as Partial<PlainFile>;
  if (parsed.format !== "enklayve.situation" || !parsed.snapshot) {
    throw new Error("not a valid enklayve profile file");
  }
  store.load(parsed.snapshot);
}

/**
 * Import a profile file into the store. Detects an encrypted envelope and
 * requires the passphrase; a plain file is loaded directly.
 */
export async function importProfile(
  store: SituationStore,
  fileContent: string,
  passphrase?: string,
): Promise<void> {
  if (isEncrypted(fileContent)) {
    if (!passphrase) throw new Error("this profile is encrypted, a passphrase is required");
    loadPlain(store, await decrypt(fileContent, passphrase));
    return;
  }
  loadPlain(store, fileContent);
}

/** Trigger a browser download of the export (no-op-safe outside the browser). */
export function triggerDownload(filename: string, content: string): void {
  if (typeof URL.createObjectURL !== "function") return;
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Read a chosen file as text.
 *
 * The same ceiling the document reader uses, for the same reason: this runs in
 * the tab, so a file large enough takes the page down before any of the three
 * restore paths gets to say the file is not one of ours. A saved situation is
 * kilobytes; nothing legitimate comes near the limit.
 */
export function readFileText(file: File): Promise<string> {
  if (file.size > MAX_DOCUMENT_BYTES) return Promise.reject(new Error(tooLargeMessage(file.size)));
  return file.text();
}
