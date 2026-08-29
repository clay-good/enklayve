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
 * It covers the other half of the gate too. A dataset marked **invalid** — a
 * content hash that does not match the manifest, or a shard that no longer
 * parses — was equally silent: `dataOf` refuses to compute from it, so a tile
 * shows "unavailable", and nothing said why. For a hash mismatch that is the
 * most important fact on the page, and it outranks staleness: a stale figure is
 * merely old, an invalid one is not the bytes that were reviewed.
 *
 * The banner names the datasets rather than gesturing at "some data", because a
 * warning a reader cannot act on is decoration. It sits above the content on
 * every view, so no route can render a stale or ungated figure without it.
 *
 * Returns null in the healthy case, which is almost always — a banner that
 * appears when nothing is wrong teaches people to ignore it.
 */
export function staleBanner(data: BundledData | null): HTMLElement | null {
  // An integrity or schema failure outranks staleness and is reported first. A
  // stale figure is old; an invalid one did not match the hash the manifest
  // pins, which means the bytes are not the bytes that were reviewed. Nothing
  // is computed from it either way — but only one of the two is worth alarm,
  // and telling a reader "out of date" when the real fact is "this file was
  // altered" would understate it.
  const invalid = data?.invalidDatasets() ?? [];
  if (invalid.length > 0) {
    const named = invalid.map((d) => `${d.id} (${d.problems[0] ?? "failed its gate"})`).join("; ");
    return el(
      "div",
      { class: "stale-banner stale-banner--invalid", attrs: { role: "alert" } },
      el("strong", { text: "Some data failed its integrity check. " }),
      el("span", {
        text: `${invalid.length} dataset${invalid.length === 1 ? "" : "s"} did not match the content hash or schema this site pins, so nothing is computed from ${invalid.length === 1 ? "it" : "them"} and the tools that need ${invalid.length === 1 ? "it" : "them"} will say so: ${named}. If you did not expect this, do not rely on anything here — reload from a fresh copy of the site.`,
      }),
    );
  }

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
