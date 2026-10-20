/**
 * Spousal and Survivor Benefits, the interactive half (SPEC-5 Phase 29).
 * Loaded on first use with its shard; the definition in `ssSpousalSurvivor.ts`
 * stays in the shell. The reader's own benefit comes from the claiming tile's
 * engine and shard.
 */
import { Money } from "../engine/money";
import { fullRetirementAgeMonths, socialSecurityBenefit } from "../engine/socialSecurity";
import { spousalBenefit, survivorBenefit, survivorFraMonths } from "../engine/ssFamily";
import { el, option } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import type { TileContext } from "./types";

interface Fields {
  worker: number;
  own: number;
  born: number;
  claim: number;
}

const EXAMPLE: Fields = { worker: 2400, own: 900, born: 1963, claim: 64 };

/** "66 and 8 months" from a count of months. */
function ageLabel(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  return m === 0 ? `${y}` : `${y} and ${m} month${m === 1 ? "" : "s"}`;
}

export function mountSsSpousalSurvivor(ctx: TileContext): void {
  const { root, data } = ctx;
  root.replaceChildren();
  const rules = data?.ssFamilyBenefits();
  const ss = data?.socialSecurity();
  if (!rules || !ss) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "The spousal and survivor rules are unavailable, so no benefit is given. Social Security can tell you what you would receive.",
      }),
    );
    return;
  }
  const p = ctx.params;
  let fields: Fields = {
    worker: parseNonNegative(p.get("wpia"), 0),
    own: parseNonNegative(p.get("opia"), 0),
    born: Math.round(parseNonNegative(p.get("born"), ctx.profile.get("birthYear") ?? 1963)),
    claim: Math.min(
      70,
      Math.max(rules.earliestSurvivorAge, Math.round(parseNonNegative(p.get("age"), 67))),
    ),
  };
  const write = (f: Fields): URLSearchParams =>
    new URLSearchParams({
      wpia: String(f.worker),
      opia: String(f.own),
      born: String(f.born),
      age: String(f.claim),
    });

  const num = (name: string, value: number, label: string, step: number) =>
    el("input", {
      type: "number",
      name,
      min: 0,
      step,
      value,
      attrs: { "aria-label": label, inputmode: "decimal" },
    });
  const workerInput = num(
    "wpia",
    fields.worker,
    "Your spouse's benefit at full retirement age (PIA)",
    50,
  );
  const ownInput = num(
    "opia",
    fields.own,
    "Your own benefit at full retirement age (PIA), if any",
    50,
  );
  const bornInput = num("born", fields.born, "Your birth year", 1);
  const ages: number[] = [];
  for (let a = rules.earliestSurvivorAge; a <= 70; a++) ages.push(a);
  const ageSelect = el(
    "select",
    { name: "age", attrs: { "aria-label": "Age you would claim at" } },
    ...ages.map((a) => option(String(a), String(a), a === fields.claim)),
  );
  ageSelect.value = String(fields.claim);

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const fmt = (m: Money): string => m.format(ctx.locale);
    const cite = rules!.citation;
    const claimMonths = fields.claim * 12;
    const fra = fullRetirementAgeMonths(fields.born, ss!);
    const survivorFra = survivorFraMonths(fields.born, rules!);
    const spousalAge = Math.max(rules!.earliestSpousalAge * 12, claimMonths);
    const spousal = spousalBenefit(fields.worker, fra, spousalAge, rules!);
    const own =
      fields.own > 0
        ? socialSecurityBenefit(
            fields.own,
            fields.born,
            Math.max(spousalAge, ss!.earliestClaimAge * 12) / 12,
            ss!,
          ).monthlyBenefit
        : Money.zero();
    const at = (months: number) =>
      survivorBenefit(fields.worker, survivorFra, months, rules!).monthly;
    const lines: BreakdownLine[] = [
      {
        label: `As a spouse, claiming at ${ageLabel(spousalAge)} (full retirement age ${ageLabel(fra)})`,
        value: `${fmt(spousal.monthly)}/mo`,
        citation: cite,
      },
    ];
    if (fields.own > 0)
      lines.push(
        {
          label: `On your own record at the same age`,
          value: `${fmt(own)}/mo`,
          citation: ss!.citation,
        },
        {
          label: own.greaterThan(spousal.monthly)
            ? "Your own record pays more; claiming pays you that, not both"
            : "The spousal amount pays more; Social Security pays the higher, not both",
          value: `${fmt(own.greaterThan(spousal.monthly) ? own : spousal.monthly)}/mo`,
          emphasis: true,
        },
      );
    lines.push(
      {
        label: `As a survivor at ${rules!.earliestSurvivorAge}, the earliest`,
        value: `${fmt(at(rules!.earliestSurvivorAge * 12))}/mo`,
        citation: cite,
      },
      {
        label: `As a survivor at ${ageLabel(claimMonths)}`,
        value: `${fmt(at(claimMonths))}/mo`,
        citation: cite,
      },
      {
        label: `As a survivor at your survivor full retirement age, ${ageLabel(survivorFra)}`,
        value: `${fmt(at(survivorFra))}/mo`,
        citation: cite,
      },
    );
    resultContainer.replaceChildren(
      resultCard({
        label: "Your spousal benefit a month",
        value: spousal.monthly,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(write(fields)),
      }),
      el("p", {
        class: "sss-limits",
        text: "If your spouse claimed early, the survivor amount can be capped below these figures, and a spouse or survivor caring for the worker's child who gets benefits is not reduced in those months. Neither is computed here.",
      }),
    );
  }

  function recompute(): void {
    fields = {
      worker: parseNonNegative(workerInput.value, 0),
      own: parseNonNegative(ownInput.value, 0),
      born: Math.round(parseNonNegative(bornInput.value, 1963)),
      claim: Math.round(parseNonNegative(ageSelect.value, 67)),
    };
    ctx.setParams(write(fields));
    compute();
  }

  for (const i of [workerInput, ownInput, bornInput]) i.addEventListener("input", recompute);
  ageSelect.addEventListener("change", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    workerInput.value = String(fields.worker);
    ownInput.value = String(fields.own);
    bornInput.value = String(fields.born);
    ageSelect.value = String(fields.claim);
    recompute();
  });

  root.append(
    el(
      "form",
      { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
      field("Your spouse's benefit at full retirement age (PIA)", workerInput),
      field("Your own benefit at full retirement age (PIA), if any", ownInput),
      field("Your birth year", bornInput),
      field("Age you would claim at", ageSelect),
      el("div", { class: "tile-form-actions" }, tryExample),
    ),
    resultContainer,
  );
  compute();
}
