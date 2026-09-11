/**
 * The home's search-facing copy, shared by the app and the build.
 *
 * The home is both an app and the page a search engine ranks, and those two
 * readers used to be told different things: the tab said "enklayve" and the
 * `<title>` in index.html said "enklayve", so the one line Google shows for the
 * site carried no word anybody searches for. Someone looking for a free
 * take-home pay calculator had nothing here to match.
 *
 * Both now read these two strings — the shell sets the first as the document
 * title on the home, and the build injects it into index.html — so the tab, the
 * search result, and the social card cannot say three different things. The
 * rest of the home's head (description, social copy, structured data) is
 * rendered from the registry in scripts/home-page.ts, which is the only reader
 * that needs it and is not shipped to the browser.
 */

/**
 * The home's `<title>`. Keyword-first (that is the half a search engine weighs
 * and the half a searcher scans), brand last, and short enough that Google
 * shows all of it rather than cutting it mid-phrase.
 */
export const HOME_TITLE = "Free Personal Finance & Tax Calculators · enklayve";

/**
 * What the whole catalog covers, in the words people actually search. Shown as
 * the lede above the tool list on the home, and reused by the build on the
 * All Tools index and in the home's meta description.
 */
export const CATALOG_SUMMARY =
  "Taxes and take-home pay, self-employment and quarterly estimates, investing and " +
  "capital gains, retirement and Social Security, mortgages and debt payoff, budgeting, " +
  "home buying, insurance, benefits and credits you may be owed, and what to do when a " +
  "month does not close. No account, no ads, no upload.";
