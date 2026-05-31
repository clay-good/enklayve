/**
 * Pell Grant estimator (BUILD-SPEC.md §4.4). The Pell award is a function of the
 * Student Aid Index: the maximum Pell less the SAI, floored at the minimum for
 * an otherwise-eligible student, and zero once the SAI reaches the maximum Pell.
 *
 * The user supplies their SAI (from the FAFSA Student Aid Index estimator, or
 * straight off their FAFSA Submission Summary) — the same "supply the one figure
 * you can look up" pattern as ACA's benchmark premium and Social Security's PIA.
 */
import { Money } from "../engine/money";
import { estimatePell } from "../engine/fafsa";
import { el } from "../ui/dom";
import { field, parseNumber, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import type { TileContext, TileDefinition } from "./types";

const EXAMPLE_SAI = 2000;

export function mountPell(ctx: TileContext): void {
  const { root, data } = ctx;
  root.replaceChildren();
  const maybeData = data?.fafsa() ?? null;
  if (!maybeData) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "FAFSA data is unavailable, verify before relying on any figure.",
      }),
    );
    return;
  }
  const fafsa = maybeData;
  let sai = ctx.params.has("sai") ? parseNumber(ctx.params.get("sai"), 0) : EXAMPLE_SAI;

  const saiInput = el("input", {
    type: "number",
    name: "sai",
    step: 100,
    value: sai,
    attrs: { "aria-label": "Student Aid Index (SAI)", inputmode: "numeric" },
  });

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function params(): URLSearchParams {
    const p = new URLSearchParams();
    p.set("sai", String(sai));
    return p;
  }

  function compute(): void {
    const r = estimatePell(sai, fafsa);
    const lines: BreakdownLine[] = [
      { label: "Your Student Aid Index", value: Money.from(sai).format(ctx.locale) },
      {
        label: "Maximum Pell Grant",
        value: Money.from(fafsa.maxPellGrant).format(ctx.locale),
        citation: fafsa.citation,
      },
      {
        label: "Estimated Pell Grant",
        value: r.eligible
          ? `${r.award.format(ctx.locale)} / year`
          : "Not Pell-eligible at this SAI",
        emphasis: true,
        citation: fafsa.citation,
      },
      {
        label: "Note",
        value:
          "The maximum award assumes full-time, full-year enrollment; it is prorated for part-time. Your school confirms the final amount. Some families also qualify for the maximum or minimum Pell directly from income.",
      },
    ];

    resultContainer.replaceChildren(
      resultCard({
        label: "Estimated Pell Grant (per year)",
        value: r.award,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(params()),
      }),
    );
  }

  function recompute(): void {
    sai = parseNumber(saiInput.value, 0);
    ctx.setParams(params());
    compute();
  }

  saiInput.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    sai = EXAMPLE_SAI;
    saiInput.value = String(sai);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Student Aid Index (from the SAI estimator or your FAFSA Submission Summary)", saiInput),
    el(
      "div",
      { class: "tile-form-actions" },
      el("button", {
        type: "button",
        class: "btn-secondary",
        text: "Estimate my SAI",
        on: { click: () => ctx.navigate("fafsa-sai") },
      }),
      tryExample,
    ),
  );

  root.append(form, resultContainer);
  compute();
}

export const pellTile: TileDefinition = {
  id: "pell",
  title: "Pell Grant",
  pillar: "owed",
  description: "Estimate your Pell Grant award from your Student Aid Index.",
  keywords: ["pell", "grant", "college", "aid", "financial aid", "sai"],
  status: "ready",
  how: "The Pell Grant is the foundation of federal student aid, and it never has to be paid back. The award is set by your Student Aid Index (SAI): you get the maximum Pell minus your SAI, so a lower SAI means a larger grant. An otherwise-eligible student is floored at the minimum Pell, and once your SAI reaches the maximum Pell there is no award.\n\nEnter your SAI from the Student Aid Index estimator or straight off your FAFSA Submission Summary. The maximum award assumes full-time enrollment for the full year and is prorated for part-time; your school sets the final figure. We use the published 2024-25 maximum and minimum Pell. Verify with Federal Student Aid before relying on it.",
  resources: [
    {
      label: "Federal Student Aid, Pell Grants",
      url: "https://studentaid.gov/understand-aid/types/grants/pell",
    },
    {
      label: "Federal Student Aid, how aid is calculated",
      url: "https://studentaid.gov/complete-aid-process/how-calculated",
    },
  ],
  mount: mountPell,
};
