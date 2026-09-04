import { describe, it, expect } from "vitest";
import {
  describeResolverFailure,
  nameResolvesDirectly,
  resolverFailureFor,
} from "../../scripts/fetch-source";
import {
  check,
  classify,
  awaitedUrls,
  extractUrls,
  renderLinkReport,
  sourceFiles,
  type LinkResult,
  type Request,
} from "../../scripts/check-links";
import { ADAPTERS } from "../../scripts/refresh/adapters";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, relative } from "node:path";

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
  it("treats the reserved .example TLD as a fixture, not a citation", () => {
    // RFC 2606 §2 reserves `.example` exactly as it reserves `.invalid`, and
    // the pattern here already knew about `example.invalid`. A usage line
    // reading `npm run check:live -- https://staging.example` is not shipping a
    // source link, and on 2026-09-03 the sweep reported two of them broken —
    // asking a person to go repair a hostname reserved never to resolve.
    expect(extractUrls("see https://staging.example for a dry run")).toEqual([]);
    expect(extractUrls("see https://foo.bar.example/path here")).toEqual([]);
    // A real host that merely starts the same way is still checked.
    expect(extractUrls("https://example.gov/a")).toEqual([]);
    expect(extractUrls("https://exampled.gov/a")).toEqual(["https://exampled.gov/a"]);
    expect(extractUrls("https://www.irs.gov/a")).toEqual(["https://www.irs.gov/a"]);
  });

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

  it("sweeps EVERY markdown file in the repository root, not a list of three", () => {
    // The root is not walked, because walking it descends into node_modules and
    // dist — so it was three filenames, and a list is a promise someone has to
    // remember to keep. CODE_OF_CONDUCT.md arrived on 2026-09-02 carrying five
    // external links, the sweep went on reporting the same 240, and four of
    // those five turned out to be redirects the moment it could see them.
    const swept = new Set(sourceFiles(ROOT).map((f) => relative(ROOT, f)));
    const rootMarkdown = readdirSync(ROOT).filter((n) => n.endsWith(".md"));
    expect(rootMarkdown.length).toBeGreaterThan(3);
    for (const name of rootMarkdown) {
      expect(swept, `${name} sits in the root and nothing checks its links`).toContain(name);
    }
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

  it("separates a server that refused THIS CLIENT from a page that is gone", () => {
    // NAIC's consumer life-insurance page — cited by the Life Insurance tile —
    // answered 403 to this sweep on 2026-09-03 and rendered perfectly in a
    // browser the same minute. An agency turned on bot protection; nothing
    // about the page changed. Reporting that as broken is the one answer these
    // checks must never give, and the repo's other fetch already knew it:
    // `sourceStatus` has always held that only a 404 or a 410 is an absence.
    expect(classify({ status: 403, detail: "" })).toBe("unreachable");
    expect(classify({ status: 401, detail: "" })).toBe("unreachable");
    expect(classify({ status: 429, detail: "" })).toBe("unreachable");
    // The statuses that describe the *document* stay broken. So does a 5xx: a
    // page erroring for everyone is a page the reader does not get either.
    expect(classify({ status: 404, detail: "" })).toBe("broken");
    expect(classify({ status: 410, detail: "" })).toBe("broken");
    expect(classify({ status: 503, detail: "" })).toBe("broken");
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

  /**
   * One diagnosis, shared by every caller of the fetch.
   *
   * `resolverFailureFor` exists because there were nearly two of these. The
   * diagnosis landed in this check on 2026-09-02 and nowhere else, so the three
   * other callers of `fetchSource` — the adapter check, the source watch, the
   * refresh runner — kept reporting a broken resolver as a source that did not
   * answer. On 2026-09-03 the adapter check called Mississippi's shard
   * unreachable with `getaddrinfo ENOTFOUND www.dor.ms.gov`, on a machine where
   * `dns.resolve4` answers for that exact name and the page returns 200. Two
   * such runs in a row means "the source has gone away" by the report's own
   * rule, which would have sent somebody to replace a working citation.
   */
  describe("the resolver diagnosis every caller of the fetch now shares", () => {
    it("says nothing about a failure that is not a name lookup", async () => {
      expect(await resolverFailureFor("https://example.test/x", "socket hang up")).toBeNull();
      expect(
        await resolverFailureFor(
          "https://example.test/x",
          "unable to verify the first certificate",
        ),
      ).toBeNull();
    });

    it("leaves a name that resolves nowhere as the dead host it is", async () => {
      // RFC 2606 reserves `.invalid`, so the real resolver is safe to use here
      // and worth using once: it proves the default argument is wired up.
      expect(
        await resolverFailureFor(
          "https://no-such-host.example.invalid/x",
          "getaddrinfo ENOTFOUND no-such-host.example.invalid",
        ),
      ).toBeNull();
    });

    it("names the machine when the host answers a direct query", async () => {
      // Mississippi's DOR is the case this was found on, and the resolver is
      // injected rather than asked: the first version of this test queried
      // www.dor.ms.gov for real and made the unit suite flaky, which is the
      // network-in-the-unit-suite mistake the scheduled checks exist to avoid.
      const host = "www.dor.ms.gov";
      const said = await resolverFailureFor(
        `https://${host}/general-information`,
        `getaddrinfo ENOTFOUND ${host}`,
        async () => true,
      );
      expect(said).toBe(describeResolverFailure(host));
      // And the marker is what the report reads, so this classifies as the
      // machine's problem rather than a dead link.
      expect(classify({ status: 0, detail: said! })).toBe("unreachable");
    });

    it("leaves the message alone when DNS agrees the name is gone", async () => {
      expect(
        await resolverFailureFor(
          "https://gone.test/x",
          "getaddrinfo ENOTFOUND gone.test",
          async () => false,
        ),
      ).toBeNull();
    });

    it("does not ask DNS about something that is not a URL", async () => {
      expect(await resolverFailureFor("not a url", "getaddrinfo ENOTFOUND whatever")).toBeNull();
    });
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

  it("tells a reader why a refused link is in the report and what to do about it", () => {
    // A refusal has no `detail` — its reason is the status — so the entry has
    // to say the status out loud or it reads as a URL beside an empty dash.
    const report = renderLinkReport([
      result({ url: "https://walled.test/x", status: 403, detail: "", files: ["src/tiles/a.ts"] }),
    ]);
    expect(report).not.toContain("## Broken");
    expect(report).toContain("## Unreachable");
    expect(report).toContain("`403` — the server refused this client");
    expect(report).toContain("1 unreachable");
    expect(report).toContain("0 broken");
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

describe("asking twice before calling a link dead", () => {
  /** Replays a scripted sequence of answers, recording what was asked. */
  function replay(answers: (number | Error)[]): {
    request: Request;
    asked: string[];
  } {
    const asked: string[] = [];
    let i = 0;
    const request: Request = async (_url, method) => {
      asked.push(method);
      const next = answers[Math.min(i++, answers.length - 1)]!;
      if (next instanceof Error) throw next;
      return { status: next, location: "" };
    };
    return { request, asked };
  }

  const never = async (): Promise<void> => {
    throw new Error("a healthy link must not pause");
  };
  const instant = async (): Promise<void> => {};

  it("costs one request and no pause when the link is fine", async () => {
    const { request, asked } = replay([200]);
    expect(await check("https://ok.test/a", ["src/x.ts"], request, never)).toEqual({
      url: "https://ok.test/a",
      status: 200,
      detail: "",
      files: ["src/x.ts"],
    });
    expect(asked).toEqual(["HEAD"]);
  });

  // The bug this closes. On 2026-09-02 the sweep reported Wisconsin's
  // 2026-Form1-ES-Inst.pdf as a hard 404 and the same URL answered 200 on the
  // next ask, unchanged: eight-way concurrency against one agency is enough to
  // meet a throttle, and several answer one with a 404 rather than a 429. The
  // report asked a person to go replace a citation that works.
  it("does not report a 404 the server takes back on the next ask", async () => {
    const { request, asked } = replay([404, 404, 200]);
    const r = await check("https://blip.test/a", ["README.md"], request, instant);
    expect(classify(r)).toBe("ok");
    // HEAD said broken, so a GET was asked; that GET said broken, so a second
    // GET confirmed it. Three asks, and only because the first two failed.
    expect(asked).toEqual(["HEAD", "GET", "GET"]);
  });

  it("escalates a refused HEAD to a GET rather than filing it as unreachable", async () => {
    // The reason a refusal is still asked twice: plenty of servers refuse a
    // HEAD and serve the GET. Returning early on the 403 — which is what a
    // rule of "stop unless it is broken" would now do, since a 403 is no
    // longer broken — would report a 200 page as unreachable.
    const { request, asked } = replay([403, 200]);
    const r = await check("https://picky.test/a", ["src/x.ts"], request, instant);
    expect(classify(r)).toBe("ok");
    expect(asked).toEqual(["HEAD", "GET"]);
  });

  it("files a refusal that survives both asks under unreachable, not broken", async () => {
    const { request, asked } = replay([403]);
    const r = await check("https://walled.test/a", ["src/x.ts"], request, instant);
    expect(classify(r)).toBe("unreachable");
    expect(r.status).toBe(403);
    expect(asked).toEqual(["HEAD", "GET", "GET"]);
  });

  it("still reports a link that is dead both times it is asked", async () => {
    const { request, asked } = replay([404]);
    const r = await check("https://gone.test/a", ["README.md"], request, instant);
    expect(classify(r)).toBe("broken");
    expect(r.status).toBe(404);
    expect(asked).toEqual(["HEAD", "GET", "GET"]);
  });

  it("keeps the status when the confirming ask never lands", async () => {
    // A server that answers 404 and then drops the connection has still told us
    // something; "fetch failed (after retries)" would throw that away and send
    // the reader looking for a network problem instead of a moved page.
    const { request } = replay([500, 500, new Error("socket hang up")]);
    const r = await check("https://flaky.test/a", ["README.md"], request, instant);
    expect(r.status).toBe(500);
    expect(classify(r)).toBe("broken");
  });

  it("takes a redirect at its word without a second ask", async () => {
    // A redirect is reported, not retried: it is an answer about where the
    // canonical URL went, and asking again cannot change it.
    const { request, asked } = replay([301]);
    const r = await check("https://moved.test/a", ["src/x.ts"], request, never);
    expect(classify(r)).toBe("redirect");
    expect(asked).toEqual(["HEAD"]);
  });

  it("retries a transport failure once, per method, as it always has", async () => {
    const { request, asked } = replay([new Error("socket hang up"), 200]);
    const r = await check("https://dropped.test/a", ["src/x.ts"], request, never);
    expect(classify(r)).toBe("ok");
    expect(asked).toEqual(["HEAD", "HEAD"]);
  });
});
