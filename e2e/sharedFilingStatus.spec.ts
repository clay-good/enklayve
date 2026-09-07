import { test, expect } from "@playwright/test";

/**
 * The shared filing status survives a tile that cannot express it.
 *
 * `filingStatus` is chosen once and read by every tile after it. Most tiles ask
 * with a five-option select and write back what the reader chose, which loses
 * nothing. Four ask with a single *married filing jointly* checkbox, which has
 * two values, and Education Credits used to write that bit through as
 * `married ? "married_jointly" : "single"` — so a head-of-household filer who
 * typed a MAGI there had their status quietly rewritten to single, and then paid
 * for it in Take-Home at a different standard deduction and a different
 * schedule.
 *
 * The unit suite holds the write itself. It cannot hold this: the question a
 * reader would ask is *what does the filing status control say when I come
 * back*, and happy-dom mis-reports `<select>.value` when options are built with
 * `selected` set before insertion, which is how every tile builds them.
 * `catalogInvariants.test.ts` and `countyTax.spec.ts` both carry that warning.
 *
 * So it is asked here, where a select behaves like a select.
 */
const TAKE_HOME = "/#/paycheck-taxes?tool=take-home";
const EDUCATION = "/#/benefits?tool=education-credits";

test("a head of household stays one after visiting Education Credits", async ({ page }) => {
  // Chosen, not deep-linked: a tile writes the shared profile when the reader
  // edits it, so a link that merely displays a status has not told the profile
  // anything yet.
  await page.goto(`${TAKE_HOME}&fs=single&st=ca&w=60000`);
  const status = page.locator("select[name='fs']");
  await status.selectOption("head_of_household");
  await expect(status).toHaveValue("head_of_household");

  // The checkbox tile reads the same profile: not a joint return, which head of
  // household already satisfies, so the box is clear and stays clear.
  await page.goto(EDUCATION);
  const mfj = page.locator("input[name='mfj']");
  await expect(mfj).not.toBeChecked();
  await page.locator("input[name='magi']").fill("70000");
  await expect(page.locator(".tile-result")).toBeVisible();

  // Back to Take-Home with nothing in the link: the status has to come from the
  // profile, and it has to be the one the reader chose.
  await page.goto(TAKE_HOME);
  await expect(page.locator("select[name='fs']")).toHaveValue("head_of_household");
});

test("checking married filing jointly there does reach Take-Home", async ({ page }) => {
  // The other direction has to keep working: the bit the checkbox CAN express is
  // a real answer, and a shared field that ignores it is its own bug.
  await page.goto(`${TAKE_HOME}&fs=single&st=ca&w=60000`);
  await page.locator("select[name='fs']").selectOption("head_of_household");

  await page.goto(EDUCATION);
  await page.locator("input[name='mfj']").check();
  await expect(page.locator(".tile-result")).toBeVisible();

  await page.goto(TAKE_HOME);
  await expect(page.locator("select[name='fs']")).toHaveValue("married_jointly");
});

/**
 * A link beats the profile, in every dropdown the catalog asks with.
 *
 * The unit suite gained a sweep on 2026-09-07 asking that a shared link mean
 * the same thing to two readers whose My Situation differs. It can hold every
 * text and number control and **no dropdown at all**: happy-dom lands a freshly
 * built `<select>` on its second option whatever any option's `selected` says,
 * so what a fragment restores into a filing status or a state is a question no
 * unit test in this repository can ask. `app.spec.ts` asked it of one tile.
 *
 * Filing status and state are the two fields that reprice everything — a wrong
 * state is a wrong tax, a wrong status is a wrong schedule and a wrong standard
 * deduction — and they are the two the profile is most likely to disagree with,
 * because every tax tile writes them. So it is asked of a spread of the tiles
 * that ask with a dropdown, in the browser where a select behaves like one.
 */
const DROPDOWN_LINKS: { name: string; url: string; expect: Record<string, string> }[] = [
  {
    name: "Take-Home",
    url: `${TAKE_HOME}&fs=married_jointly&st=tx&w=90000`,
    expect: { fs: "married_jointly", st: "tx" },
  },
  {
    name: "the federal income tax tile",
    url: "/#/paycheck-taxes?tool=federal-income-tax&fs=single&inc=90000",
    expect: { fs: "single" },
  },
  {
    name: "the Marginal Rate Explorer",
    url: "/#/paycheck-taxes?tool=marginal-explorer&fs=head_of_household&st=tx&inc=90000",
    expect: { fs: "head_of_household", st: "tx" },
  },
  {
    name: "the Medicaid threshold",
    url: "/#/benefits?tool=medicaid&st=OH&hh=1&inc=18000",
    expect: { st: "OH" },
  },
];

for (const { name, url, expect: wanted } of DROPDOWN_LINKS) {
  test(`a link into ${name} beats a profile that disagrees`, async ({ page }) => {
    // Chosen rather than deep-linked, because a tile writes the shared profile
    // when the reader edits it: this is a reader who has already told the site
    // they are a married Californian.
    await page.goto(`${TAKE_HOME}&w=60000`);
    await page.locator("select[name='fs']").first().selectOption("married_jointly");
    await page.locator("select[name='st']").first().selectOption("ca");

    await page.goto(url);
    await page.waitForSelector(".tile-form");
    for (const [control, value] of Object.entries(wanted)) {
      await expect(
        page.locator(`select[name='${control}']`).first(),
        `${name} answered its own link's ${control} with the reader's profile`,
      ).toHaveValue(value);
    }
    // And the answer is on screen, so this is the tile computing rather than a
    // control set beside an empty panel.
    await expect(page.locator(".tile-result").first()).toBeVisible();
  });
}
