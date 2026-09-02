import { describe, it, expect } from "vitest";
import { describeResolverFailure, nameResolvesDirectly } from "../../scripts/fetch-source";
import {
  classify,
  awaitedUrls,
  extractUrls,
  renderLinkReport,
  sourceFiles,
  type LinkResult,
} from "../../scripts/check-links";
import { ADAPTERS } from "../../scripts/refresh/adapters";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The external-link check (SPEC §2 principle 5, SPEC-3 §3).
 *
 * The site's whole trust model is that every rule links its source, so the
 * failure this guards against is not only a 404 — it is a redirect to the wrong
 * page. Agencies reuse article ids: the CFPB's "what does it mean to refinance
 * my mortgage" URL redirected to an article about USDA rural housing loans, and
 * "what is a balance transfer" to one about mortgage payment calculations. A
 * reader following either landed somewhere plausible, authoritative, and
 * unrelated. Both are fixed; this is what stops them coming back unnoticed.
 */
const ROOT = resolve(__dirname, "..", "..");

function result(over: Partial<LinkResult>): LinkResult {
  return { url: "https://example.test/a", status: 200, detail: "", files: ["src/x.ts"], ...over };
}

describe("finding the links the site ships", () => {
  it("pulls a URL out of code, data, and prose alike", () => {
    expect(extractUrls('const u = "https://www.irs.gov/pub/a.pdf";')).toEqual([
      "https://www.irs.gov/pub/a.pdf",
    ]);
    expect(extractUrls('"sourceUrl": "https://www.ssa.gov/survivor",')).toEqual([
      "https://www.ssa.gov/survivor",
    ]);
  });

  it("stops a URL where a markdown link closes and the next one opens", () => {
    // The CI badge: `[![CI](…/badge.svg)](…/ci.yml)`. Both `)` and `[` are legal
    // in a path, so the match ran through `)](` into the second URL and checked
    // neither of them. The README was outside the sweep when this was written,
    // which is why nobody had seen it.
    expect(
      extractUrls(
        "[![CI](https://github.com/o/r/actions/workflows/ci.yml/badge.svg)](https://github.com/o/r/actions/workflows/ci.yml)",
      ),
    ).toEqual(["https://github.com/o/r/actions/workflows/ci.yml/badge.svg"]);
  });

  it("trims markdown emphasis the way it trims a sentence's period", () => {
    expect(extractUrls("**[Report](https://github.com/o/r/security/advisories/new)**")).toEqual([
      "https://github.com/o/r/security/advisories/new",
    ]);
    expect(extractUrls("**see https://www.irs.gov/pub/a.pdf**")).toEqual([
      "https://www.irs.gov/pub/a.pdf",
    ]);
  });

  it("still keeps the parentheses a federal citation puts in a path", () => {
    expect(extractUrls('"https://www.ecfr.gov/current/title-26/section-1.401(a)(9)-9"')).toEqual([
      "https://www.ecfr.gov/current/title-26/section-1.401(a)(9)-9",
    ]);
  });

  it("trims the punctuation a URL picks up at the end of a sentence", () => {
    expect(extractUrls("See https://www.cms.gov/medical-bill-rights.")).toEqual([
      "https://www.cms.gov/medical-bill-rights",
    ]);
  });

  it("skips a template literal, which would 404 forever as a truncated URL", () => {
    // `.../about-form-1099-${variant}` matches up to the `$`; the `{` after it
    // is what identifies it, since `$` is legal in a URL.
    expect(
      extractUrls("`https://www.irs.gov/forms-pubs/about-form-1099-${variant.toLowerCase()}`"),
    ).toEqual([]);
  });

  it("skips fixture hosts and our own site", () => {
    // `.invalid` is the reserved TLD, used by the boundary-classify probe for a
    // source URL that must never resolve. It was reported as a broken link every
    // run, which is a monthly red on a check whose whole value is that red means
    // something.
    expect(
      extractUrls("https://example.gov/a https://enklayve.com/b https://example.invalid/probe"),
    ).toEqual([]);
  });

  it("keeps the parentheses a federal citation puts in its path", () => {
    // The eCFR states a Treasury regulation as `.../section-1.401(a)(9)-9`. The
    // pattern used to stop at the `(`, so the truncated `.../section-1.401` was
    // checked and reported broken every month — a reader sent to repair a URL
    // that works, while the URL actually shipped went unchecked.
    expect(
      extractUrls(
        '"url": "https://www.ecfr.gov/current/title-26/chapter-I/subchapter-A/part-1/section-1.401(a)(9)-9",',
      ),
    ).toEqual([
      "https://www.ecfr.gov/current/title-26/chapter-I/subchapter-A/part-1/section-1.401(a)(9)-9",
    ]);
  });

  it("still drops the bracket that wraps a URL rather than belonging to it", () => {
    expect(extractUrls("(see https://www.irs.gov/pub/a.pdf)")).toEqual([
      "https://www.irs.gov/pub/a.pdf",
    ]);
    expect(extractUrls("[the form](https://www.irs.gov/pub/b.pdf)")).toEqual([
      "https://www.irs.gov/pub/b.pdf",
    ]);
  });

  it("does not check a URL an adapter has declared does not exist yet", () => {
    // Oregon's adapter names the year-carrying booklet URL it is waiting for.
    // That URL 404ing is the signal, not a defect, and the adapter check is what
    // watches it. Derived from the adapters so it cannot drift out of date.
    const url = "https://www.oregon.gov/dor/forms/FormsPubs/form-or-40-inst_101-040-1_2026.pdf";
    expect(awaitedUrls([{ awaiting: { arrived: { url } } }]).has(url)).toBe(true);
    expect(awaitedUrls([{}]).size).toBe(0);
    expect(awaitedUrls(ADAPTERS).size).toBeGreaterThan(0);
  });

  it("walks the real source tree and finds the links actually shipped", () => {
    const files = sourceFiles(ROOT);
    expect(files.length).toBeGreaterThan(50);
    const urls = new Set(files.flatMap((f) => extractUrls(readFileSync(f, "utf8"))));
    expect(urls.size).toBeGreaterThan(100);
    for (const u of urls) expect(u.startsWith("https://")).toBe(true);
  });
});

