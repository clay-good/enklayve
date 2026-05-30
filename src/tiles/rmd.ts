/**
 * Required Minimum Distribution tile (BUILD-SPEC.md §3.4): your RMD for the year
 * from the IRS Uniform Lifetime Table. RMD = prior-year-end balance ÷ the
 * distribution period for your age. RMDs begin at the dataset's begin age (73
 * for 2024 under SECURE 2.0); below that the tile says so plainly rather than
 * inventing a number. Every figure cites IRS Pub 590-B.
 */
import { Money } from "../engine/money";
import { requiredMinimumDistribution } from "../engine/rmd";
import { el } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import type { TileContext, TileDefinition } from "./types";

interface Fields {
  age: number;
  balance: number;
}

const EXAMPLE: Fields = { age: 75, balance: 500000 };

function readFields(p: URLSearchParams): Fields {
  return {
    age: Math.round(parseNonNegative(p.get("age"), 73)),
    balance: parseNonNegative(p.get("bal"), 0),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("age", String(f.age));
  p.set("bal", String(f.balance));
  return p;
}

export function mountRmd(ctx: TileContext): void {
  const { root, data } = ctx;
  root.replaceChildren();
  const rmd = data?.rmd();
  if (!rmd) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "RMD table data is unavailable, verify before relying on any figure.",
      }),
    );
    return;
  }

  let fields = readFields(ctx.params);

  const ageInput = el("input", {
    type: "number",
    name: "age",
    min: 0,
    step: 1,
    value: fields.age,
    attrs: { "aria-label": "Your age this year", inputmode: "numeric" },
  });
  const balInput = el("input", {
    type: "number",
    name: "bal",
    min: 0,
    step: 1000,
    value: fields.balance,
    attrs: { "aria-label": "Account balance on December 31 last year", inputmode: "decimal" },
  });

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const result = requiredMinimumDistribution(fields.age, fields.balance, rmd!);
    const fmt = (m: Money): string => m.format(ctx.locale);

    if (!result.required) {
      resultContainer.replaceChildren(
        el("div", {
          class: "plan-next",
          text: `No RMD is required yet. Required minimum distributions begin at age ${result.beginAge}; you have time before the first one is due.`,
        }),
      );
      return;
    }

    const lines: BreakdownLine[] = [
      { label: "Prior year-end balance", value: fmt(Money.from(fields.balance)) },
      {
        label: `Distribution period at age ${fields.age}`,
        value: String(result.distributionPeriod),
        citation: rmd!.citation,
      },
      {
        label: "Required minimum distribution",
        value: fmt(result.amount),
        citation: rmd!.citation,
        emphasis: true,
      },
    ];

    resultContainer.replaceChildren(
      resultCard({
        label: "Your required minimum distribution this year",
        value: result.amount,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function collect(): void {
    fields = {
      age: Math.round(parseNonNegative(ageInput.value, 73)),
      balance: parseNonNegative(balInput.value, 0),
    };
  }

  function recompute(): void {
    collect();
    ctx.setParams(writeFields(fields));
    compute();
  }

  for (const i of [ageInput, balInput]) i.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    ageInput.value = String(fields.age);
    balInput.value = String(fields.balance);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Your age this year", ageInput),
    field("Balance on Dec 31 last year", balInput),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const rmdTile: TileDefinition = {
  id: "rmd",
  title: "Required Minimum Distribution",
  pillar: "retirement",
  description: "Your RMD schedule from the IRS Uniform Lifetime Table.",
  keywords: ["rmd", "required minimum distribution", "retirement", "401k", "ira", "590-b"],
  status: "ready",
  how: "Once you reach the required age (73 for 2024 under the SECURE 2.0 Act), the IRS requires you to withdraw a minimum amount from tax-deferred retirement accounts each year. We divide your account balance on December 31 of last year by the distribution period (a life-expectancy factor) for your age from the IRS Uniform Lifetime Table.\n\nThe Uniform Lifetime Table applies to most owners. A different table applies if your sole beneficiary is a spouse more than ten years younger, so verify your situation with the IRS or your plan administrator.",
  resources: [
    {
      label: "IRS, required minimum distributions",
      url: "https://www.irs.gov/retirement-plans/required-minimum-distributions-rmds",
    },
    { label: "IRS Publication 590-B", url: "https://www.irs.gov/publications/p590b" },
  ],
  mount: mountRmd,
};
