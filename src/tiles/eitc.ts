/**
 * Earned Income Tax Credit estimator (BUILD-SPEC.md §4.2). Computes the credit
 * from the published phase-in rate, plateau, and phase-out by number of
 * qualifying children — cited to the IRS revenue procedure. A refundable credit:
 * it can pay out even with no tax owed.
 */
import { Money } from "../engine/money";
import { estimateEitc } from "../engine/benefits";
import { el } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import { marriedCheckbox, marriedDefault } from "./owedShared";
import type { SituationStore } from "../profile/situation";
import type { TileContext, TileDefinition } from "./types";

interface Fields {
  earnedIncome: number;
  qualifyingChildren: number;
  married: boolean;
}

const EXAMPLE: Fields = { earnedIncome: 30000, qualifyingChildren: 1, married: false };

function readFields(p: URLSearchParams, profile: SituationStore): Fields {
  return {
    earnedIncome: p.has("inc")
      ? parseNonNegative(p.get("inc"), 0)
      : (profile.get("annualIncome") ?? 0),
    qualifyingChildren: Math.max(0, parseNonNegative(p.get("kids"), 0)),
    married: p.has("mfj") ? p.get("mfj") === "1" : marriedDefault(profile),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("inc", String(f.earnedIncome));
  p.set("kids", String(f.qualifyingChildren));
  if (f.married) p.set("mfj", "1");
  return p;
}

export function mountEitc(ctx: TileContext): void {
  const { root, data, profile } = ctx;
  root.replaceChildren();
  const maybeData = data?.eitcCtc() ?? null;
  if (!maybeData) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "EITC data is unavailable — verify before relying on any figure.",
      }),
    );
    return;
  }
  // Capture the narrowed (non-null) dataset so the nested closures keep the type.
  const eitcCtc = maybeData;
  let fields = readFields(ctx.params, profile);

  const incInput = el("input", {
    type: "number",
    name: "inc",
    min: 0,
    step: 1000,
    value: fields.earnedIncome,
    attrs: { "aria-label": "Earned income", inputmode: "decimal" },
  });
  const kidsInput = el("input", {
    type: "number",
    name: "kids",
    min: 0,
    step: 1,
    value: fields.qualifyingChildren,
    attrs: { "aria-label": "Qualifying children", inputmode: "numeric" },
  });
  const mfj = marriedCheckbox(fields.married);

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const r = estimateEitc(
      {
        earnedIncome: fields.earnedIncome,
        qualifyingChildren: fields.qualifyingChildren,
        married: fields.married,
      },
      eitcCtc,
    );
    const fmt = (m: Money): string => m.format(ctx.locale);
    const lines: BreakdownLine[] = [
      {
        label: "Qualifying children",
        value: `${r.qualifyingChildren}${fields.qualifyingChildren > 3 ? " (capped at 3+)" : ""}`,
      },
      { label: "Estimated EITC", value: fmt(r.credit), emphasis: true, citation: eitcCtc.citation },
      {
        label: "Note",
        value: r.phasedOut
          ? "Income is past the phase-out — no credit at this level."
          : "A refundable credit. Eligibility also depends on investment income and (for no children) age 25–64.",
      },
    ];

    resultContainer.replaceChildren(
      resultCard({
        label: "Estimated Earned Income Tax Credit",
        value: r.credit,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function recompute(): void {
    fields = {
      earnedIncome: parseNonNegative(incInput.value, 0),
      qualifyingChildren: Math.max(0, parseNonNegative(kidsInput.value, 0)),
      married: mfj.checked,
    };
    ctx.setParams(writeFields(fields));
    profile.set("annualIncome", fields.earnedIncome);
    compute();
  }

  mfj.addEventListener("change", recompute);
  for (const i of [incInput, kidsInput]) i.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    incInput.value = String(fields.earnedIncome);
    kidsInput.value = String(fields.qualifyingChildren);
    mfj.checked = fields.married;
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Earned income", incInput),
    field("Qualifying children", kidsInput),
    el("label", { class: "checkbox" }, mfj, el("span", { text: "Married filing jointly" })),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const eitcTile: TileDefinition = {
  id: "eitc",
  title: "Earned Income Tax Credit",
  pillar: "owed",
  description: "EITC from the published phase-in and phase-out.",
  keywords: ["eitc", "earned income", "credit", "refundable"],
  status: "ready",
  mount: mountEitc,
};
