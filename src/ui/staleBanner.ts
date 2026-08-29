import { el } from "./dom";
import type { BundledData } from "../data/browser";

/**
 * The site-wide staleness banner (SPEC-3 §2.5, SPEC-4 §10.5).
 *
 * The loader has always gated every shard on its staleness window and marked
 * the ones that fell outside it. Nothing rendered that, so a dataset could pass
 * its window and keep producing figures that looked exactly as current as the
 * rest. That is the failure mode the window exists to prevent, and it matters
 * most for the Pillar 4 shards pinned at `staleAfterYears: 0`: a COBRA election
 * period or a garnishment ceiling must degrade loudly, not quietly.
 *
 * The banner names the datasets rather than gesturing at "some data", because a
 * warning a reader cannot act on is decoration. It sits above the content on
 * every view, so no route can render a stale figure without it.
 *
 * Returns null in the healthy case, which is almost always — a banner that
 * appears when nothing is wrong teaches people to ignore it.
 */
export function staleBanner(data: BundledData | null): HTMLElement | null {
  const stale = data?.staleDatasets() ?? [];
  if (stale.length === 0) return null;
  const named = stale.map((d) => `${d.id} (${d.effectiveYear})`).join(", ");
  return el(
    "div",
    { class: "stale-banner", attrs: { role: "alert" } },
    el("strong", { text: "Verify before relying on these figures. " }),
    el("span", {
      text: `${stale.length} dataset${stale.length === 1 ? "" : "s"} on this site ${stale.length === 1 ? "has" : "have"} passed the year ${stale.length === 1 ? "it was" : "they were"} published for and ${stale.length === 1 ? "has" : "have"} not been refreshed yet: ${named}. Anything computed from ${stale.length === 1 ? "it" : "them"} may be out of date — check the source link on the figure before you act on it.`,
    }),
  );
}
