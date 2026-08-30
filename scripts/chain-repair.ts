/**
 * Fetching from a server that does not serve its whole certificate chain.
 *
 * Mississippi's Department of Information Technology Services runs every
 * `*.ms.gov` host — Revenue, the Legislature, all of them — and every one of
 * them presents exactly one certificate: the leaf, with the GlobalSign
 * intermediate that signed it left out. GlobalSign's *root* is in Node's store;
 * an intermediate never is, and never should be. A browser and curl repair the
 * gap by following the leaf's Authority Information Access extension to the
 * missing certificate and fetching it. Node's `fetch` does not, so it refuses
 * with "unable to verify the first certificate" and the whole state is
 * unreachable from this pipeline.
 *
 * That is not a cosmetic problem here. Mississippi's rate steps down by statute
 * every year — 4.4% for 2025, 4% for 2026, 3.75% for 2027 — so its shard is one
 * of the ones that most needs watching, and there is no other host to point at.
 *
 * So this does what the browser does, and nothing looser. The security-critical
 * line is that a fetched intermediate is **not** taken on faith: it is trusted
 * only if a certificate already in Node's root store signed it, which is the
 * ordinary condition every other chain has to meet. The unverified connection
 * exists solely to read the leaf's AIA pointer; nothing it returns is used as
 * data, and the request that carries the page is verified in full, hostname
 * included, against the repaired bundle.
 */
import tls from "node:tls";
import { request as httpsRequest } from "node:https";
import { X509Certificate } from "node:crypto";

/**
 * The URL of the certificate that signed this one, out of the leaf's Authority
 * Information Access extension. Node renders that extension as lines; the OCSP
 * responder sits on one of the others and is not what we want.
 */
export function caIssuerUrl(infoAccess: string | undefined): string | undefined {
  const match = /^CA Issuers - URI:(\S+)$/m.exec(infoAccess ?? "");
  return match?.[1];
}

/**
 * Is this fetched certificate one we may add to the trust bundle?
 *
 * Only if a certificate already in the root store issued it. Skipping this
 * check would be the whole vulnerability: the bundle's members are trust
 * anchors, so accepting whatever the leaf's AIA pointed at would let anyone who
 * can answer that connection mint a certificate this pipeline believes. Both
 * halves are required — the names must line up *and* the signature must verify,
 * since a subject line is only a claim.
 */
export function trustedIssuer(
  candidate: X509Certificate,
  roots: readonly X509Certificate[],
): X509Certificate | undefined {
  return roots.find((root) => {
    if (root.subject !== candidate.issuer) return false;
    try {
      return candidate.verify(root.publicKey);
    } catch {
      return false;
    }
  });
}

/* c8 ignore start -- network + TLS */

const ROOTS: X509Certificate[] = tls.rootCertificates.map((pem) => new X509Certificate(pem));

/** The leaf a host presents, read over a connection whose answer we never use. */
async function peerLeaf(host: string, timeoutMs: number): Promise<X509Certificate | undefined> {
  return new Promise((resolve) => {
    const socket = tls.connect(
      { host, port: 443, servername: host, rejectUnauthorized: false, timeout: timeoutMs },
      () => {
        const leaf = socket.getPeerX509Certificate();
        socket.destroy();
        resolve(leaf);
      },
    );
    socket.on("timeout", () => {
      socket.destroy();
      resolve(undefined);
    });
    socket.on("error", () => resolve(undefined));
  });
}

/** Hosts already repaired (or already known unrepairable), so one run asks once. */
const cache = new Map<string, string[] | undefined>();

/**
 * Node's roots plus the intermediate this host forgot to send, or `undefined`
 * when the gap is not one AIA can close — no pointer, an unreachable one, or a
 * certificate no trusted root signed.
 */
export async function repairedCaBundle(
  host: string,
  timeoutMs = 15_000,
): Promise<string[] | undefined> {
  if (cache.has(host)) return cache.get(host);
  const bundle = await buildBundle(host, timeoutMs);
  cache.set(host, bundle);
  return bundle;
}

async function buildBundle(host: string, timeoutMs: number): Promise<string[] | undefined> {
  const leaf = await peerLeaf(host, timeoutMs);
  const url = caIssuerUrl(leaf?.infoAccess);
  if (!url) return undefined;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return undefined;
    const candidate = new X509Certificate(Buffer.from(await response.arrayBuffer()));
    if (!trustedIssuer(candidate, ROOTS)) return undefined;
    // The fetched certificate must also be the one that signed this leaf,
    // rather than any certificate the same root happens to have issued.
    if (!leaf?.verify(candidate.publicKey)) return undefined;
    return [...tls.rootCertificates, candidate.toString()];
  } catch {
    return undefined;
  }
}
/* c8 ignore stop */

/** What a repaired request came back with. Redirects are never followed. */
export interface ChainRepairedResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

/**
 * The same request again, against a bundle carrying the intermediate the server
 * omitted. `node:https` is used rather than `fetch` only because it takes a
 * `ca`; verification is not relaxed anywhere, and this runs only once a chain
 * failure has already been diagnosed.
 */
export function requestWithChain(
  url: string,
  options: { method?: string; headers?: Record<string, string>; ca: string[]; timeoutMs?: number },
): Promise<ChainRepairedResponse> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        host: target.hostname,
        path: `${target.pathname}${target.search}`,
        method: options.method ?? "GET",
        headers: options.headers,
        ca: options.ca,
        timeout: options.timeoutMs ?? 30_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
    req.end();
  });
}
