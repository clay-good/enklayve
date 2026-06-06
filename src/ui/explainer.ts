/**
 * The shared "How this works" + "Learn more" renderer (BUILD-SPEC-2). Pulled out
 * of the shell so both the per-tool explainer (which adds the privacy promise
 * after it) and a hub's active sub-tool can render the same how/resources block
 * without the shell ↔ hub import cycle. Returns null when a tile has neither.
 */
import { el } from "./dom";
import type { TileContext, TileDefinition } from "../tiles/types";

export function tileHowResources(
  tile: TileDefinition,
  navigate?: TileContext["navigate"],
): HTMLElement | null {
  const hasRelated = navigate && tile.related && tile.related.length > 0;
  if (!tile.how && !(tile.resources && tile.resources.length > 0) && !hasRelated) return null;
  const section = el("section", { class: "tile-howres" });

  if (tile.how) {
    const how = el("details", { class: "explainer-how", attrs: { open: "" } });
    how.append(el("summary", { text: "How this works" }));
    for (const para of tile.how.split(/\n\n+/)) {
      how.append(el("p", { class: "explainer-para", text: para.trim() }));
    }
    section.append(how);
  }

  if (tile.resources && tile.resources.length > 0) {
    const list = el(
      "ul",
      { class: "explainer-resources" },
      ...tile.resources.map((r) =>
        el(
          "li",
          {},
          el(
            "a",
            { href: r.url, attrs: { rel: "noopener noreferrer", target: "_blank" } },
            r.label,
          ),
        ),
      ),
    );
    section.append(el("h3", { class: "explainer-subhead", text: "Learn more" }), list);
  }

  // Related tools (SPEC-3 §4.1): in-app links to the sibling a user usually wants
  // next. Navigating carries the shared profile over, so context follows for free.
  if (hasRelated) {
    const list = el(
      "ul",
      { class: "explainer-related" },
      ...tile.related!.map((r) =>
        el(
          "li",
          {},
          el("button", {
            type: "button",
            class: "related-link",
            text: r.label,
            on: {
              click: () =>
                navigate!(r.hubId, r.tool ? new URLSearchParams({ tool: r.tool }) : undefined),
            },
          }),
          r.note ? el("span", { class: "related-note", text: ` — ${r.note}` }) : null,
        ),
      ),
    );
    section.append(el("h3", { class: "explainer-subhead", text: "Related tools" }), list);
  }

  return section;
}
