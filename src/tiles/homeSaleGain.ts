/**
 * Selling a Home: the Taxable Gain (SPEC-5 Phase 28). IRC §121's exclusion,
 * the partial exclusion for a move someone had to make, and the federal tax on
 * what is left through the capital-gains engine. Harm tier 1: a figure the
 * reader checks against their return.
 *
 * The definition is in the shell; the code and its shard load when the tool is
 * opened (SPEC-5 §7.5), from `homeSaleGainView.ts`.
 */
import { lazyMount } from "./lazy";
import type { TileDefinition } from "./types";

export const homeSaleGainTile: TileDefinition = {
  id: "home-sale-gain",
  title: "Selling a Home: the Taxable Gain",
  pillar: "protect",
  harmTier: 1,
  description: "How much of the profit on selling your home is tax-free, and the tax on the rest.",
  keywords: [
    "sell my house",
    "home sale",
    "capital gains on home",
    "section 121",
    "home sale exclusion",
    "two out of five years",
    "selling a house taxes",
  ],
  status: "ready",
  mount: lazyMount(
    () => import("./homeSaleGainView").then((m) => m.mountHomeSaleGain),
    ["home-sale-exclusion-2026"],
  ),
  how: "Selling your home at a profit is usually tax-free, up to a limit. The profit is the sale price, less the costs of selling, less what you paid for the home and any improvements. Federal law excludes up to $250,000 of it, or $500,000 on a joint return, if you owned the home and lived in it as your main home for at least two of the five years before the sale, and you have not used the exclusion on another sale in the two years before.\n\nIf you sold sooner because of a job move, your health, or an unforeseen event, you keep part of the exclusion: the limit times the shorter of the time you owned and lived there and the time since your last excluded sale, out of two years. Eighteen months in a home you left for a new job keeps three quarters of the limit.\n\nWhatever is left is taxed as a capital gain, stacked on your other income: at the long-term rates if you owned the home more than a year, as ordinary income if not, and with the Net Investment Income Tax above its threshold. Those figures come from the same engine and the same cited tables as the capital-gains calculator.\n\nThis leaves out depreciation you took for a home office or a rental, which is taxed whatever the exclusion; gain from years the home was rented out after 2008; a couple where only one spouse lived there; a surviving spouse's larger limit; and state tax. It is federal tax only, on figures you enter, and it is not tax advice.",
  resources: [
    {
      label: "IRS Publication 523, Selling Your Home",
      url: "https://www.irs.gov/publications/p523",
    },
  ],
  related: [
    {
      hubId: "investing",
      tool: "capital-gains",
      label: "Capital Gains",
      note: "The same tax, for any other asset",
    },
  ],
};
