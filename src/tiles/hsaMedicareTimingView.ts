/**
 * HSA and Medicare Timing, the interactive half (SPEC-5 Phase 29). Loaded on
 * first use with its shard; the definition in `hsaMedicareTiming.ts` stays in
 * the shell.
 */
import { Money } from "../engine/money";
import { hsaMedicareTiming } from "../engine/medicare";
import { el, option } from "../ui/dom";
import { field, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import type { TileContext } from "./types";

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

interface Fields {
  born: string;
  apply: string;
  coverage: "self" | "family";
}

/** "YYYY-MM" for a year and a month, as the month input holds it. */
function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

const EXAMPLE: Fields = { born: "1961-03-15", apply: monthKey(2026, 12), coverage: "family" };

function readFields(p: URLSearchParams): Fields {
  const born = p.get("born") ?? "";
  const apply = p.get("apply") ?? "";
  return {
    born: DATE.test(born) ? born : "",
    apply: MONTH.test(apply) ? apply : "",
    coverage: p.get("cov") === "self" ? "self" : "family",
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  if (f.born) p.set("born", f.born);
  if (f.apply) p.set("apply", f.apply);
  p.set("cov", f.coverage);
  return p;
}

export function mountHsaMedicareTiming(ctx: TileContext): void {
  const { root, data } = ctx;
  root.replaceChildren();
  const costs = data?.medicareCosts();
  const limits = data?.retirementLimits();
  if (!costs || !limits) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "The Medicare or HSA rules are unavailable, so no date is given.",
      }),
    );
    return;
  }
  let fields = readFields(ctx.params);

  const bornInput = el("input", {
    type: "date",
    name: "born",
    value: fields.born,
    attrs: { "aria-label": "Your date of birth" },
  });
  const applyInput = el("input", {
    type: "month",
    name: "apply",
    value: fields.apply,
    attrs: { "aria-label": "Month you will apply for Part A or claim Social Security" },
  });
  const coverageSelect = el(
    "select",
    { name: "cov", attrs: { "aria-label": "Your HSA-eligible health plan" } },
    option("self", "Self-only coverage", fields.coverage === "self"),
    option("family", "Family coverage", fields.coverage === "family"),
  );
  coverageSelect.value = fields.coverage;

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    if (!fields.born || !fields.apply) {
      resultContainer.replaceChildren(
        el("p", {
          class: "hsa-empty",
          text: "Enter your date of birth and the month you plan to apply for Part A or claim Social Security.",
        }),
      );
      return;
    }
    const l = limits!.limits;
    const r = hsaMedicareTiming(
      {
        birthDate: fields.born,
        applyMonth: fields.apply,
        coverage: fields.coverage,
        limits: {
          selfOnly: l.hsa_self_only,
          family: l.hsa_family,
          catchUp55: l.hsa_catch_up_55plus,
        },
      },
      costs!,
    );
    const label = (m: { year: number; month: number }): string =>
      new Intl.DateTimeFormat(ctx.locale, {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(Date.UTC(m.year, m.month - 1, 1)));
    const cite = costs!.citation;
    const lines: BreakdownLine[] = [
      {
        label: "Your first month of Medicare eligibility",
        value: label(r.eligibleFrom),
        citation: cite,
      },
      {
        label:
          r.backdatedMonths > 0
            ? `Premium-free Part A starts ${r.backdatedMonths} ${r.backdatedMonths === 1 ? "month" : "months"} before you apply`
            : "Premium-free Part A starts",
        value: label(r.partAFrom),
        citation: cite,
      },
      {
        label: "The last month you can contribute to an HSA for",
        value: r.lastContributionMonth
          ? label(r.lastContributionMonth)
          : `none in ${r.partAFrom.year}`,
        emphasis: true,
      },
      {
        label: `Your HSA limit for ${r.partAFrom.year}: ${r.eligibleMonths} of 12 months, with the catch-up at 55${r.partAFrom.year === limits!.taxYear ? "" : ` (at ${limits!.taxYear}'s limits)`}`,
        value: Money.from(r.limit).format(ctx.locale),
        citation: limits!.citation,
      },
    ];
    resultContainer.replaceChildren(
      resultCard({
        label: `HSA contributions you can still make for ${r.partAFrom.year}`,
        value: r.limit,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
      el("p", {
        class: "hsa-excess",
        text:
          r.backdatedMonths > 0
            ? `Anything put in for ${label(r.partAFrom)} or later is an excess contribution, even though you had not applied yet. Take it out, with what it earned, before your tax return is due, or it is taxed again every year it stays.`
            : "Anything put in for the month Part A starts or later is an excess contribution. Take it out, with what it earned, before your tax return is due, or it is taxed again every year it stays.",
      }),
    );
  }

  function recompute(): void {
    fields = {
      born: DATE.test(bornInput.value) ? bornInput.value : "",
      apply: MONTH.test(applyInput.value) ? applyInput.value : "",
      coverage: coverageSelect.value === "self" ? "self" : "family",
    };
    ctx.setParams(writeFields(fields));
    compute();
  }

  for (const c of [bornInput, applyInput]) c.addEventListener("input", recompute);
  coverageSelect.addEventListener("change", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    bornInput.value = fields.born;
    applyInput.value = fields.apply;
    coverageSelect.value = fields.coverage;
    recompute();
  });

  root.append(
    el(
      "form",
      { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
      field("Your date of birth", bornInput),
      field("Month you will apply for Part A or claim Social Security", applyInput),
      field("Your HSA-eligible health plan", coverageSelect),
      el("div", { class: "tile-form-actions" }, tryExample),
    ),
    resultContainer,
  );
  compute();
}
