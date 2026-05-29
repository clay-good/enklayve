/**
 * Content-integrity helper. Each bundled shard is pinned to a sha256 of its
 * exact bytes in the manifest; the loader recomputes that hash and refuses any
 * shard whose hash no longer matches (BUILD-SPEC.md §7.1). Uses Web Crypto,
 * which is available in the browser, in service workers, and in Node — and is
 * not a network call, so it is allowed under the strict CSP.
 */

/** SHA-256 of a UTF-8 string, as lowercase hex. */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** True when `text` hashes to `expectedHash` (case-insensitive hex). */
export async function verifyHash(text: string, expectedHash: string): Promise<boolean> {
  const actual = await sha256Hex(text);
  return actual === expectedHash.toLowerCase();
}
