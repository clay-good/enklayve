/**
 * Social Security Claiming Age tile (BUILD-SPEC-2 §6.7): compare the monthly
 * benefit at different claiming ages, deterministically from the published SSA
 * formula. You enter your Primary Insurance Amount (the benefit at Full
 * Retirement Age, printed on your SSA statement) and your birth year; the tile
 * shows what claiming early (a permanent reduction) or late (delayed-retirement
 * credits to age 70) does. Every figure cites the SSA rule. Information, not
 * advice — it does not estimate your earnings record.
 */
import { Money } from "../engine/money";
import { socialSecurityBenefit } from "../engine/socialSecurity";
import { el, option } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import type { TileContext, TileDefinition } from "./types";

interface Fields {
  pia: number;
  bornYear: number;
  claimAge: number;
}

const EXAMPLE: Fields = { pia: 2000, bornYear: 1965, claimAge: 62 };

function readFields(p: URLSearchParams): Fields {
  return {
    pia: parseNonNegative(p.get("pia"), 0),
    bornYear: Math.round(parseNonNegative(p.get("born"), 1965)),
    claimAge: Math.round(parseNonNegative(p.get("age"), 67)),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("pia", String(f.pia));
  p.set("born", String(f.bornYear));
  p.set("age", String(f.claimAge));
  return p;
}

/** Format a whole-month age as "67" or "66 and 2 months". */
function formatAge(months: number): string {
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem === 0 ? `${years}` : `${years} and ${rem} month${rem === 1 ? "" : "s"}`;
}

export function mountSocialSecurity(ctx: TileContext): void {
  const { root, data } = ctx;
  root.replaceChildren();
  const ss = data?.socialSecurity();
  if (!ss) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "Social Security rule data is unavailable, verify before relying on any figure.",
      }),
    );
    return;
  }

  let fields = readFields(ctx.params);

  const piaInput = el("input", {
    type: "number",
    name: "pia",
    min: 0,
    step: 50,
    value: fields.pia,
    attrs: { "aria-label": "Monthly benefit at full retirement age (PIA)", inputmode: "decimal" },
  });
  const bornInput = el("input", {
    type: "number",
    name: "born",
    min: 0,
    step: 1,
    value: fields.bornYear,
    attrs: { "aria-label": "Birth year", inputmode: "numeric" },
  });
  const claimAges: number[] = [];
  for (let a = ss.earliestClaimAge; a <= ss.delayedCreditMaxAge; a++) claimAges.push(a);
  const ageSelect = el(
    "select",
    { name: "age", attrs: { "aria-label": "Claiming age" } },
    ...claimAges.map((a) => option(String(a), String(a), a === fields.claimAge)),
  );

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const chosen = socialSecurityBenefit(fields.pia, fields.bornYear, fields.claimAge, ss!);
    const atEarliest = socialSecurityBenefit(
      fields.pia,
      fields.bornYear,
      ss!.earliestClaimAge,
      ss!,
    );
    const atFra = socialSecurityBenefit(fields.pia, fields.bornYear, chosen.fraMonths / 12, ss!);
    const atMax = socialSecurityBenefit(fields.pia, fields.bornYear, ss!.delayedCreditMaxAge, ss!);
    const fmt = (m: Money): string => m.format(ctx.locale);
    const cite = ss!.citation;

    const lines: BreakdownLine[] = [
      {
        label: `Full retirement age for ${fields.bornYear}`,
        value: `age ${formatAge(chosen.fraMonths)}`,
        citation: cite,
      },
      {
        label: `If you claim at ${ss!.earliestClaimAge} (earliest)`,
        value: `${fmt(atEarliest.monthlyBenefit)}/mo`,
        citation: cite,
      },
      {
        label: `If you claim at full retirement age`,
        value: `${fmt(atFra.monthlyBenefit)}/mo`,
        citation: cite,
      },
      {
        label: `If you claim at ${ss!.delayedCreditMaxAge} (max credits)`,
        value: `${fmt(atMax.monthlyBenefit)}/mo`,
        citation: cite,
      },
      {
        label: `Your choice: age ${fields.claimAge}`,
        value: `${fmt(chosen.monthlyBenefit)}/mo · ${fmt(chosen.monthlyBenefit.multiply(12))}/yr`,
        emphasis: true,
      },
    ];

    resultContainer.replaceChildren(
      resultCard({
        label: `Estimated monthly benefit at age ${fields.claimAge}`,
        value: chosen.monthlyBenefit,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function recompute(): void {
    fields = {
      pia: parseNonNegative(piaInput.value, 0),
      bornYear: Math.round(parseNonNegative(bornInput.value, 1965)),
      claimAge: Math.round(parseNonNegative(ageSelect.value, 67)),
    };
    ctx.setParams(writeFields(fields));
    compute();
  }

  for (const i of [piaInput, bornInput]) i.addEventListener("input", recompute);
  ageSelect.addEventListener("change", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    piaInput.value = String(fields.pia);
    bornInput.value = String(fields.bornYear);
    ageSelect.value = String(fields.claimAge);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Monthly benefit at full retirement age", piaInput),
    field("Birth year", bornInput),
    field("Claiming age", ageSelect),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const socialSecurityTile: TileDefinition = {
  id: "social-security",
  title: "Social Security Claiming Age",
  pillar: "retirement",
  description: "Compare your benefit at 62, full retirement age, and 70.",
  keywords: [
    "social security",
    "claiming age",
    "retirement",
    "delayed retirement credits",
    "full retirement age",
    "ssa",
  ],
  status: "ready",
  how: "Your Social Security retirement benefit is built around your Primary Insurance Amount (PIA): the monthly benefit you'd get at your Full Retirement Age (FRA). Your SSA statement lists it. Claim before FRA and the benefit is permanently reduced (5/9 of 1% per month for the first 36 months early, then 5/12 of 1%); wait past FRA and you earn delayed-retirement credits of 2/3 of 1% per month (8% per year) up to age 70.\n\nWe apply that published formula to the PIA and birth year you enter, so you can compare claiming at 62, at FRA, and at 70. We don't estimate your earnings record; start from the PIA on your statement. When you actually claim depends on your health, other income, and a spouse's benefit, so treat this as a comparison, not advice.",
  resources: [
    {
      label: "SSA, benefit reduction for early retirement",
      url: "https://www.ssa.gov/benefits/retirement/planner/agereduction.html",
    },
    {
      label: "SSA, delayed retirement credits",
      url: "https://www.ssa.gov/benefits/retirement/planner/delayret.html",
    },
  ],
  related: [
    {
      hubId: "retirement",
      tool: "retirement-drawdown",
      label: "Retirement Drawdown",
      note: "how long your savings last alongside this benefit",
    },
  ],
  mount: mountSocialSecurity,
};
