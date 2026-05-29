/**
 * Retirement Drawdown + RMD Timeline tile (BUILD-SPEC-2 §6.7): how long your
 * savings last in retirement, and when required minimum distributions begin.
 * Projects the balance year by year in today's dollars — a real (after-inflation)
 * return, never a market forecast (§2.1) — withdrawing the greater of your chosen
 * amount and the RMD from the bundled IRS Uniform Lifetime Table (cited). Reframed
 * for calm: it shows where you stand, not a verdict.
 */
import { Money } from "../engine/money";
import { retirementDrawdown } from "../engine/finance";
import { el } from "../ui/dom";
import { field, parseNonNegative, parseNumber, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import type { TileContext, TileDefinition } from "./types";

const MAX_AGE = 100;

interface Fields {
  balance: number;
  age: number;
  withdrawal: number;
  realReturnPct: number;
}

const EXAMPLE: Fields = { balance: 800000, age: 65, withdrawal: 40000, realReturnPct: 4 };

function readFields(p: URLSearchParams): Fields {
  return {
    balance: parseNonNegative(p.get("bal"), 0),
    age: Math.round(parseNonNegative(p.get("age"), 65)),
    withdrawal: parseNonNegative(p.get("w"), 0),
    realReturnPct: parseNumber(p.get("r"), 4),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("bal", String(f.balance));
  p.set("age", String(f.age));
  p.set("w", String(f.withdrawal));
  p.set("r", String(f.realReturnPct));
  return p;
}

export function mountDrawdown(ctx: TileContext): void {
  const { root, data } = ctx;
  root.replaceChildren();
  const rmd = data?.rmd() ?? null;
  let fields = readFields(ctx.params);

  const mkNum = (name: string, label: string, value: number, step: number): HTMLInputElement =>
    el("input", {
      type: "number",
      name,
      min: 0,
      step,
      value,
      attrs: { "aria-label": label, inputmode: "decimal" },
    });
  const balInput = mkNum("bal", "Retirement savings balance", fields.balance, 5000);
  const ageInput = mkNum("age", "Your age now", fields.age, 1);
  const wInput = mkNum("w", "Annual withdrawal (today's dollars)", fields.withdrawal, 1000);
  const rInput = el("input", {
    type: "number",
    name: "r",
    step: 0.25,
    value: fields.realReturnPct,
    attrs: { "aria-label": "Real return after inflation (percent)", inputmode: "decimal" },
  });

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    resultContainer.replaceChildren();
    if (fields.balance <= 0) {
      resultContainer.append(
        el("p", {
          class: "ph-empty",
          text: "Enter your retirement savings balance to project it.",
        }),
      );
      return;
    }
    const r = retirementDrawdown(
      {
        currentBalance: fields.balance,
        currentAge: fields.age,
        annualWithdrawal: fields.withdrawal,
        realReturnPct: fields.realReturnPct,
        maxAge: MAX_AGE,
      },
      rmd,
    );
    const fmt = (m: Money): string => m.format(ctx.locale);

    const lines: BreakdownLine[] = [
      { label: "Annual withdrawal", value: fmt(Money.from(fields.withdrawal)) },
      {
        label: "Where you stand",
        value: r.lastsToMaxAge
          ? `Still funded at age ${MAX_AGE} — your savings outlast the projection.`
          : `Your savings run dry around age ${r.depletedAtAge}.`,
        emphasis: true,
      },
    ];
    if (r.firstRmdAge !== null && rmd) {
      const firstRmd = r.timeline.find((y) => y.age === r.firstRmdAge);
      lines.push({
        label: `First required distribution (age ${r.firstRmdAge})`,
        value: firstRmd ? fmt(firstRmd.rmd) : "—",
        citation: rmd.citation,
      });
    }
    // A few milestone balances so the path is visible without a 40-row table.
    for (const milestone of [fields.age + 10, fields.age + 20]) {
      const row = r.timeline.find((y) => y.age === milestone);
      if (row) lines.push({ label: `Balance at age ${milestone}`, value: fmt(row.endBalance) });
    }
    lines.push({ label: "Total withdrawn", value: fmt(r.totalWithdrawn) });

    const headlineFormat = (n: number): string =>
      r.lastsToMaxAge ? `${MAX_AGE - fields.age}+ years` : `${Math.round(n)} years`;

    resultContainer.append(
      resultCard({
        label: "How long your savings last",
        value: Money.from(r.yearsLasting),
        locale: ctx.locale,
        breakdown: lines,
        format: headlineFormat,
        copyText: headlineFormat(r.yearsLasting),
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function recompute(): void {
    fields = {
      balance: parseNonNegative(balInput.value, 0),
      age: Math.round(parseNonNegative(ageInput.value, 65)),
      withdrawal: parseNonNegative(wInput.value, 0),
      realReturnPct: parseNumber(rInput.value, 4),
    };
    ctx.setParams(writeFields(fields));
    compute();
  }

  for (const i of [balInput, ageInput, wInput, rInput]) i.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    balInput.value = String(fields.balance);
    ageInput.value = String(fields.age);
    wInput.value = String(fields.withdrawal);
    rInput.value = String(fields.realReturnPct);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Retirement savings balance", balInput),
    field("Your age now", ageInput),
    field("Annual withdrawal (today's dollars)", wInput),
    field("Real return after inflation (%)", rInput),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const drawdownTile: TileDefinition = {
  id: "retirement-drawdown",
  title: "Retirement Drawdown & RMD Timeline",
  pillar: "safe-harbor",
  description: "How long your savings last, with required distributions.",
  keywords: ["drawdown", "retirement", "rmd", "withdrawal", "4% rule", "decumulation"],
  status: "ready",
  how: "This projects your retirement savings forward year by year. Each year it withdraws the amount you choose — or the required minimum distribution once you reach the required age (73 for 2024), whichever is larger — then grows what's left. Everything is in today's dollars: you enter a real (after-inflation) return, so the numbers stay comparable to today and we never have to guess at future inflation or markets.\n\nIt's a planning estimate, not advice. A real return is the return above inflation (for example, a 7% return with 3% inflation is roughly a 4% real return). The required-distribution figures come from the IRS Uniform Lifetime Table and cite it. Sequence-of-returns risk — a bad market early in retirement — isn't modeled here, so treat the 'lasts to' age as a calm guide, not a guarantee.",
  resources: [
    {
      label: "IRS, required minimum distributions",
      url: "https://www.irs.gov/retirement-plans/required-minimum-distributions-rmds",
    },
    { label: "Investor.gov, retirement", url: "https://www.investor.gov/" },
  ],
  mount: mountDrawdown,
};
