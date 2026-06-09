import { describe, it, expect } from "vitest";
import worker, { type Env } from "../worker/index";

/**
 * Behavioral guard for the Cloudflare Worker's security-header contract
 * (BUILD-SPEC.md §2, §11) — the deploy-time boundary that makes "nothing ever
 * leaves your device" enforceable. The release audit only string-matches the
 * source for `connect-src 'none'`; this drives the real `fetch` with a mock
 * Static Assets binding and asserts every header, the per-path CSP variations,
 * and the cache policy. A dropped header, a loosened CSP, or a broken /ocr/
 * carve-out fails here rather than shipping silently.
 */
function mockEnv(body = "<!doctype html>", status = 200): Env {
  return {
    ASSETS: {
      fetch: async () =>
        new Response(body, {
          status,
          headers: { "Content-Type": "text/html" },
        }),
    },
  };
}

function get(path: string, env: Env = mockEnv()): Promise<Response> {
  return worker.fetch(new Request(`https://enklayve.com${path}`), env);
}

describe("worker security headers", () => {
  it("a page carries the full family header set and locks connect-src to 'none'", async () => {
    const h = (await get("/")).headers;
    const csp = h.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("wasm-unsafe-eval"); // a page never needs it
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("frame-ancestors 'none'");

    expect(h.get("Referrer-Policy")).toBe("no-referrer");
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
    expect(h.get("X-Frame-Options")).toBe("DENY");
    expect(h.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(h.get("Cross-Origin-Resource-Policy")).toBe("same-origin");

    const hsts = h.get("Strict-Transport-Security") ?? "";
    expect(hsts).toMatch(/max-age=\d{7,}/);
    expect(hsts).toContain("includeSubDomains");
    expect(hsts).toContain("preload");

    const pp = h.get("Permissions-Policy") ?? "";
    for (const feat of ["accelerometer", "camera", "geolocation", "microphone", "payment", "usb"]) {
      expect(pp, `${feat} must be disabled`).toContain(`${feat}=()`);
    }
  });

  it("the service worker may fetch same-origin, but pages stay 'none'", async () => {
    expect((await get("/sw.js")).headers.get("Content-Security-Policy")).toContain(
      "connect-src 'self'",
    );
    expect((await get("/")).headers.get("Content-Security-Policy")).toContain("connect-src 'none'");
  });

  it("the OCR assets get connect-src 'self' + wasm-unsafe-eval, scoped to /ocr/*", async () => {
    const ocr =
      (await get("/ocr/tesseract-core.wasm")).headers.get("Content-Security-Policy") ?? "";
    expect(ocr).toContain("connect-src 'self'");
    expect(ocr).toContain("script-src 'self' 'wasm-unsafe-eval'");

    // A sibling hashed asset is NOT relaxed.
    const asset = (await get("/assets/app-1234.js")).headers.get("Content-Security-Policy") ?? "";
    expect(asset).toContain("connect-src 'none'");
    expect(asset).not.toContain("wasm-unsafe-eval");
  });

  it("caches hashed assets immutably and revalidates html/manifest", async () => {
    expect((await get("/assets/index-abcd1234.js")).headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect((await get("/")).headers.get("Cache-Control")).toBe("no-cache");
    expect((await get("/tools.html")).headers.get("Cache-Control")).toBe("no-cache");
    expect((await get("/data/manifest.json")).headers.get("Cache-Control")).toBe("no-cache");
    expect((await get("/site.webmanifest")).headers.get("Cache-Control")).toBe("no-cache");
    expect((await get("/sitemap.xml")).headers.get("Cache-Control")).toBe(
      "public, max-age=3600, must-revalidate",
    );
  });

  it("passes the upstream status and body through, still decorated with headers", async () => {
    const res = await get("/missing", mockEnv("not found", 404));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("not found");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Content-Security-Policy")).toContain("connect-src 'none'");
  });
});
