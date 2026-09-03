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
 * A name the machine running this could not look up.
 *
 * `getaddrinfo ENOTFOUND` is reported by Node's fetch and by curl alike, and it
 * is ambiguous in the one way that matters: it says the *local resolver* had no
 * answer, which is usually a dead host and occasionally a broken resolver. See
 * {@link nameResolvesDirectly}, which tells the two apart.
 */
export const NAME_NOT_RESOLVED = /ENOTFOUND|EAI_AGAIN|getaddrinfo/i;

/**
 * A resolver failure the checks must not report as a dead link.
 *
 * `dns.lookup` — what `fetch` and every other client go through — asks the
 * operating system, and the operating system can be wrong on its own: a stale
 * negative cache, a VPN's split-horizon resolver, a sandbox that answers for
 * some names and not others. A direct query does not go through it. When the
 * direct query returns an address for a name `getaddrinfo` refused, the name
 * exists and the machine is the problem.
 *
 * Found on 2026-09-02, when the link sweep reported
 * `www.oregonlegislature.gov` broken — a host whose A record answered on the
 * first ask. Reporting that as broken files an issue asking someone to replace
 * a working citation, which is the exact failure the certificate-chain case was
 * split out to prevent, arriving through a different door.
 */
export async function nameResolvesDirectly(hostname: string): Promise<boolean> {
  const { promises: dns } = await import("node:dns");
  try {
    if ((await dns.resolve4(hostname)).length > 0) return true;
  } catch {
    // No A records, or the query itself failed — an AAAA-only host is still up.
  }
  try {
    return (await dns.resolve6(hostname)).length > 0;
  } catch {
    return false;
  }
}

/** Marker text for the case above, so the pure classifiers can recognize it. */
export const LOCAL_RESOLVER_FAILURE = /\[LOCAL_RESOLVER\]/;

/** Phrase a resolver failure so the report says who is broken: not the link. */
export function describeResolverFailure(hostname: string): string {
  return (
    `the machine running this check could not look up ${hostname}, but a direct ` +
    `DNS query answers for it — the resolver is the problem, not the link [LOCAL_RESOLVER]`
  );
}

/**
 * The resolver-failure phrasing for a transport failure, or null if it is not one.
 *
 * One implementation, because there were nearly two. The diagnosis above landed
 * in the link check on 2026-09-02 and nowhere else, so the three other callers
 * of {@link fetchSource} — the adapter check, the source watch, and the refresh
 * runner — went on reporting a broken resolver as a source that did not answer.
 * On 2026-09-03 the adapter check said `state-ms-income-tax-2024` was
 * unreachable with `getaddrinfo ENOTFOUND www.dor.ms.gov`, on a machine where
 * `dns.resolve4` answers `205.144.237.37` for that exact name and the page
 * returns 200. The report's own rule is that the same adapter unreachable two
 * months running means the source has gone away, so two flakes would have sent
 * somebody to replace a citation that works.
 *
 * That is the failure the certificate case was split out to prevent, arriving
 * through the door beside it — and it has the same fix, for the same reason the
 * comment on the chain repair gives: the diagnosis belongs beside the shared
 * fetch, or the checks go back to disagreeing about the same server.
 */
export async function resolverFailureFor(
  url: string,
  message: string,
  /**
   * How to ask DNS. Injectable so the unit suite can hold both branches without
   * a real query: a test that resolves a live government host is a network test
   * wearing a unit test's clothes, and this repo keeps those on a schedule for
   * the reason that a check failing on somebody else's afternoon is one people
   * learn to ignore. The first version of these tests did exactly that and made
   * the suite flaky.
   */
  resolves: (hostname: string) => Promise<boolean> = nameResolvesDirectly,
): Promise<string | null> {
  if (!NAME_NOT_RESOLVED.test(message)) return null;
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    // Not a URL this can ask DNS about; the raw message is the better answer.
    return null;
  }
  return (await resolves(hostname)) ? describeResolverFailure(hostname) : null;
}

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

/** Present, absent, or nobody answered — three answers, not two. */
export type SourceStatus = "present" | "absent" | "unreached";

/**
 * Does this document exist yet — and if not, is that the agency's answer or
 * nobody's?
 *
 * For an adapter parked on a state's unpublished form, the whole signal is
 * whether a year-carrying URL has started answering. Reading the document is
 * the wrong question and an expensive one — Oregon's OR-40 booklet is 120 kB of
 * PDF that would be text-extracted every month to learn one bit — so this
 * checks the status and never touches the body.
 *
 * **It used to return a boolean, and `false` meant two different things.** "The
 * agency says there is no such document" and "nobody answered" are not the same
 * fact, and the caller needs them apart: the wait probes use this twice, once
 * for the awaited document and once to prove the probe can still see the year
 * that IS published, and a transport failure on the second read as a probe gone
 * permanently blind — an alarm this repo already learned not to raise when
 * Pennsylvania flaked under concurrency and was reported as having stopped
 * anchoring.
 *
 * Only 404 and 410 are an absence. A 403 from a WAF, a 500, a rate limit — none
 * of those is a statement about the document, and reading them as one is how a
 * wait goes blind on an afternoon.
 */
