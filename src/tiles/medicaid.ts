/**
 * Medicaid Threshold tile (BUILD-SPEC.md §4.3): adult MAGI eligibility by state,
 * distinguishing expansion from non-expansion states. In an expansion state an
 * adult at or below the threshold (138% FPL, or a state override) is likely
 * eligible; in a non-expansion state adult coverage is limited and
 * category-specific, so the tile says so rather than invent a number. Cited to
 * Medicaid.gov. The poverty line follows the state's region (AK and HI differ).
 */
import { Money } from "../engine/money";
import { medicaidEligibility } from "../engine/benefits";
import { el, option } from "../ui/dom";
import {
  field,
  fplPercentDigits,
  fplPercentText,
  parseNonNegative,
  tryExampleButton,
} from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import { US_STATES, fplRegionFor, stateName } from "../data/usStates";
import type { SituationStore } from "../profile/situation";
import type { TileContext, TileDefinition } from "./types";

interface Fields {
  stateCode: string;
  householdSize: number;
  income: number;
}

const EXAMPLE: Fields = { stateCode: "OH", householdSize: 1, income: 18000 };

/** A state code this tile can render, or `undefined` — case-insensitively. */
function knownState(code: string | null | undefined): string | undefined {
  const upper = code?.toUpperCase();
  return upper && US_STATES.some((s) => s.code === upper) ? upper : undefined;
}