describe("classifying a checked link", () => {
  it("passes a 200 and fails a 404", () => {
    expect(classify({ status: 200, detail: "" })).toBe("ok");
    expect(classify({ status: 404, detail: "" })).toBe("broken");
    expect(classify({ status: 500, detail: "" })).toBe("broken");
  });

  it("does not treat a redirect as a pass", () => {
    // A permanent redirect means the canonical URL moved. Following it silently
    // is how a link ends up pointing at a page nobody checked.
    expect(classify({ status: 301, detail: "/elsewhere" })).toBe("redirect");
    expect(classify({ status: 302, detail: "/elsewhere" })).toBe("redirect");
  });

  it("separates an incomplete certificate chain from a dead link", () => {
    // Several state revenue sites omit an intermediate; browsers repair it and
    // Node does not. The page works, so reporting it as broken would send
    // someone to replace a link that is fine.
    expect(classify({ status: 0, detail: "Error: unable to verify the first certificate" })).toBe(
      "unreachable",
    );
    // Everything else at status 0 really is a broken link.
    expect(classify({ status: 0, detail: "getaddrinfo ENOTFOUND nowhere.test" })).toBe("broken");
    expect(classify({ status: 0, detail: "connect ECONNREFUSED" })).toBe("broken");
  });

  it("separates a name THIS MACHINE could not look up from a name that is gone", () => {
    // `getaddrinfo` asks the operating system, which can be wrong on its own: a
    // stale negative cache, a VPN's resolver, a sandboxed runner. On 2026-09-02
    // the sweep reported www.oregonlegislature.gov broken, and its A record
    // answered on the first direct ask. Filing that as a dead link asks somebody
    // to go replace a working citation.
    expect(
      classify({ status: 0, detail: describeResolverFailure("www.oregonlegislature.gov") }),
    ).toBe("unreachable");
    // A name with no records anywhere is still a dead link, and the marker is
    // the whole difference — the raw ENOTFOUND above stays broken.
    expect(classify({ status: 0, detail: "getaddrinfo ENOTFOUND gone.test" })).toBe("broken");
  });

  it("asks DNS directly, so the two cases can actually be told apart", async () => {
    // The distinction is only worth drawing if something can draw it. A reserved
    // name resolves nowhere by definition (RFC 2606), and this repo already uses
    // `.invalid` for exactly that.
    expect(await nameResolvesDirectly("no-such-host.example.invalid")).toBe(false);
  });

  it("calls a certificate a browser also refuses a broken link", () => {
    // This pattern used to be /certificate|CERT_|self[- ]signed|SSL|TLS/i, which
    // swept up three failures that are nothing like a missing intermediate and
    // filed them under a heading reading "the page itself is almost certainly
    // fine — open it in a browser before replacing it". A browser shows every
    // one of them a full-page interstitial: the reader never sees the page.
    // DC Health Link's certificate had expired when this was found.
    expect(classify({ status: 0, detail: "certificate has expired [CERT_HAS_EXPIRED]" })).toBe(
      "broken",
    );
    expect(
      classify({
        status: 0,
        detail:
          "Hostname/IP does not match certificate's altnames: Host: a.test. is not in the cert's" +
          " altnames: DNS:b.test [ERR_TLS_CERT_ALTNAME_INVALID]",
      }),
    ).toBe("broken");
    expect(
      classify({ status: 0, detail: "self-signed certificate [DEPTH_ZERO_SELF_SIGNED_CERT]" }),
    ).toBe("broken");
    expect(
      classify({
        status: 0,
        detail: "self-signed certificate in certificate chain [SELF_SIGNED_CERT_IN_CHAIN]",
      }),
    ).toBe("broken");
    // And the repairable one is still not a broken link.
    expect(
      classify({
        status: 0,
        detail: "unable to verify the first certificate [UNABLE_TO_VERIFY_LEAF_SIGNATURE]",
      }),
    ).toBe("unreachable");
    expect(classify({ status: 0, detail: "unable to get local issuer certificate" })).toBe(
      "unreachable",
    );
  });
});

