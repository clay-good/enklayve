/**
 * Unemployment Insurance Estimator (SPEC-4-safety-net §B5) — harm tier 1.
 *
 * Unemployment insurance is a federal-state program whose benefit formulas
 * belong entirely to the states, so there is no federal floor to anchor to.
 * The spec's gate follows from that: this ships only as a per-state rule set
 * with coverage stated per state, because a "typical state" figure is worse
 * than nothing for someone deciding whether they can make rent.
 *
 * So the picker lists every state, and a state with no bundled rule set gets a
 * plain sentence saying so and where to find its own estimate — never a figure
 * borrowed from somewhere else. For a bundled state the estimate shows which
 * rule produced the weekly figure and which limit set the total, then lists
 * what the estimate leaves out for that state, from the shard.
 */
import { estimateUi, type UiResult } from "../engine/stateUi";
import { US_STATES, stateName } from "../data/usStates";
import { el, option } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
import { citationLink } from "../ui/resultCard";
import type { StateUiData } from "../data/schemas";
import type { TileContext, TileDefinition } from "./types";

/** Where to find any state's own unemployment office and estimator. */
const STATE_OFFICE_FINDER =
  "https://www.careeronestop.org/LocalHelp/UnemploymentBenefits/find-unemployment-benefits.aspx";

interface Fields {
  stateCode: string;
  quarters: [number, number, number, number];
}

const EXAMPLE: Fields = { stateCode: "TX", quarters: [12000, 10000, 8000, 6000] };

function knownState(code: string | null | undefined): string | undefined {
  const upper = code?.toUpperCase();
  return upper && US_STATES.some((s) => s.code === upper) ? upper : undefined;
}