function readFields(p: URLSearchParams, profile: SituationStore): Fields {
  return {
    // Household size and income came from My Situation from the day this tile
    // was built; the state did not, and it is the field the answer turns on --
    // whether the reader's state expanded Medicaid at all. Somebody who had
    // told the site where they live five tiles ago opened this one and was
    // shown California. My Situation stores the code lowercase, this tile
    // renders it upper, so the comparison is case-insensitive.
    stateCode: knownState(p.get("st")) ?? knownState(profile.get("stateCode")) ?? "CA",
    householdSize: p.has("hh")
      ? Math.max(1, parseNonNegative(p.get("hh"), 1))
      : (profile.get("householdSize") ?? 1),
    income: p.has("inc") ? parseNonNegative(p.get("inc"), 0) : (profile.get("annualIncome") ?? 0),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("st", f.stateCode);
  p.set("hh", String(f.householdSize));
  p.set("inc", String(f.income));
  return p;
}

export function mountMedicaid(ctx: TileContext): void {
  const { root, data, profile } = ctx;
  root.replaceChildren();
  const medicaid = data?.medicaid();
  if (!medicaid) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "Medicaid data is unavailable, verify before relying on any figure.",
      }),
    );
    return;
  }
  let fields = readFields(ctx.params, profile);
  /**
   * Whether the state on screen is the reader's answer or this tile's fallback.
   *
   * Same shape as Charity Care: this dropdown lists the 51 by name and has no
   * "no state" entry, so a reader who chose that answer elsewhere has to be
   * seeded with something, and writing that something back would decide where
   * they live because they typed an income.
   */
  let stateIsReaders = knownState(ctx.params.get("st") ?? profile.get("stateCode")) !== undefined;

  const stSelect = el(
    "select",
    { name: "st", attrs: { "aria-label": "State" } },
    ...US_STATES.map((s) => option(s.code, s.name, s.code === fields.stateCode)),
  );
  // The element's value is authoritative for the intended state, the same way
  // Take-Home's and Charity Care's are: `recompute()` reads `stSelect.value`,
  // so leaving the choice to the options' `selected` attributes lets a later
  // read pick up a default the tile never intended.
  stSelect.value = fields.stateCode;
  const hhInput = el("input", {
    type: "number",
    name: "hh",
    min: 1,
    step: 1,
    value: fields.householdSize,
    attrs: { "aria-label": "Household size", inputmode: "numeric" },
  });
  const incInput = el("input", {
    type: "number",
    name: "inc",
    min: 0,
    step: 1000,
    value: fields.income,
    attrs: { "aria-label": "Annual household income", inputmode: "decimal" },
  });

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const fpl = data!.fpl(fplRegionFor(fields.stateCode));
    if (!fpl) return;
    const r = medicaidEligibility(
      { stateCode: fields.stateCode, income: fields.income, householdSize: fields.householdSize },
      medicaid!,
      fpl,
    );
    const name = stateName(fields.stateCode);

    const lines: BreakdownLine[] = [
      {
        label: "Medicaid expansion",
        value: r.expansionState ? `${name} expanded Medicaid` : `${name} has not expanded Medicaid`,
        citation: medicaid!.citation,
      },
      {
        label: "Income as % of poverty line",
        // The state's own threshold is what this tile decides with — 138% in
        // most expansion states, 215% in DC — so that is the line the printed
        // figure must not be rounded onto.
        value: fplPercentText(r.fplPercent, r.thresholdPctFpl === null ? [] : [r.thresholdPctFpl]),
        citation: fpl.citation,
      },
    ];
    if (r.expansionState && r.thresholdPctFpl !== null) {
      lines.push({
        label: "Adult eligibility threshold",
        value: `${r.thresholdPctFpl}% of the poverty line`,
        citation: medicaid!.citation,
      });
    }
    lines.push({
      label: "Likely eligible (adult, by income)",
      value:
        r.eligible === null
          ? "Limited (see note)"
          : r.eligible
            ? "Yes, at this income"
            : "No, income is above the threshold",
      emphasis: true,
      citation: medicaid!.citation,
    });
    lines.push({
      label: "Note",
      value: r.expansionState
        ? "Based on adult MAGI eligibility. Children, pregnancy, and disability have separate, often higher, thresholds."
        : "This state hasn't expanded Medicaid, so most adults without children don't qualify on income alone. Parents, pregnant people, children (CHIP), and people with disabilities may still qualify under separate rules; check your state.",
    });

    resultContainer.replaceChildren(
      resultCard({
        label: "Medicaid eligibility check",
        // Headline is the FPL %, so the count-up has a meaningful number.
        value: Money.from(r.fplPercent),
        locale: ctx.locale,
        format: (n) =>
          `${n.toFixed(fplPercentDigits(r.fplPercent, r.thresholdPctFpl === null ? [] : [r.thresholdPctFpl]))}% of poverty line`,
        copyText: `${fplPercentText(r.fplPercent, r.thresholdPctFpl === null ? [] : [r.thresholdPctFpl])} FPL`,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function recompute(): void {
    fields = {
      stateCode: stSelect.value,
      householdSize: Math.max(1, parseNonNegative(hhInput.value, 1)),
      income: parseNonNegative(incInput.value, 0),
    };
    ctx.setParams(writeFields(fields));
    if (stateIsReaders) profile.set("stateCode", fields.stateCode.toLowerCase());
    profile.set("householdSize", fields.householdSize);
    profile.set("annualIncome", fields.income);
    compute();
  }

  stSelect.addEventListener("change", () => {
    stateIsReaders = true;
    recompute();
  });
  for (const i of [hhInput, incInput]) i.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    stateIsReaders = true;
    fields = { ...EXAMPLE };
    stSelect.value = fields.stateCode;
    hhInput.value = String(fields.householdSize);
    incInput.value = String(fields.income);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("State", stSelect),
    field("Household size", hhInput),
    field("Annual household income", incInput),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const medicaidTile: TileDefinition = {
  id: "medicaid",
  title: "Medicaid Threshold",
  pillar: "owed",
  description: "MAGI thresholds by state, expansion vs non-expansion.",
  keywords: ["medicaid", "magi", "health", "expansion", "coverage"],
  status: "ready",
  how: "Most adult Medicaid eligibility is based on modified adjusted gross income (MAGI) as a percentage of the federal poverty line. In states that expanded Medicaid under the Affordable Care Act, adults at or below 138% of the poverty line are generally eligible (DC covers adults to 215%). We compute your percentage of the line for your state's region and compare it to the threshold.\n\nIn states that did not expand, there is usually no broad coverage for adults on income alone; eligibility is limited to specific groups like parents, pregnant people, children, and people with disabilities, often at much lower income limits. We tell you your state's expansion status and flag this rather than guess a precise number. The agency makes the final determination.",
  resources: [
    {
      label: "Medicaid.gov, eligibility",
      url: "https://www.medicaid.gov/medicaid/eligibility-policy",
    },
    { label: "HealthCare.gov, Medicaid & CHIP", url: "https://www.healthcare.gov/medicaid-chip/" },
  ],
  mount: mountMedicaid,
};
