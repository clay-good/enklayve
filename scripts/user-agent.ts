/**
 * The user agent every outbound request from this repo sends.
 *
 * Government sites increasingly sit behind a WAF that refuses anything not
 * shaped like a browser — sometimes with a 403, sometimes with a 200 carrying a
 * challenge page, which is worse because it looks like success. The link check
 * has always sent a browser agent and reaches essentially everything. The data
 * refresh sent `enklayve-data-refresh` and was being turned away at sites the
 * link check reads without trouble, which is how a shard can keep a live,
 * correct citation while quietly stopping being watched.
 *
 * So both send the same thing, from here. This is not evasion of a robots
 * policy: these are public statutory pages the site cites, fetched a few times a
 * year on a schedule, one request each.
 */
export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
