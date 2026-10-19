/**
 * COBRA or the Marketplace?, the interactive half (SPEC-5 Phase 28). Loaded on
 * first use with its shard; the definition in `cobraVsMarketplace.ts` stays in
 * the shell. The credit line cites the ACA shard, because it came from
 * `estimatePremiumTaxCredit`; the clocks come from the enrollment-windows shard.
 */
import { Money } from "../engine/money";
import { cobraVsMarketplace } from "../engine/cobra";
import { enrollmentWindows } from "../engine/sequences";
import { US_STATES, fplRegionFor } from "../data/usStates";
import { el, option } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
import { citationLink, resultCard, type BreakdownLine } from "../ui/resultCard";
import { renderDeadline, todayIso } from "../ui/deadline";
import type { TileContext } from "./types";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

interface Fields {
  cobra: number;
  full: number;
  disability: boolean;
  size: number;
  income: number;
  benchmark: number;
  st: string;
  ended: string;
  over65: boolean;
}

const EXAMPLE: Fields = {
  cobra: 900,
  full: 0,
  disability: false,
  size: 1,
  income: 32000,
  benchmark: 700,
  st: "OH",
  ended: "",
  over65: false,
};

function readFields(p: URLSearchParams, ctx: TileContext): Fields {
  const st = (p.get("st") ?? ctx.profile.get("stateCode") ?? "").toUpperCase();
  const ended = p.get("end") ?? "";
  return {
    cobra: parseNonNegative(p.get("cob"), 0),
    full: parseNonNegative(p.get("full"), 0),
    disability: p.get("dx") === "1",
    size: Math.min(
      20,
      Math.max(
        1,
        Math.round(parseNonNegative(p.get("size"), ctx.profile.get("householdSize") ?? 1)),
      ),
    ),
    income: p.has("inc")
      ? parseNonNegative(p.get("inc"), 0)
      : (ctx.profile.get("annualIncome") ?? 0),
    benchmark: parseNonNegative(p.get("bm"), 0),
    st: US_STATES.some((s) => s.code === st) ? st : "OH",
    ended: DATE.test(ended) ? ended : "",
    over65: p.get("65") === "1",
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("cob", String(f.cobra));
  if (f.full > 0) p.set("full", String(f.full));
  if (f.disability) p.set("dx", "1");
  p.set("size", String(f.size));
  p.set("inc", String(f.income));
  p.set("bm", String(f.benchmark));
  p.set("st", f.st);
  if (f.ended) p.set("end", f.ended);
  if (f.over65) p.set("65", "1");
  return p;
}

export function mountCobraVsMarketplace(ctx: TileContext): void {
  const { root, data } = ctx;
  root.replaceChildren();
  const rules = data?.separationRules();
  const aca = data?.aca();
  const windows = data?.enrollmentWindows();
  if (!rules || !aca || !windows) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "The COBRA or Marketplace rules are unavailable, so no comparison is given. HealthCare.gov can show your Marketplace price with the credit applied.",
      }),
    );
    return;
  }
  const clocks = new Map(enrollmentWindows(windows).map((w) => [w.id, w]));
  let fields = readFields(ctx.params, ctx);

  const num = (name: string, value: number, label: string, step: number) =>
    el("input", {
      type: "number",
      name,
      min: 0,
      step,
      value,
      attrs: { "aria-label": label, inputmode: "decimal" },
    });
  const box = (name: string, label: string, checked: boolean): HTMLInputElement => {
    const b = el("input", { type: "checkbox", name, attrs: { "aria-label": label } });
    b.checked = checked;
    return b;
  };
  const cobraInput = num(
    "cob",
    fields.cobra,
    "COBRA premium a month, from your election notice",
    10,
  );
  const fullInput = num(
    "full",
    fields.full,
    "The plan's full monthly cost, if the notice gives it",
    10,
  );
  const disabilityBox = box(
    "dx",
    "On the disability extension, past the 18th month",
    fields.disability,
  );
  const sizeInput = num("size", fields.size, "People in your household", 1);
  const incomeInput = num(
    "inc",
    fields.income,
    "Household income you expect for the whole year",
    1000,
  );
  const benchmarkInput = num("bm", fields.benchmark, "Benchmark silver plan premium a month", 10);
  const stSelect = el(
    "select",
    { name: "st", attrs: { "aria-label": "State you live in" } },
    ...US_STATES.map((s) => option(s.code, s.name, s.code === fields.st)),
  );
  const endedInput = el("input", {
    type: "date",
    name: "end",
    value: fields.ended,
    attrs: { "aria-label": "Day your job-based coverage ended" },
  });
  const over65Box = box("65", "You or your spouse are 65 or older", fields.over65);

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const fpl = data!.fpl(fplRegionFor(fields.st));
    if (!fpl || fields.cobra <= 0 || fields.benchmark <= 0) {
      resultContainer.replaceChildren(
        el("p", {
          class: "cvm-empty",
          text: "Enter the COBRA premium from your election notice and the benchmark silver premium for your county from HealthCare.gov to compare them.",
        }),
      );
      return;
    }
    const r = cobraVsMarketplace(
      {
        cobraMonthly: fields.cobra,
        planFullCostMonthly: fields.full,
        disabilityExtension: fields.disability,
        householdSize: fields.size,
        projectedAnnualIncome: fields.income,
        benchmarkMonthly: fields.benchmark,
      },
      rules!,
      aca!,
      fpl,
    );
    const fmt = (m: Money): string => m.format(ctx.locale);
    const saving = r.monthlySavingOnMarketplace;
    const lines: BreakdownLine[] = [
      { label: "COBRA, from your notice", value: `${fmt(r.cobraMonthly)}/mo` },
      { label: "Benchmark Marketplace plan", value: `${fmt(Money.from(fields.benchmark))}/mo` },
      {
        label: r.credit.belowMedicaidFloor
          ? "Premium tax credit: none below the poverty line, where Medicaid is the route"
          : r.credit.aboveSubsidyCap
            ? "Premium tax credit: none above the income cap"
            : "Premium tax credit at the income you expect this year",
        value: `${fmt(r.credit.monthlyCredit)}/mo`,
        citation: aca!.citation,
      },
      {
        label: "Benchmark Marketplace plan after the credit",
        value: `${fmt(r.marketplaceMonthly)}/mo`,
        emphasis: true,
      },
    ];
    if (r.ceilingMonthly)
      lines.push({
        label: `The most COBRA may charge, ${Math.round((fields.disability ? rules!.cobraDisabilityExtensionCeiling : rules!.cobraPremiumCeiling) * 100)}% of the plan's full cost`,
        value: `${fmt(r.ceilingMonthly)}/mo`,
        citation: rules!.citation,
      });

    const notes: HTMLElement[] = [];
    if (r.overCeiling)
      notes.push(
        el("p", {
          class: "cvm-over",
          attrs: { role: "alert" },
          text: "The COBRA premium on your notice is more than the law allows for this plan. Ask the plan administrator in writing how it was set.",
        }),
      );
    const door = clocks.get("aca-special-enrollment");
    notes.push(
      el(
        "p",
        { class: "cvm-door" },
        el("span", {
          text: "Choosing COBRA is hard to undo mid-year. Dropping it early on purpose does not open a Marketplace enrollment window; running it to its end does, and so does open enrollment. Electing COBRA does not pause the Medicare Part B clock either. ",
        }),
        ...(door ? [citationLink(door.deadline.citation)] : []),
      ),
      el("p", {
        class: "cvm-terms",
        text: "This compares premiums only. A Marketplace plan starts its deductible at zero mid-year, where COBRA keeps what you have already met, and the networks differ. Compare the plans' terms before you choose. The credit is settled on your return against your real income, and from 2026 you repay all of any excess.",
      }),
    );
    const ids = ["cobra-election", "cobra-first-premium", "aca-special-enrollment"];
    if (fields.over65) ids.push("medicare-part-b-sep");
    for (const id of ids) {
      const w = clocks.get(id);
      if (!w) continue;
      notes.push(
        renderDeadline(w.deadline, {
          asOf: todayIso(),
          locale: ctx.locale,
          ...(fields.ended && id !== "cobra-first-premium" ? { triggerDate: fields.ended } : {}),
        }),
      );
    }

    resultContainer.replaceChildren(
      resultCard({
        label: saving.isNegative()
          ? "COBRA costs less each month by"
          : "The Marketplace costs less each month by",
        value: saving.isNegative() ? saving.multiply(-1) : saving,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
      ...notes,
    );
  }

  function recompute(): void {
    const ended = endedInput.value;
    fields = {
      cobra: parseNonNegative(cobraInput.value, 0),
      full: parseNonNegative(fullInput.value, 0),
      disability: disabilityBox.checked,
      size: Math.min(20, Math.max(1, Math.round(parseNonNegative(sizeInput.value, 1)))),
      income: parseNonNegative(incomeInput.value, 0),
      benchmark: parseNonNegative(benchmarkInput.value, 0),
      st: stSelect.value || fields.st,
      ended: DATE.test(ended) ? ended : "",
      over65: over65Box.checked,
    };
    ctx.setParams(writeFields(fields));
    compute();
  }

  for (const i of [cobraInput, fullInput, sizeInput, incomeInput, benchmarkInput])
    i.addEventListener("input", recompute);
  for (const c of [disabilityBox, stSelect, endedInput, over65Box])
    c.addEventListener("change", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    cobraInput.value = String(fields.cobra);
    fullInput.value = "";
    disabilityBox.checked = false;
    sizeInput.value = String(fields.size);
    incomeInput.value = String(fields.income);
    benchmarkInput.value = String(fields.benchmark);
    stSelect.value = fields.st;
    endedInput.value = "";
    over65Box.checked = false;
    recompute();
  });

  root.append(
    el(
      "form",
      { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
      field("COBRA premium a month, from your election notice", cobraInput),
      field("The plan's full monthly cost, if the notice gives it (optional)", fullInput),
      field("On the disability extension, past the 18th month", disabilityBox),
      field("People in your household", sizeInput),
      field("Household income you expect for the whole year", incomeInput),
      field("Benchmark silver plan premium a month (from HealthCare.gov)", benchmarkInput),
      field("State you live in", stSelect),
      field("Day your job-based coverage ended (optional, for the clocks)", endedInput),
      field("You or your spouse are 65 or older", over65Box),
      el("div", { class: "tile-form-actions" }, tryExample),
    ),
    resultContainer,
  );
  compute();
}
