/**
 * The one way this repo pulls a source page down, shared by the data refresh and
 * the adapter check so they can never disagree about what a source says.
 *
 * Two things it does that a bare `fetch` does not.
 *
 * **It sends a browser user agent.** Government sites increasingly sit behind a
 * WAF that refuses anything else — sometimes with a 403, sometimes with a 200
 * carrying a challenge page, which is worse because it looks like success.
 *
 * **It reads PDFs.** This is the one that matters. Agencies keep moving the
 * figures off HTML pages and into a form or a bulletin: Illinois states its
 * exemption in Informational Bulletin FY 2026-15, Michigan its rate and
 * exemption on page one of Form 446, Maryland its 24 county rates in Withholding
 * Tax Facts, Rhode Island its indexed brackets in an advisory. Every one of
 * those is a PDF, and while the pipeline could only read HTML, every one of
 * those shards was unwatched — which is exactly how Illinois, Michigan, Missouri
 * and Georgia went a year or two stale behind live, correct-looking citations.
 * The app already ships pdf.js to read a user's documents; the same library
 * reads the government's.
 *
 * Extracted PDF text is joined with newlines per page and single spaces within a
 * line, so the adapters' patterns see roughly what they would see in prose. It
 * is not a layout-faithful rendering and is not meant to be: a parser that needs
 * table geometry is a parser that should be a reviewer step instead.
 */
import { BROWSER_USER_AGENT } from "./user-agent.ts";
import { repairedCaBundle, requestWithChain } from "./chain-repair.ts";

export type FetchedSource = { ok: true; raw: string } | { ok: false; reason: string };

const TIMEOUT_MS = 30_000;

/**
 * A TLS chain the server did not serve completely — and *only* that.
 *
 * Several state revenue sites omit the intermediate certificate that signed
 * their leaf. GlobalSign's root is in Node's store; an intermediate never is.
 * A browser and curl close the gap by following the leaf's AIA pointer and
 * fetching the missing certificate, `chain-repair.ts` now does the same, and
 * where it cannot, the page is still fine in a browser — so a reader must not
 * be sent to replace a working link.
 *
 * The narrowness is the point, and it was learned the hard way: this pattern
 * used to be `/certificate|CERT_|self[- ]signed|SSL|TLS/i`, which also matched
 * an EXPIRED certificate, a hostname mismatch, and a self-signed one. Those
 * three were reported under a heading reading "the page itself is almost
 * certainly fine — open it in a browser before replacing it", and a browser
 * shows every one of them a full-page interstitial. DC Health Link's
 * certificate had expired when this was found. See {@link BAD_CERTIFICATE}.
 */
export const INCOMPLETE_CERT_CHAIN =
  /UNABLE_TO_VERIFY_LEAF_SIGNATURE|unable to verify the first certificate|unable to get local issuer certificate/i;

/**
 * A certificate a browser refuses too: expired, issued for another hostname, or
 * signed by nothing anyone trusts. A cited source behind one of these is not
 * reachable by the reader either, which makes it a broken link rather than a
 * quirk of Node's trust store — the opposite of {@link INCOMPLETE_CERT_CHAIN},
 * and the distinction the report has to make so a person knows whether to wait,
 * to replace the URL, or to tell the agency its certificate lapsed.
 */
export const BAD_CERTIFICATE =
  /CERT_HAS_EXPIRED|certificate has expired|ERR_TLS_CERT_ALTNAME_INVALID|does not match certificate|SELF_SIGNED_CERT|self[- ]signed certificate/i;

/**
 * Say what actually went wrong.
 *
 * Node's `fetch` reports every transport failure as the same four words —
 * `TypeError: fetch failed` — and puts the reason in `cause`, one or more links
 * down. Unwrapped, Mississippi's adapter reported "fetch failed: fetch failed"
 * every month, which named neither the problem nor anyone who could fix it,
 * while the link check on the same server said "unable to verify the first
 * certificate" and suggested the flag that repairs it. The distinction between
 * an afternoon and a wall is in the cause chain, so read it.
 */
