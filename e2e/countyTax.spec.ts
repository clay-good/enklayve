import { test, expect } from "@playwright/test";

/**
 * The mandatory county tax, driven in a real browser.
 *
 * Maryland and Indiana levy a county income tax nobody opts into, and seven
 * surfaces charge it. The unit suite can assert that the control exists and
 * what the engine does with an id, and then it stops: happy-dom mis-reports
 * `<select>.value` when options are built with `selected` set before insertion,
 * which is how every tile builds them, so a test there cannot ask the question
 * a reader would — *does changing this county change my answer, and does the
 * link I share carry it?* `catalogInvariants.test.ts` carries the same warning.
 *
 * So it is asked here, where a select behaves like a select.
 */
test("changing the county changes the answer and the link", async ({ page }) => {
  await page.goto("/#/paycheck-taxes?tool=marginal-explorer&fs=single&st=md&inc=60000&step=1000");
  const county = page.locator("select[name='loc-select']");
  await expect(county).toBeVisible();
  // Defaulted, never blank: "no county" is not a state a Maryland resident can
  // be in, and a blank one would quietly drop 3.2 points of their marginal rate.
  await expect(county).toHaveValue("md-montgomery");

  const answer = page.locator(".tile-result");
  const montgomery = await answer.innerText();
  expect(montgomery).toContain("Local tax");

  // Worcester is Maryland's cheapest county (2.25%) and Montgomery near its
  // dearest (3.20%), so the next $1,000 genuinely costs less there.
  await county.selectOption("md-worcester");
  await expect(answer).not.toHaveText(montgomery);

  // And the permalink carries it, so the answer is reproducible by whoever
  // receives the link rather than being recomputed for Montgomery.
  await expect(page).toHaveURL(/loc=md-worcester/);
});

test("a state without a mandatory county offers no county, and charges none", async ({ page }) => {
  await page.goto("/#/paycheck-taxes?tool=marginal-explorer&fs=single&st=ca&inc=60000&step=1000");
  await expect(page.locator(".tile-result")).toBeVisible();
  await expect(page.locator("select[name='loc-select']")).toHaveCount(0);
  await expect(page.locator(".tile-result")).not.toContainText("Local tax");
});

test("leaving the state takes the county with it, out of the answer and the link", async ({
  page,
}) => {
  // The failure this guards is quiet by construction: a county id left behind
  // from the previous state charges nothing, because the engine matches by id
  // and the new state has no such add-on. It would still sit in the URL,
  // telling whoever opens it that the reader lives in a county of another state.
  await page.goto("/#/paycheck-taxes?tool=marginal-explorer&fs=single&st=in&inc=60000&step=1000");
  await expect(page.locator("select[name='loc-select']")).toHaveValue("in-marion");
  // The URL is what the reader typed until they touch something — mounting does
  // not rewrite it — so pick a county to get it in there.
  await page.locator("select[name='loc-select']").selectOption("in-porter");
  await expect(page).toHaveURL(/loc=in-porter/);

  await page.locator("select[name='st']").selectOption("ca");
  await expect(page.locator("select[name='loc-select']")).toHaveCount(0);
  await expect(page).not.toHaveURL(/loc=/);
});

test("the home budget charges the county too, and the tax slice moves with it", async ({
  page,
}) => {
  await page.goto("/");
  const state = page.locator('.home-budget select[aria-label="State"]');
  await state.selectOption("md");
  const county = page.locator('.home-budget select[aria-label="County of residence"]');
  await expect(county).toHaveValue("md-montgomery");

  const taxes = page.locator(".home-budget__derived-value");
  const before = await taxes.innerText();
  await county.selectOption("md-worcester");
  await expect(taxes).not.toHaveText(before);
});
