/**
 * Social Security Earnings Test, the interactive half (SPEC-5 Phase 29). Loaded
 * on first use with its shard; the definition in `ssEarningsTest.ts` stays in
 * the shell.
 */
import { Money } from "../engine/money";
import { earningsTest } from "../engine/ssFamily";
import { el, option } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import type { TileContext } from "./types";

interface Fields {
  benefit: number;
  stage: "before" | "this-year";
  earnings: number;
  months: number;
}

const EXAMPLE: Fields = { benefit: 1800, stage: "before", earnings: 40000, months: 12 };

function readFields(p: URLSearchParams): Fields {
  const stage = p.get("st") === "this-year" ? "this-year" : "before";
  return {
    benefit: parseNonNegative(p.get("ben"), 0),
    stage,
    earnings: parseNonNegative(p.get("earn"), 0),
    months: Math.min(12, Math.round(parseNonNegative(p.get("mo"), 12))),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("ben", String(f.benefit));
  p.set("st", f.stage);
  p.set("earn", String(f.earnings));
  if (f.stage === "this-year") p.set("mo", String(f.months));
  return p;
}

export function mountSsEarningsTest(ctx: TileContext): void {
  const { root, data } = ctx;
  root.replaceChildren();
  const rules = data?.ssEarningsTest();
  if (!rules) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "The earnings-test amounts are unavailable, so no figure is given. Social Security can tell you what it will withhold.",
      }),
    );
    return;
  }
  let fields = readFields(ctx.params);

  const num = (name: string, value: number, label: string, step: number) =>
    el("input", {
      type: "number",
      name,
      min: 0,
      step,
      value,
      attrs: { "aria-label": label, inputmode: "decimal" },
    });
  const benefitInput = num("ben", fields.benefit, "Your monthly Social Security benefit", 50);
  const stageSelect = el(
    "select",
    { name: "st", attrs: { "aria-label": "When you reach full retirement age" } },
    option("before", `After ${rules.year}`, fields.stage === "before"),
    option("this-year", `During ${rules.year}`, fields.stage === "this-year"),
  );
  stageSelect.value = fields.stage;
  const earningsInput = num("earn", fields.earnings, "Your earnings from work that count", 1000);
  const monthsInput = num("mo", fields.months, "Months before your full-retirement-age month", 1);
  const monthsRow = field(
    `Months of ${rules.year} before the month you reach full retirement age`,
    monthsInput,
  );

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const fraYear = fields.stage === "this-year";
    monthsRow.hidden = !fraYear;
    const months = fraYear ? fields.months : 12;
    const r = earningsTest(
      { monthlyBenefit: fields.benefit, stage: fields.stage, earnings: fields.earnings, months },
      rules!,
    );
    const fmt = (m: Money): string => m.format(ctx.locale);
    const cite = rules!.citation;
    const per = fraYear
      ? rules!.earningsPerDollarWithheldInFraYear
      : rules!.earningsPerDollarWithheld;
    const lines: BreakdownLine[] = [
      {
        label: `Earnings Social Security does not count against you in ${rules!.year}`,
        value: fmt(Money.from(r.exempt)),
        citation: cite,
      },
      {
        label: `Withheld: $1 for every $${per} you earn above that`,
        value: fmt(r.withheld),
        citation: cite,
      },
      {
        label: "Held back as whole monthly payments",
        value: `${r.monthsWithheld} of ${months} ${months === 1 ? "month" : "months"}`,
        emphasis: true,
      },
      { label: `Benefits still paid in ${rules!.year}`, value: fmt(r.paid) },
    ];
    resultContainer.replaceChildren(
      resultCard({
        label: `Held back in ${rules!.year}`,
        value: r.withheld,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
      el("p", {
        class: "set-credit",
        text:
          r.monthsWithheld > 0
            ? `The ${r.monthsWithheld} ${r.monthsWithheld === 1 ? "month" : "months"} held back are not lost. At full retirement age Social Security recalculates your benefit as if you had claimed that much later, so the monthly amount goes up for the rest of your life. From the month you reach full retirement age, earnings no longer reduce your benefit at all.`
            : "Nothing is held back at these earnings. From the month you reach full retirement age, earnings no longer reduce your benefit at all.",
      }),
    );
  }

  function recompute(): void {
    fields = {
      benefit: parseNonNegative(benefitInput.value, 0),
      stage: stageSelect.value === "this-year" ? "this-year" : "before",
      earnings: parseNonNegative(earningsInput.value, 0),
      months: Math.min(12, Math.round(parseNonNegative(monthsInput.value, 12))),
    };
    ctx.setParams(writeFields(fields));
    compute();
  }

  for (const i of [benefitInput, earningsInput, monthsInput])
    i.addEventListener("input", recompute);
  stageSelect.addEventListener("change", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    benefitInput.value = String(fields.benefit);
    stageSelect.value = fields.stage;
    earningsInput.value = String(fields.earnings);
    monthsInput.value = String(fields.months);
    recompute();
  });

  root.append(
    el(
      "form",
      { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
      field("Your monthly Social Security benefit", benefitInput),
      field("When you reach full retirement age", stageSelect),
      field("Your earnings from work that count", earningsInput),
      monthsRow,
      el("div", { class: "tile-form-actions" }, tryExample),
    ),
    resultContainer,
  );
  compute();
}
