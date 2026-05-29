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

const FORMAT_VERSION = 1;
const PBKDF2_ITERATIONS = 210_000;
const enc = new TextEncoder();
const dec = new TextDecoder();

interface PlainFile {
  format: "enklayve.situation";
  version: number;
  snapshot: SituationSnapshot;
}

interface EncryptedEnvelope {
  format: "enklayve.situation.encrypted";
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

/** True when `text` is an encrypted export envelope (needs a passphrase). */
export function isEncrypted(text: string): boolean {
  try {
    return (JSON.parse(text) as { format?: string }).format === "enklayve.situation.encrypted";
  } catch {
    return false;
  }
}

async function deriveKey(passphrase: string, salt: ArrayBuffer): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    toBuffer(enc.encode(passphrase)),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypt a plaintext export under a passphrase, returning the JSON envelope. */
export async function encrypt(plaintext: string, passphrase: string): Promise<string> {
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
    format: "enklayve.situation.encrypted",
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
  const key = await deriveKey(passphrase, base64ToBuffer(envelope.salt));
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

/** Read a chosen file as text. */
export function readFileText(file: File): Promise<string> {
  return file.text();
}
