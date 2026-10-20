/**
 * Medicare Premiums & IRMAA, the interactive half (SPEC-5 Phase 29). Loaded on
 * first use with its shard; the definition in `medicareIrmaa.ts` stays in the
 * shell.
 */
import { Money } from "../engine/money";
import { irmaaFor } from "../engine/medicare";
import { enrollmentWindows } from "../engine/sequences";
import type { FilingStatus } from "../data/schemas";
import { el, option } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import { renderDeadline, todayIso } from "../ui/deadline";
import type { TileContext } from "./types";

const FILING_STATUSES: { value: FilingStatus; label: string }[] = [
  { value: "single", label: "Single" },
  { value: "married_jointly", label: "Married filing jointly" },
  { value: "married_separately", label: "Married filing separately" },
  { value: "head_of_household", label: "Head of household" },
  { value: "qualifying_surviving_spouse", label: "Qualifying surviving spouse" },
];

const SSA_44 = "https://www.ssa.gov/forms/ssa-44.pdf";

interface Fields {
  fs: FilingStatus;
  magi: number;
  both: boolean;
}

const EXAMPLE: Fields = { fs: "married_jointly", magi: 230000, both: true };

function isFilingStatus(v: string): v is FilingStatus {
  return FILING_STATUSES.some((f) => f.value === v);
}

function readFields(p: URLSearchParams, ctx: TileContext): Fields {
  const fs = p.get("fs");
  return {
    fs: fs && isFilingStatus(fs) ? fs : (ctx.profile.get("filingStatus") ?? "single"),
    magi: parseNonNegative(p.get("magi"), 0),
    both: p.get("both") === "1",
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("fs", f.fs);
  p.set("magi", String(f.magi));
  if (f.both) p.set("both", "1");
  return p;
}

export function mountMedicareIrmaa(ctx: TileContext): void {
  const { root, data } = ctx;
  root.replaceChildren();
  const costs = data?.medicareCosts();
  const windows = data?.enrollmentWindows();
  if (!costs) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "Medicare's cost figures are unavailable, so no premium is given. Medicare.gov lists this year's.",
      }),
    );
    return;
  }
  const incomeYear = costs.year - costs.irmaa.lookbackYears;
  let fields = readFields(ctx.params, ctx);

  const fsSelect = el(
    "select",
    { name: "fs", attrs: { "aria-label": "Filing status on that return" } },
    ...FILING_STATUSES.map((s) => option(s.value, s.label, s.value === fields.fs)),
  );
  fsSelect.value = fields.fs;
  const magiInput = el("input", {
    type: "number",
    name: "magi",
    min: 0,
    step: 1000,
    value: fields.magi,
    attrs: {
      "aria-label": `Modified adjusted gross income on your ${incomeYear} return`,
      inputmode: "decimal",
    },
  });
  const bothBox = el("input", {
    type: "checkbox",
    name: "both",
    attrs: { "aria-label": "Both of you are on Medicare" },
  });
  bothBox.checked = fields.both;

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const r = irmaaFor(fields.magi, fields.fs, costs!);
    const fmt = (m: Money): string => m.format(ctx.locale);
    const cite = costs!.citation;
    const couple = fields.both && fields.fs === "married_jointly";
    const lines: BreakdownLine[] = [
      {
        label:
          r.tierIndex === 0
            ? "Your tier: the standard premium, no surcharge"
            : `Your tier: ${r.tierIndex} of ${r.tierCount - 1} above the standard premium`,
        value: `${incomeYear} income ${fmt(Money.from(fields.magi))}`,
        citation: cite,
      },
      { label: "Part B premium", value: `${fmt(r.partBMonthly)}/mo`, citation: cite },
      {
        label: "Part D surcharge, on top of your plan's own premium",
        value: `${fmt(r.partDMonthly)}/mo`,
        citation: cite,
      },
      { label: "A year, for one person", value: fmt(r.yearlyOne), emphasis: true },
    ];
    if (couple)
      lines.push({ label: "A year, for the two of you", value: fmt(r.yearlyOne.multiply(2)) });
    if (r.tierIndex > 0)
      lines.push({
        label: "Of that, the income-related surcharge, per person",
        value: `${fmt(r.surchargeYearlyOne)} a year`,
      });
    lines.push(
      r.next
        ? {
            label: `The next tier starts ${r.next.atOrAbove ? "at" : "above"} ${fmt(r.next.line)}; one dollar past it moves the whole year`,
            value: `${fmt(r.next.room)} of room`,
            citation: cite,
          }
        : { label: "This is the top tier", value: "no higher line" },
      {
        label: "Part B deductible, before Medicare pays its share",
        value: `${fmt(Money.from(costs!.partB.annualDeductible))} a year`,
        citation: cite,
      },
    );

    const after: HTMLElement[] = [
      el("p", {
        class: "irmaa-lag",
        text: `Your ${costs!.year} premium is set by your ${incomeYear} return, so the income you report this year sets the premium two years from now. If your income has fallen since ${incomeYear} because you retired, stopped working, divorced or lost a spouse, you can ask Social Security to use a more recent year on Form SSA-44.`,
      }),
      el(
        "p",
        { class: "irmaa-channel" },
        el("a", {
          href: SSA_44,
          text: "Form SSA-44: Medicare income-related adjustment, life-changing event",
          attrs: { target: "_blank", rel: "noopener noreferrer" },
        }),
      ),
    ];
    const recon = windows
      ? enrollmentWindows(windows).find((w) => w.id === "medicare-irmaa-reconsideration")
      : undefined;
    if (recon) after.push(renderDeadline(recon.deadline, { asOf: todayIso(), locale: ctx.locale }));

    resultContainer.replaceChildren(
      resultCard({
        label: couple ? "Medicare a month, for each of you" : "Medicare a month",
        value: r.monthlyOne,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
      ...after,
    );
  }

  function recompute(): void {
    fields = {
      fs: isFilingStatus(fsSelect.value) ? fsSelect.value : fields.fs,
      magi: parseNonNegative(magiInput.value, 0),
      both: bothBox.checked,
    };
    ctx.setParams(writeFields(fields));
    compute();
  }

  fsSelect.addEventListener("change", recompute);
  bothBox.addEventListener("change", recompute);
  magiInput.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    fsSelect.value = fields.fs;
    magiInput.value = String(fields.magi);
    bothBox.checked = fields.both;
    recompute();
  });

  root.append(
    el(
      "form",
      { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
      field(`Filing status on your ${incomeYear} return`, fsSelect),
      field(`Modified adjusted gross income on your ${incomeYear} return`, magiInput),
      field("Both of you are on Medicare", bothBox),
      el("div", { class: "tile-form-actions" }, tryExample),
    ),
    resultContainer,
  );
  compute();
}
