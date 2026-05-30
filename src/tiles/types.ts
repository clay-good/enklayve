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

export interface PillarMeta {
  id: Pillar;
  title: string;
  blurb: string;
}

export const PILLARS: PillarMeta[] = [
  { id: "paycheck", title: "Paycheck & Taxes", blurb: "Your real take-home and what you owe." },
  {
    id: "investing",
    title: "Investing",
    blurb: "Capital gains, growth, and the dollar over time.",
  },
  {
    id: "retirement",
    title: "Retirement",
    blurb: "Contributions, Roth moves, Social Security, and drawdown.",
  },
  { id: "debt", title: "Borrowing & Debt", blurb: "Loans, mortgages, and a clear payoff date." },
  {
    id: "budget",
    title: "Budgeting & Cash Flow",
    blurb: "Give every dollar a job and spot tight days.",
  },
  {
    id: "protect",
    title: "Home, Family & Protection",
    blurb: "Big purchases, insurance, and your estate basics.",
  },
  { id: "owed", title: "Benefits & Aid", blurb: "Benefits and aid you may qualify for." },
  {
    id: "stand",
    title: "Where You Stand",
    blurb: "Your calm overview and the next right step.",
  },
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