export async function sourceStatus(url: string): Promise<SourceStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchRaw(url, controller.signal);
    if (response.status >= 200 && response.status < 300) return "present";
    return response.status === 404 || response.status === 410 ? "absent" : "unreached";
  } catch {
    // Unreachable is not "published", and it is not "unpublished" either.
    return "unreached";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Everything that came off the wire, before anything decodes it.
 *
 * The split exists so the timeout can end here. See {@link fetchSource}.
 */
export type Transferred =
  | { ok: true; pdf: false; text: string }
  | { ok: true; pdf: true; bytes: Uint8Array }
  | { ok: false; reason: string };

/** Pull the whole body down under the timeout, and stop timing. */
async function transfer(url: string, timeoutMs: number): Promise<Transferred> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchRaw(url, controller.signal);
    if (response.status < 200 || response.status >= 300) {
      return { ok: false, reason: `source returned HTTP ${response.status}` };
    }
    return isPdf(url, response.contentType)
      ? { ok: true, pdf: true, bytes: await response.bytes() }
      : { ok: true, pdf: false, text: await response.text() };
  } catch (error) {
    const described = describeFetchError(error);
    // A name `getaddrinfo` refused is usually a dead host and occasionally a
    // broken resolver, and the two are identical from inside `fetch`. Every
    // caller of this function reports on the same servers, so the question is
    // answered here rather than in one of them.
    const resolver = await resolverFailureFor(url, described);
    return { ok: false, reason: `fetch failed: ${resolver ?? described}` };
  } finally {
    clearTimeout(timer);
  }
}
/* c8 ignore stop */

/** The two halves, injectable so the composition below is testable offline. */
export interface SourceTransport {
  transfer(url: string, timeoutMs: number): Promise<Transferred>;
  decode(bytes: Uint8Array): Promise<string>;
}

const LIVE: SourceTransport = { transfer, decode: pdfToText };

/**
 * Fetch a source page as text, reading PDFs where the figures have moved.
 *
 * **The timeout bounds the transfer and nothing else**, which is why the two
 * halves are separate functions rather than one `try`. They used to share a
 * single `AbortController` — the timer started before the request and was
 * cleared in a `finally` after `pdfToText` had returned — so the thirty seconds
 * budgeted for a government server were being spent, in part, on this machine's
 * own CPU decoding what that server had already sent. When the decode ran long
 * the controller fired mid-work, and the abort surfaced as
 * `could not read the PDF: This operation was aborted`, which the adapter check
 * files under UNREACHABLE: "the page did not come back, or came back declining
 * to serve. This may be transient, and a government site having a bad afternoon
 * is not an adapter defect."
 *
 * Every clause of that is wrong about this failure. The page came back — in a
 * third of a second. Nothing about it was transient in the way the heading
 * means: the trigger is a large PDF decoded while seven other adapters decode
 * theirs, so it fires in the monthly run, where the concurrency is, and never in
 * the dry run somebody does afterwards to see what went wrong. Colorado's
 * Individual Income Tax Guide is 3.2 MB and was the standing case; it reported
 * unreachable while its shard sat unwatched behind a heading that says to wait.
 *
 * Nor could the retry above it help. `fetchTwice` retries a `fetch failed` and
 * deliberately does not retry a page that came back and failed to parse, which
 * is right — and this was neither.
 *
 * So the transfer owns the clock, and the decode runs with nothing pending over
 * it. A PDF that genuinely cannot be read still says so, in the same words.
 */
export async function fetchSource(
  url: string,
  transport: SourceTransport = LIVE,
  timeoutMs: number = TIMEOUT_MS,
): Promise<FetchedSource> {
  const got = await transport.transfer(url, timeoutMs);
  if (!got.ok) return { ok: false, reason: got.reason };
  if (!got.pdf) return { ok: true, raw: got.text };
  try {
    return { ok: true, raw: await transport.decode(got.bytes) };
  } catch (error) {
    // A PDF that cannot be read is a source problem, not a parse problem: say
    // so plainly rather than letting the adapter report "could not anchor".
    return { ok: false, reason: `could not read the PDF: ${describeFetchError(error)}` };
  }
}
