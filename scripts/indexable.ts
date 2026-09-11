/**
 * Every indexable URL, as the host serves it.
 *
 * The build and the test that guards the build each used to assemble this list
 * themselves, which is how they could agree with each other and both be wrong:
 * they named the `.html` filenames, and the host answers those with a 307 to the
 * extensionless URL. So all eighty-four sitemap entries pointed a crawler at a
 * redirect, and each page's canonical named that same redirecting URL.
 *
 * One list, built from the registry. It lives in its own file rather than in
 * sitemap.ts because everything here imports `SITE_ORIGIN` from that module —
 * putting this there makes a cycle, and the cycle shows up as a module-init
 * error at build time rather than as anything to do with sitemaps.
 */
import { toolPages, toolPageUrl } from "./tool-pages";
import { INDEX_PAGE_URL } from "./tools-index";
import { ABOUT_PAGE_URL } from "./about-page";

export function indexablePaths(): string[] {
  return [
    "/",
    `/${INDEX_PAGE_URL}`,
    `/${ABOUT_PAGE_URL}`,
    ...toolPages().map((p) => `/${toolPageUrl(p.id)}`),
  ];
}