describe("the report a person reads", () => {
  it("says so plainly when every link resolves directly", () => {
    const report = renderLinkReport([result({}), result({ url: "https://example.test/b" })]);
    expect(report).toContain("2 ok");
    expect(report).toContain("Every link resolves directly");
  });

  it("names the files a broken link lives in, so a fix has somewhere to go", () => {
    const report = renderLinkReport([
      result({ url: "https://gone.test/x", status: 404, files: ["src/tiles/a.ts", "data/b.json"] }),
    ]);
    expect(report).toContain("## Broken");
    expect(report).toContain("https://gone.test/x");
    expect(report).toContain("src/tiles/a.ts, data/b.json");
  });

  it("warns that a redirect destination may not be what the link promised", () => {
    const report = renderLinkReport([
      result({ url: "https://moved.test/x", status: 301, detail: "/somewhere-else" }),
    ]);
    expect(report).toContain("## Redirected");
    expect(report).toContain("reuses article ids");
    expect(report).toContain("→ /somewhere-else");
  });

  it("puts a certificate failure in its own section, not among the broken links", () => {
    const report = renderLinkReport([
      result({
        url: "https://badchain.test/x",
        status: 0,
        detail: "unable to verify the first certificate",
      }),
    ]);
    expect(report).toContain("## Unreachable");
    expect(report).not.toContain("## Broken");
    expect(report).toContain("open it in a browser before replacing it");
  });

  it("puts a local resolver failure there too, and says which of the two it is", () => {
    // The section carries two causes now, so the heading has to name both — a
    // reader told "the server did not serve a complete certificate chain" about
    // a DNS failure would go looking for a certificate that is perfectly fine.
    const report = renderLinkReport([
      result({
        url: "https://www.oregonlegislature.gov/x",
        status: 0,
        detail: describeResolverFailure("www.oregonlegislature.gov"),
      }),
    ]);
    expect(report).toContain("## Unreachable");
    expect(report).not.toContain("## Broken");
    expect(report).toContain("a direct DNS query answers for it");
    expect(report).toContain("could not look up www.oregonlegislature.gov");
  });

  it("tells the reader a refused certificate is not a URL to replace", () => {
    const report = renderLinkReport([
      result({
        url: "https://lapsed.test/x",
        status: 0,
        detail: "certificate has expired [CERT_HAS_EXPIRED]",
      }),
    ]);
    expect(report).toContain("## Broken");
    expect(report).not.toContain("## Unreachable");
    expect(report).toContain("a browser refuses too");
    // The remedy is different from a 404's, so the report has to say which.
    expect(report).toContain("the agency's to renew");
  });

  it("does not lecture about certificates when no link has one", () => {
    const report = renderLinkReport([result({ url: "https://gone.test/x", status: 404 })]);
    expect(report).toContain("## Broken");
    expect(report).not.toContain("a browser refuses too");
  });
});