function readFields(ctx: TileContext): Fields {
  const p = ctx.params;
  const q = (key: string, i: number): number =>
    parseNonNegative(p.get(key), p.has("q1") ? 0 : (EXAMPLE.quarters[i] ?? 0));
  return {
    stateCode:
      knownState(p.get("st")) ?? knownState(ctx.profile.get("stateCode")) ?? EXAMPLE.stateCode,
    quarters: [q("q1", 0), q("q2", 1), q("q3", 2), q("q4", 3)],
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("st", f.stateCode);
  f.quarters.forEach((v, i) => p.set(`q${i + 1}`, String(v)));
  return p;
}

const money = (n: number, locale: string): string =>
  n.toLocaleString(locale, { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** One sentence naming the rule that produced the weekly figure. */
function weeklyLine(r: UiResult, rules: StateUiData, locale: string): string {
  const w = rules.weeklyBenefit;
  const hq = money(r.highQuarterWages, locale);
  switch (r.weeklyBasis) {
    case "schedule":
      return `Your highest quarter, ${hq}, falls on a row of ${rules.name}'s benefit table that pays ${money(r.weeklyBenefit, locale)} a week.`;
    case "maximum":
      return `Your highest quarter, ${hq}, divided by ${w.highQuarterDivisor} is more than ${rules.name}'s weekly maximum, so the maximum applies: ${money(w.maximum, locale)}.`;
    case "minimum":
      return `Your highest quarter, ${hq}, divided by ${w.highQuarterDivisor} is under ${rules.name}'s weekly minimum, so the minimum applies: ${money(w.minimum, locale)}.`;
    default:
      return `Your highest quarter, ${hq}, divided by ${w.highQuarterDivisor} and rounded ${w.rounding} to a whole dollar, is ${money(r.weeklyBenefit, locale)} a week.`;
  }
}

/** One sentence naming the limit that set the total. */
function totalLine(r: UiResult, rules: StateUiData, locale: string): string {
  const d = rules.duration;
  const total = money(r.maxBenefit, locale);
  switch (r.maxBenefitBasis) {
    case "share-of-base-period":
      return `The total is capped by your base-period wages: ${Math.round((d.shareOfBasePeriodWages ?? 0) * 100)}% of ${money(r.basePeriodWages, locale)} is ${total}, less than ${d.maxWeeks} weeks at the full rate, so it runs out after about ${r.weeks} weeks.`;
    case "dollar-cap":
      return `The total is capped by law at ${total}.`;
    default:
      return `The total is ${d.maxWeeks} weeks at the weekly rate: ${total}.`;
  }
}

export function mountUiEstimator(ctx: TileContext): void {
  const { root, data } = ctx;
  root.replaceChildren();
  let fields = readFields(ctx);

  const stateSelect = el(
    "select",
    { attrs: { "aria-label": "State you worked in" } },
    ...US_STATES.map((s) => option(s.code, s.name, s.code === fields.stateCode)),
  );
  stateSelect.value = fields.stateCode;
  const quarterInputs = fields.quarters.map((v, i) =>
    el("input", {
      type: "number",
      min: 0,
      step: 100,
      value: v,
      attrs: { "aria-label": `Wages paid in base-period quarter ${i + 1}`, inputmode: "decimal" },
    }),
  );
  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function unbundled(code: string): HTMLElement[] {
    const covered = (data?.stateUiCodes() ?? []).map((c) => stateName(c.toUpperCase()));
    return [
      el("p", {
        class: "uie-coverage",
        attrs: { role: "note" },
        text: `No estimate for ${stateName(code)} yet. Every state sets its own formula, and a figure from another state would be wrong in a way you could not see. Estimates are available for ${covered.join(", ")}.`,
      }),
      el(
        "p",
        { class: "uie-office" },
        el("a", {
          href: STATE_OFFICE_FINDER,
          text: `Find ${stateName(code)}'s unemployment office and its own estimate`,
          attrs: { target: "_blank", rel: "noopener noreferrer" },
        }),
      ),
    ];
  }

  function render(rules: StateUiData): HTMLElement[] {
    const r = estimateUi({ quarterlyWages: fields.quarters }, rules);
    const locale = ctx.locale;
    const blocks: HTMLElement[] = [
      el("p", { class: "uie-base", text: `Base period in ${rules.name}: ${rules.basePeriod}` }),
    ];
    if (!r.eligible) {
      blocks.push(
        el(
          "p",
          { class: "uie-figure" },
          el("span", {
            text: `These wages do not meet ${rules.name}'s wage test: ${r.shortfalls.join("; ")}. `,
          }),
          citationLink(rules.citation),
        ),
        el("p", {
          class: "uie-detail",
          text: "The agency decides, and it can see wages you may not have entered. If any quarter is missing, add it; if you worked in more than one state, ask about a combined-wage claim.",
        }),
      );
    } else {
      blocks.push(
        el(
          "p",
          { class: "uie-figure" },
          el("span", {
            text: `About ${money(r.weeklyTotal, locale)} a week, up to ${money(r.maxBenefit, locale)} in total. `,
          }),
          citationLink(rules.citation),
        ),
        el("p", { class: "uie-math", text: weeklyLine(r, rules, locale) }),
        el("p", { class: "uie-math", text: totalLine(r, rules, locale) }),
      );
    }
    blocks.push(
      el("h3", { class: "uie-heading", text: `What this leaves out for ${rules.name}` }),
      el("ul", { class: "uie-list" }, ...rules.notModeled.map((n) => el("li", { text: n }))),
    );
    return blocks;
  }

  function compute(): void {
    if (!data) {
      resultContainer.replaceChildren(
        el("div", {
          class: "verify-banner",
          attrs: { role: "alert" },
          text: "The unemployment rules are unavailable, so no estimate is given. Your state's unemployment office can give you one.",
        }),
      );
      return;
    }
    const rules = data.stateUi(fields.stateCode);
    resultContainer.replaceChildren(...(rules ? render(rules) : unbundled(fields.stateCode)));
  }

  function recompute(): void {
    fields = {
      stateCode: knownState(stateSelect.value) ?? fields.stateCode,
      quarters: quarterInputs.map((i) => parseNonNegative(i.value, 0)) as Fields["quarters"],
    };
    ctx.setParams(writeFields(fields));
    compute();
  }

  stateSelect.addEventListener("change", recompute);
  for (const input of quarterInputs) input.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE, quarters: [...EXAMPLE.quarters] };
    stateSelect.value = fields.stateCode;
    quarterInputs.forEach((input, i) => (input.value = String(fields.quarters[i])));
    recompute();
  });

  root.append(
    el(
      "form",
      { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
      field("State you worked in", stateSelect),
      ...quarterInputs.map((input, i) =>
        field(`Wages paid in base-period quarter ${i + 1}`, input),
      ),
      el("div", { class: "tile-form-actions" }, tryExample),
    ),
    resultContainer,
  );
  compute();
}

export const uiEstimatorTile: TileDefinition = {
  id: "ui-estimator",
  title: "Unemployment Benefit Estimate",
  pillar: "rough",
  harmTier: 1,
  description: "Roughly what your state's unemployment insurance pays each week, and for how long.",
  keywords: [
    "unemployment",
    "unemployment insurance",
    "laid off",
    "layoff",
    "lost my job",
    "weekly benefit",
    "ui benefits",
    "reemployment assistance",
  ],
  status: "ready",
  mount: mountUiEstimator,
  how: "Unemployment insurance is run by each state under its own law, so the weekly amount, the wage test and the number of weeks all depend on where you worked. Most states start from your base period: usually the first four of the last five completed calendar quarters before you file. Enter what you were paid in each of those four quarters, from your pay stubs or a W-2 split by quarter.\n\nFrom there each state applies its own formula. Most divide the quarter you earned the most in by a fixed number and keep the result inside a weekly minimum and maximum. The total you can receive in a year is then capped, by a number of weeks, a share of your base-period wages, or both. The estimate shows which rule produced each figure.\n\nEstimates cover only the states whose rules have been read from that state's own agency or statute. For any other state you will see no number at all, because a figure from a different state's formula would be wrong in a way you could not see.\n\nThis is an estimate from published rules applied to wages you entered. It is not a benefits-eligibility determination: only your state's unemployment agency decides whether you qualify and what you are paid, and it also looks at why the job ended and whether you are able and available to work.",
  resources: [
    { label: "Find your state's unemployment office (CareerOneStop)", url: STATE_OFFICE_FINDER },
    {
      label: "U.S. Department of Labor: how unemployment insurance works",
      url: "https://www.dol.gov/general/topic/unemployment-insurance",
    },
  ],
  related: [
    {
      hubId: "when-money-is-tight",
      tool: "life-events",
      label: "Life Events",
      note: "What to do first after losing a job, in order",
    },
    {
      hubId: "when-money-is-tight",
      tool: "enrollment-windows",
      label: "Enrollment & Appeal Windows",
      note: "The health-coverage clocks a job loss starts",
    },
  ],
};
