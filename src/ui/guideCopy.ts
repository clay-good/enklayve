/**
 * The anti-budget: the site's whole stance on budgeting and investing, as data.
 *
 * It closes the home page, which the shell renders in the browser, so a crawler
 * that does not run JavaScript never saw it: the one argument the site leads
 * with was the one part of it nobody could find by searching. It is now rendered
 * in two places from these strings, the home (shell.ts) and the static guide at
 * `/guides/anti-budget` (scripts/guides.ts), so neither can drift from the other.
 */

export const ANTI_BUDGET_TITLE = "The anti-budget: give every dollar a job";

export const ANTI_BUDGET_SECTIONS: { heading?: string; body: string }[] = [
  {
    body: "Most budgets fail because they run on willpower, and willpower runs out by week three. So flip it. Decide where every dollar goes before the month starts. When the choice is already made, there is nothing left to fight at the store.",
  },
  {
    heading: "Then make it automatic",
    body: "Get yourself out of the way. Turn on automatic 401(k), IRA, and HSA contributions so the money moves before you can spend it. Put every bill on autopay. Set money to move to savings on payday. You are building a little robot that grows your money while you sleep, and the robot never gets tired or tempted.",
  },
  {
    heading: "Fund things in this order",
    body: "Grab your full 401(k) match first, because it is free money. Then pay off high-interest debt fast, since clearing a 24% card is a guaranteed 24% raise. Then save six months of expenses in a high-yield savings account. After that, invest in this order: 401(k), traditional IRA, HSA, then a regular brokerage. Once it all runs on autopilot, buy whatever future you believe in, from a rental house to index funds to a rare Charizard.",
  },
  {
    heading: "Just do the next thing",
    body: "That is the whole plan, and you do not need a separate dashboard to run it. Look at your budget to see where you stand, then find the first line here you have not finished and do only that one. Cushion, match, debt, six-month fund, then invest, one move at a time. Knowing where you stand is just knowing which line you are on. The rest is patience and autopay.",
  },
];
