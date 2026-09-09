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
const QUARTERLY = "/#/paycheck-taxes?tool=quarterly-taxes";
const MEDICAID = "/#/benefits?tool=medicaid";
const SNAP = "/#/benefits?tool=snap";
const SS_TAX = "/#/retirement?tool=social-security-tax";

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

/**
 * "Federal and FICA only (no state)" is an answer, and until 2026-09-09 it was
 * the one answer a reader could not make stick: `rememberShared` tested the
 * field for truthiness, so deselecting a state changed the tile in front of you
 * and nothing else. It is asked here for the same reason everything else in
 * this file is — the question is what the *next* dropdown says, and no unit
 * test in this repository can read one.
 */
test("a reader who deselects their state is not still in it one tile later", async ({ page }) => {
  await page.goto(`${TAKE_HOME}&w=60000`);
  const st = page.locator("select[name='st']").first();
  await st.selectOption("md");
  await expect(st).toHaveValue("md");

  await page.goto(QUARTERLY);
  await expect(page.locator("select[name='st']").first()).toHaveValue("md");

  await page.goto(TAKE_HOME);
  await page.locator("select[name='st']").first().selectOption("");

  await page.goto(QUARTERLY);
  await expect(
    page.locator("select[name='st']").first(),
    "the state came back after the reader turned it off",
  ).toHaveValue("");
});

/**
 * The other direction, on the tile whose whole answer turns on the state: it
 * took household size and income from My Situation and not the state, so a
 * reader who had said where they live was shown California. It renders codes
 * upper and the profile stores them lower.
 */
test("the Medicaid tile opens on the state the reader already gave", async ({ page }) => {
  await page.goto(`${TAKE_HOME}&w=60000`);
  await page.locator("select[name='st']").first().selectOption("tx");

  await page.goto(MEDICAID);
  await expect(page.locator("select[name='st']").first()).toHaveValue("TX");
  await expect(page.locator(".tile-result").first()).toBeVisible();
});

/**
 * And the tile that never touched the profile at all. Its answer is a pair of
 * §86 base amounts, so opening a joint filer on the single ones is a wrong
 * taxable portion, not a missing convenience.
 */
test("Social Security Taxation opens on the shared filing status", async ({ page }) => {
  await page.goto(`${TAKE_HOME}&w=60000`);
  await page.locator("select[name='fs']").first().selectOption("married_jointly");

  await page.goto(SS_TAX);
  await expect(page.locator("select[name='fs']").first()).toHaveValue("married_jointly");
  await expect(page.locator(".tile-result").first()).toBeVisible();
});

/**
 * SPEC-3-hardening §B3: where the allotment tables are not bundled, no number.
 * The standalone tile printed a lower-48 figure to this household until the
 * region came from the same profile its household size already came from.
 */
test("SNAP declines to estimate for a household outside the lower 48", async ({ page }) => {
  await page.goto(`${TAKE_HOME}&w=60000`);
  await page.locator("select[name='st']").first().selectOption("ak");

  await page.goto(SNAP);
  const result = page.locator(".tile-result").first();
  await expect(result).toContainText("Alaska");
  await expect(result).not.toContainText(/\$[\d,]/);
});
