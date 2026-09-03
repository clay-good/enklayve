import { describe, it, expect } from "vitest";
import { fetchSource, type SourceTransport, type Transferred } from "../../scripts/fetch-source";

/**
 * The timeout bounds the transfer, not the decode.
 *
 * `fetchSource` used to start one `AbortController` before the request and
 * clear it in a `finally` that ran after `pdfToText` had returned, so the thirty
 * seconds budgeted for a government server were partly spent decoding what that
 * server had already sent. A large PDF decoded alongside seven others crossed
 * the line, the controller fired mid-decode, and the abort came back as
 * `could not read the PDF: This operation was aborted` — which the adapter
 * check reports as UNREACHABLE, under a heading promising the page did not come
 * back and that this is probably the agency's afternoon.
 *
 * Colorado was the standing case: a 3.2 MB Individual Income Tax Guide that
 * downloads in a third of a second, reported unreachable in the monthly run
 * where the concurrency is and fine in every dry run afterwards. A failure that
 * only appears under load, filed under the one heading that says to wait, is a
 * shard that stops being watched with nobody told.
 *
 * These run offline against an injected transport, because the helpers in
 * `fetch-source` make real DNS and HTTP calls and a suite that reaches the
 * network is a suite that goes flaky.
 */
const PDF: Transferred = { ok: true, pdf: true, bytes: new Uint8Array([1, 2, 3]) };

/** A transport whose transfer is instant and whose decode takes its time. */
function slowDecode(decodeMs: number, transferred: Transferred = PDF): SourceTransport {
  return {
    transfer: (_url, timeoutMs) =>
      new Promise((resolve) => {
        // Honor the budget the caller passed, the way the live one does.
        const timer = setTimeout(
          () => resolve({ ok: false, reason: "fetch failed: timed out" }),
          timeoutMs,
        );
        setTimeout(() => {
          clearTimeout(timer);
          resolve(transferred);
        }, 1);
      }),
    decode: () => new Promise((resolve) => setTimeout(() => resolve("the text"), decodeMs)),
  };
}

describe("fetchSource", () => {
  it("does not spend the transfer's budget on the decode", async () => {
    // The decode alone runs four times the whole budget. Under the old shape the
    // one controller would have fired long before it finished.
    const result = await fetchSource("https://tax.example.gov/guide.pdf", slowDecode(40), 10);
    expect(result).toEqual({ ok: true, raw: "the text" });
  });

  it("still bounds the transfer itself", async () => {
    const stalled: SourceTransport = {
      transfer: (_url, timeoutMs) =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ ok: false, reason: "fetch failed: timed out" }), timeoutMs),
        ),
      decode: async () => "unreached",
    };
    const result = await fetchSource("https://tax.example.gov/guide.pdf", stalled, 5);
    expect(result).toEqual({ ok: false, reason: "fetch failed: timed out" });
  });

  it("still reports a PDF that genuinely cannot be read, in the same words", async () => {
    const broken: SourceTransport = {
      transfer: async () => PDF,
      decode: () => Promise.reject(new Error("Invalid PDF structure")),
    };
    const result = await fetchSource("https://tax.example.gov/guide.pdf", broken, 50);
    expect(result).toEqual({
      ok: false,
      reason: "could not read the PDF: Invalid PDF structure",
    });
  });

  it("passes an HTML body straight through without decoding it", async () => {
    let decoded = false;
    const html: SourceTransport = {
      transfer: async () => ({ ok: true, pdf: false, text: "<p>4.4%</p>" }),
      decode: async () => {
        decoded = true;
        return "";
      },
    };
    const result = await fetchSource("https://tax.example.gov/rates", html, 50);
    expect(result).toEqual({ ok: true, raw: "<p>4.4%</p>" });
    expect(decoded, "an HTML page must never reach the PDF decoder").toBe(false);
  });

  it("reports a transfer failure unchanged, so the retry above it can read it", async () => {
    // check-adapters retries only a reason starting "fetch failed" — a page that
    // came back and failed to parse is not retried on purpose. Rewording here
    // silently disables that retry.
    const refused: SourceTransport = {
      transfer: async () => ({ ok: false, reason: "fetch failed: ECONNRESET" }),
      decode: async () => "",
    };
    const result = await fetchSource("https://tax.example.gov/rates", refused, 50);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason.startsWith("fetch failed")).toBe(true);
  });
});
