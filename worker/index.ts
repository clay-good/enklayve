/**
 * Cloudflare Worker asset router for enklayve.com.
 *
 * The Worker serves the static `dist/` build (declared in wrangler.toml as
 * the ASSETS binding) and decorates every response with the family security
 * headers. The Content-Security-Policy is the entire privacy story: with
 * `connect-src 'none'` the browser physically cannot send the user's data
 * anywhere, even if a bug tried to. See BUILD-SPEC.md §2 and §11.
 */

/** Minimal shape of the Workers Static Assets binding (avoids a deps on the
 * full @cloudflare/workers-types; the binding only needs `fetch`). */
interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  ASSETS: AssetFetcher;
}

/**
 * Strict Content-Security-Policy per BUILD-SPEC.md §11.
 * `connect-src 'none'` means no fetch/XHR/WebSocket can leave the page — all
 * datasets are bundled at build time, so nothing is ever fetched at runtime.
 */
function cspFor(pathname: string): string {
  // Two SAME-ORIGIN worker scripts are the only exceptions to `connect-src
  // 'none'`, and each is justified the same way: it fetches same-origin static
  // assets only, has no server endpoint, and never touches the user's in-memory
  // data, so nothing can leave the device. EVERY PAGE keeps `connect-src 'none'`.
  //
  //   /sw.js          the offline service worker (BUILD-SPEC.md §8) — caches
  //                   same-origin assets.
  //   /ocr/*          the tesseract.js OCR worker + its wasm core + the bundled
  //                   language model (BUILD-SPEC-2 §2.2) — loads the scanned-image
  //                   reader on demand. WebAssembly compilation also needs
  //                   `'wasm-unsafe-eval'`, scoped to these asset responses only.
  //
  // A dedicated/service worker's CSP comes from its OWN response headers, not the
  // owner page's, so relaxing /ocr/* here does not loosen any page (the page that
  // spawns the worker stays `connect-src 'none'`; the worker, created from a
  // same-origin URL rather than a blob:, adopts the policy below).
  const isOcr = pathname.startsWith("/ocr/");
  const connectSrc = pathname === "/sw.js" || isOcr ? "connect-src 'self'" : "connect-src 'none'";
  const scriptSrc = isOcr ? "script-src 'self' 'wasm-unsafe-eval'" : "script-src 'self'";
  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    connectSrc,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    "worker-src 'self'",
  ].join("; ");
}

const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "camera=()",
  "geolocation=()",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "payment=()",
  "usb=()",
].join(", ");

/** Headers applied to every response. */
function securityHeaders(pathname: string): Record<string, string> {
  return {
    "Content-Security-Policy": cspFor(pathname),
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": PERMISSIONS_POLICY,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  };
}

/**
 * Cache policy: hashed assets under `/assets/*` are immutable for a year;
 * `index.html` and the data manifest must always be revalidated so a deploy
 * is picked up immediately.
 */
function cacheControlFor(pathname: string): string {
  if (pathname.startsWith("/assets/")) {
    return "public, max-age=31536000, immutable";
  }
  if (
    pathname === "/" ||
    pathname === "/sw.js" ||
    pathname.endsWith(".html") ||
    pathname.endsWith(".webmanifest") ||
    pathname.endsWith("/manifest.json")
  ) {
    return "no-cache";
  }
  return "public, max-age=3600, must-revalidate";
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const assetResponse = await env.ASSETS.fetch(request);

    const headers = new Headers(assetResponse.headers);
    for (const [key, value] of Object.entries(securityHeaders(url.pathname))) {
      headers.set(key, value);
    }
    headers.set("Cache-Control", cacheControlFor(url.pathname));

    return new Response(assetResponse.body, {
      status: assetResponse.status,
      statusText: assetResponse.statusText,
      headers,
    });
  },
};
