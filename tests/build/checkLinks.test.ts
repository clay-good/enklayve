import { describe, it, expect } from "vitest";
import {
  classify,
  extractUrls,
  renderLinkReport,
  sourceFiles,
  type LinkResult,
} from "../../scripts/check-links";
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
    expect(extractUrls("https://example.gov/a https://enklayve.com/b")).toEqual([]);
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
      result({ url: "https://badchain.test/x", status: 0, detail: "unable to verify certificate" }),
    ]);
    expect(report).toContain("## Unreachable");
    expect(report).not.toContain("## Broken");
    expect(report).toContain("open it in a browser before replacing it");
  });
});
