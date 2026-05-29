/**
 * Tile contract (BUILD-SPEC.md §12, Phase 4/5). A tile is a self-contained
 * calculator that renders into a mount point, reads and writes its state
 * through the URL fragment, and reads bundled data through the shared context.
 * The shell knows nothing about any individual tile beyond this interface, so
 * adding a tile is registering data + a mount function — never editing the shell.
 */
import type { BundledData } from "../data/browser";
import type { SituationStore } from "../profile/situation";

/** The three pillars plus the guide surfaces (BUILD-SPEC.md §3–5, BUILD-SPEC-2 §4). */
export type Pillar = "take-home" | "owed" | "safe-harbor" | "plan";

export interface PillarMeta {
  id: Pillar;
  title: string;
  blurb: string;
}

export const PILLARS: PillarMeta[] = [
  {
    id: "take-home",
    title: "Take Home & Taxes",
    blurb: "Your real paycheck, taxes, and borrowing math.",
  },
  { id: "owed", title: "What You're Owed", blurb: "Benefits and aid you may qualify for." },
  {
    id: "safe-harbor",
    title: "Safe Harbor",
    blurb: "Calm wealth: cushion, runway, and your enough number.",
  },
  { id: "plan", title: "My Plan", blurb: "The next right step, with the math shown." },
];

export interface TileContext {
  /** Mount point for the tile body. */
  root: HTMLElement;
  /** Current decoded state from the URL fragment. */
  params: URLSearchParams;
  /** Persist new state to the URL fragment (no history entry) for deep linking. */
  setParams(params: URLSearchParams): void;
  /** Shareable URL for the given params (defaults to the tile's current params). */
  permalink(params?: URLSearchParams): string;
  /** Navigate to another tile (or home, with null) — used by My Plan to link
   * each step to the tile that performs it. */
  navigate(tileId: string | null): void;
  /** Active display locale. */
  locale: string;
  /** Bundled, integrity-gated datasets; null when data failed to load. */
  data: BundledData | null;
  /** The shared session profile (My Situation). Tiles read defaults from it
   * and write user entries back so a value entered once flows everywhere. */
  profile: SituationStore;
}

export interface TileDefinition {
  id: string;
  title: string;
  pillar: Pillar;
  /** One-line description shown on cards and in the palette. */
  description: string;
  /** Extra search terms for the fuzzy palette. */
  keywords: string[];
  /** "ready" tiles mount; "coming-soon" tiles render a placeholder. */
  status: "ready" | "coming-soon";
  /** Mount the interactive tile (required when status is "ready"). */
  mount?: (ctx: TileContext) => void;
  /**
   * Plain-English explanation of how the tool works and the math behind it —
   * shown in a "How this works" section under the tool (warm, helpful, US-only).
   * Paragraphs are separated by blank lines.
   */
  how?: string;
  /** Trusted external resources to learn more (shown as "Learn more" links). */
  resources?: { label: string; url: string }[];
}

/** A learn-more resource link. */
export interface ResourceLink {
  label: string;
  url: string;
}

/** The text the fuzzy palette searches for a tile. */
export function searchText(tile: TileDefinition): string {
  return `${tile.title} ${tile.description} ${tile.keywords.join(" ")}`;
}