export function describeFetchError(error: unknown): string {
  const seen = new Set<unknown>();
  const messages: string[] = [];
  let current: unknown = error;
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    const code = (current as { code?: string }).code;
    const text = code ? `${current.message} [${code}]` : current.message;
    if (text && text !== messages[messages.length - 1]) messages.push(text);
    current = current.cause;
  }
  // "fetch failed" is Node's wrapper, not a reason. Drop it when something
  // below it in the chain says more, and keep it when it is all there is.
  const reasons = messages.filter((m) => m !== "fetch failed");
  return (reasons.length > 0 ? reasons : messages).join(": ") || String(error);
}

/** Does this response carry a PDF rather than markup? */
export function isPdf(url: string, contentType: string | null): boolean {
  if (contentType && /application\/pdf/i.test(contentType)) return true;
  // Some servers send application/octet-stream for a .pdf path.
  return /\.pdf(\?|#|$)/i.test(url);
}

/** Extract the visible text of a PDF, page by page. */
export async function pdfToText(bytes: Uint8Array): Promise<string> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // verbosity 0: pdf.js writes font and structure warnings to the console for
  // perfectly readable government PDFs, and this function's output is a report
  // a person reads. Warnings would bury the finding.
  const doc = await getDocument({ data: bytes, useSystemFonts: true, verbosity: 0 }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    const text = content.items
      .map((item) => {
        const i = item as { str?: string; hasEOL?: boolean };
        return (i.str ?? "") + (i.hasEOL ? "\n" : "");
      })
      .join("");
    pages.push(text);
  }
  return pages.join("\n");
}

/** What a fetch returned, whichever transport carried it. */
interface RawResponse {
  status: number;
  contentType: string | null;
  bytes: () => Promise<Uint8Array>;
  text: () => Promise<string>;
}

/* c8 ignore start -- network */

/**
 * Get the page, repairing an incomplete certificate chain if that is what
 * stands in the way. Every other failure is thrown on unchanged: a repair
 * attempt on a host that is simply down would turn one clear reason into two
 * vague ones.
 */
async function fetchRaw(url: string, signal: AbortSignal): Promise<RawResponse> {
  try {
    const response = await fetch(url, { headers: { "user-agent": BROWSER_USER_AGENT }, signal });
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      bytes: async () => new Uint8Array(await response.arrayBuffer()),
      text: () => response.text(),
    };
  } catch (error) {
    const reason = describeFetchError(error);
    if (!INCOMPLETE_CERT_CHAIN.test(reason)) throw error;
    const ca = await repairedCaBundle(new URL(url).hostname);
    if (!ca) throw error;
    const repaired = await requestWithChain(url, {
      headers: { "user-agent": BROWSER_USER_AGENT },
      ca,
      timeoutMs: TIMEOUT_MS,
      // `fetch` follows redirects, so this transport must too, or a repaired
      // host that moves a page starts reporting "HTTP 301" for a page that is
      // there. Only the link check wants a redirect left unfollowed.
      followRedirects: 5,
    });
    const contentType = repaired.headers["content-type"];
    return {
      status: repaired.status,
      contentType: Array.isArray(contentType) ? (contentType[0] ?? null) : (contentType ?? null),
      bytes: async () => new Uint8Array(repaired.body),
      text: async () => repaired.body.toString("utf8"),
    };
  }
}

/** Fetch a source page as text, reading PDFs where the figures have moved. */
export async function fetchSource(url: string): Promise<FetchedSource> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchRaw(url, controller.signal);
    if (response.status < 200 || response.status >= 300) {
      return { ok: false, reason: `source returned HTTP ${response.status}` };
    }
    if (!isPdf(url, response.contentType)) return { ok: true, raw: await response.text() };
    try {
      return { ok: true, raw: await pdfToText(await response.bytes()) };
    } catch (error) {
      // A PDF that cannot be read is a source problem, not a parse problem: say
      // so plainly rather than letting the adapter report "could not anchor".
      return { ok: false, reason: `could not read the PDF: ${describeFetchError(error)}` };
    }
  } catch (error) {
    return { ok: false, reason: `fetch failed: ${describeFetchError(error)}` };
  } finally {
    clearTimeout(timer);
  }
}
/* c8 ignore stop */
