/**
 * Service worker and web-app-manifest renderers (BUILD-SPEC.md §8, §11). Kept
 * here (not inline in the Vite config) so a test can guard the generated output.
 *
 * Offline strategy: a small CORE shell is precached on install (index.html, the
 * entry JS/CSS, the static pages, the manifest, and the icons). Everything else
 * that the page requests — the lazily-imported chunks like pdf.js for the
 * Readout, all same-origin — is cached on first use by the fetch handler, so the
 * first visit stays light but the whole app works offline afterward.
 *
 * Cache versioning: the cache name carries a version derived from the built
 * asset list (which includes the content-hashed bundle, and the bundle inlines
 * the dataset shards). So any code or data refresh changes the version, and the
 * old cache is dropped on activate (BUILD-SPEC.md §8 cache invalidation).
 *
 * Privacy: the worker only ever fetches SAME-ORIGIN static assets to populate
 * its cache. There is no server endpoint, and it never touches the user's
 * in-memory data, so nothing can leave the device. (The page itself keeps
 * `connect-src 'none'`; only the worker script is served with `connect-src
 * 'self'` so it can cache same-origin assets — see worker/index.ts.)
 */

/** Render the service worker source for a given precache list and version. */
export function renderServiceWorker(precache: string[], version: string): string {
  const sorted = [...new Set(precache)].sort();
  return `// Generated at build time, do not edit by hand.
const CACHE = "enklayve-${version}";
const PRECACHE = ${JSON.stringify(sorted, null, 2)};

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Cache-first for same-origin GETs, then runtime-cache the response. Navigations
// fall back to the cached shell so the app opens offline.
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response && response.ok && response.type === "basic") {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match("/index.html"));
    }),
  );
});
`;
}

/** The web app manifest (BUILD-SPEC.md §11): installable, royal-purple themed. */
export const WEB_MANIFEST = {
  name: "enklayve",
  short_name: "enklayve",
  description:
    "Your private financial enclave. Every number is computed on your device. Nothing is ever sent anywhere.",
  start_url: "/",
  scope: "/",
  display: "standalone",
  theme_color: "#6D28D9",
  background_color: "#faf8ff",
  icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
} as const;

/** Render the web app manifest as pretty JSON. */
export function renderWebManifest(): string {
  return `${JSON.stringify(WEB_MANIFEST, null, 2)}\n`;
}
