import { defineConfig } from "@playwright/test";

/**
 * End-to-end suite (BUILD-SPEC.md §6/§10/§11): runs the real production build in
 * a real browser to verify what happy-dom cannot — layout (no horizontal scroll
 * on any view at any device width), the offline service worker, and the
 * deep-link → compute smoke path. Kept separate from the fast Vitest unit/golden
 * suite so `npm run test` stays browser-free; CI runs this as its own job.
 *
 * The server is `vite preview` over the built dist, so the test exercises the
 * exact bytes that ship (minified, code-split, with the service worker), on
 * localhost — a secure context, so the SW activates.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:4173",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "npm run build && npm run preview -- --port 4173 --strictPort",
    url: "http://localhost:4173/",
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
});
