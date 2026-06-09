/**
 * Tile contract (BUILD-SPEC.md §12, Phase 4/5). A tile is a self-contained
 * calculator that renders into a mount point, reads and writes its state
 * through the URL fragment, and reads bundled data through the shared context.
 * The shell knows nothing about any individual tile beyond this interface, so
 * adding a tile is registering data + a mount function — never editing the shell.
 */
import type { BundledData } from "../data/browser";
import type { SituationStore } from "../profile/situation";

/**
 * Topic groups for browsing (the home cards and the All Tools index group by
 * these). Originally the spec's three pillars; reorganized 2026-05-29 into eight
 * smaller, plainly-named money areas so no single card is a 27-tool dumping
 * ground (the browse taxonomy; see BUILD-SPEC-2 §1.5). The
 * shared inputs (income, filing status, state, household, savings, debts) still
 * flow through My Situation, so a value entered in one group prefills any other.
 */
export type Pillar =
  | "paycheck"
  | "investing"
  | "retirement"
  | "debt"
  | "budget"
  | "protect"
  | "owed"
  | "stand";

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
   * each step to the tile that performs it. The optional params deep-link into
   * a hub's specific sub-tool (e.g. `?tool=eitc`). */
  navigate(tileId: string | null, params?: URLSearchParams): void;
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
  /**
   * Sibling tools a user mid-decision usually wants next (SPEC-3 §4.1). Rendered
   * as in-app "Related tools" links under the calculator; navigating carries the
   * shared profile (filing status, income) over automatically. `hubId` is the
   * target hub and `tool` its sub-tool id; `note` is a one-line "why".
   */
  related?: { hubId: string; tool?: string; label: string; note?: string }[];
}
