import { test, expect } from "@playwright/test";

/**
 * Smoke + offline (BUILD-SPEC.md §8/§11): the production build boots, a deep
 * link computes a real result on-device, the command palette opens, and — the
 * Phase 8 acceptance criterion — the site still loads and renders after the
 * network is cut, served by the precaching service worker.
 */

test("the home boots and the wordmark renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".wordmark")).toHaveText("enklayve");
});

test("a deep link computes a real result on-device", async ({ page }) => {
  // Take-Home Pay now lives inside the Paycheck & Taxes hub (its default tool).
  await page.goto("/#/paycheck-taxes?tool=take-home");
  await page.waitForSelector(".content");
  await page.getByRole("button", { name: /try an example/i }).click();
  // The result card shows a large headline figure; it must be a currency value.
  const value = page.locator(".result-value").first();
  await expect(value).toBeVisible();
  await expect(value).toContainText("$");
});

test("the command palette opens with the keyboard", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(".wordmark");
  await page.keyboard.press("ControlOrMeta+k");
  // `.palette-panel` is shared with the My Situation dialog, so target the
  // command palette by its accessible name.
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
});

test("printing the Readout Report strips the app chrome", async ({ page }) => {
  // The Report offers a Print action; under print media the site chrome and
  // interactive controls must drop away so the printout is a clean document
  // (BUILD-SPEC-2 §5). happy-dom has no media engine, so this is verified here.
  await page.goto("/#/report");
  await page.waitForSelector(".report-body");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".app-header")).toBeHidden();
  await expect(page.locator(".app-footer")).toBeHidden();
  await expect(page.locator(".report-actions")).toBeHidden();
  // The report content itself stays on the page.
  await expect(page.locator(".report-body")).toBeVisible();
});

test("works offline after the first visit", async ({ page, context }) => {
  // First visit: let the service worker install and precache the core shell.
  await page.goto("/");
  await page.waitForSelector(".wordmark");
  await page.evaluate(async () => {
    if ("serviceWorker" in navigator) await navigator.serviceWorker.ready;
  });

  // Reload so this page becomes SW-controlled (the SW takes control on the next
  // navigation after activation).
  await page.reload();
  await page.waitForSelector(".wordmark");
  await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return;
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), {
          once: true,
        });
        setTimeout(resolve, 3000);
      });
    }
  });

  // Cut the network and reload: the cached shell must still boot the app, and
  // since datasets are inlined at build time there is no runtime fetch to miss.
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(".wordmark")).toHaveText("enklayve");
  await context.setOffline(false);
});
