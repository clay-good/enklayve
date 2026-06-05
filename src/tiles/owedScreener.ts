/**
 * The combined "What Am I Owed" screener (BUILD-SPEC.md §4.5). The user enters
 * household size, income, region, children, and filing status once, and the
 * screener returns a calm, plain-English list of programs the household likely
 * qualifies for, each with an estimated dollar figure and a citation. It asks
 * for no identifying information and sends nothing anywhere — everything is
 * computed on the device. It composes the same engine the individual tiles use.
 */
import { Money } from "../engine/money";
import {
  fplPercent,
  estimateEitc,
  estimateCtc,
  estimateSnap,
  estimateSaversCredit,
} from "../engine/benefits";
import { el, option } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
import { marriedCheckbox, marriedDefault } from "./owedShared";
import type { CitationData } from "../data/schemas";
import type { FplRegion } from "../data/browser";
import type { SituationStore } from "../profile/situation";
import type { TileContext, TileDefinition } from "./types";

const REGIONS: { value: FplRegion; label: string }[] = [
  { value: "contiguous", label: "48 contiguous states & DC" },
  { value: "alaska", label: "Alaska" },
  { value: "hawaii", label: "Hawaii" },
];

interface Fields {
  householdSize: number;
  region: FplRegion;
  income: number;
  children: number;
  married: boolean;
}

const EXAMPLE: Fields = {
  householdSize: 4,
  region: "contiguous",
  income: 38000,
  children: 2,
  married: true,
};

function isRegion(v: string): v is FplRegion {
  return REGIONS.some((r) => r.value === v);
}

function readFields(p: URLSearchParams, profile: SituationStore): Fields {
  const r = p.get("region");
  return {
    householdSize: p.has("hh")
      ? Math.max(1, parseNonNegative(p.get("hh"), 1))
      : (profile.get("householdSize") ?? 1),
    region: r && isRegion(r) ? r : "contiguous",
    income: p.has("inc") ? parseNonNegative(p.get("inc"), 0) : (profile.get("annualIncome") ?? 0),
    children: Math.max(0, parseNonNegative(p.get("kids"), 0)),
    married: p.has("mfj") ? p.get("mfj") === "1" : marriedDefault(profile),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("hh", String(f.householdSize));
  if (f.region !== "contiguous") p.set("region", f.region);
  p.set("inc", String(f.income));
  p.set("kids", String(f.children));
  if (f.married) p.set("mfj", "1");
  return p;
}

interface Finding {
  program: string;
  estimate: string;
  note: string;
  citation: CitationData | null;
}

function programItem(f: Finding): HTMLElement {
  return el(
    "li",
    { class: "screener-item" },
    el(
      "div",
      { class: "screener-item-head" },
      el("span", { class: "screener-program", text: f.program }),
      el("span", { class: "screener-estimate", text: f.estimate }),
    ),
    el(
      "p",
      { class: "screener-note" },
      el("span", { text: f.note + " " }),
      f.citation
        ? el(
            "a",
            {
              class: "cite-link",
              href: f.citation.sourceUrl,
              attrs: { rel: "noopener noreferrer", target: "_blank" },
            },
            "source",
          )
        : null,
    ),
  );
}

export function mountOwedScreener(ctx: TileContext): void {
  const { root, data, profile } = ctx;
  root.replaceChildren();
  if (!data) {
    root.append(el("p", { class: "tile-error", text: "Benefit data could not be loaded." }));
    return;
  }
  const bundled = data;
  let fields = readFields(ctx.params, profile);

  const intro = el("p", {
    class: "screener-intro",
    text: "Enter your situation once. We'll list the programs you likely qualify for, with an estimate and a citation for each, computed on your device, asking for nothing identifying.",
  });

  const results = el("div", { class: "screener-results", attrs: { "aria-live": "polite" } });

  function render(): void {
    results.replaceChildren();
    const fpl = bundled.fpl(fields.region);
    const eitcCtc = bundled.eitcCtc();
    if (!fpl || !eitcCtc) {
      results.append(
        el("div", {
          class: "verify-banner",
          attrs: { role: "alert" },
          text: "Benefit data is unavailable, verify before relying on any figure.",
        }),
      );
      return;
    }

    const pctOfLine = fplPercent(fields.income, fields.householdSize, fpl);
    const fmt = (m: Money): string => m.format(ctx.locale);
    const findings: Finding[] = [];

    const eitc = estimateEitc(
      { earnedIncome: fields.income, qualifyingChildren: fields.children, married: fields.married },
      eitcCtc,
    );
    if (eitc.credit.greaterThan(0)) {
      findings.push({
        program: "Earned Income Tax Credit",
        estimate: fmt(eitc.credit),
        note: "A refundable credit based on your earned income and children.",
        citation: eitcCtc.citation,
      });
    }

    const ctc = estimateCtc(
      { qualifyingChildren: fields.children, magi: fields.income, married: fields.married },
      eitcCtc,
    );
    if (ctc.credit.greaterThan(0)) {
      findings.push({
        program: "Child Tax Credit",
        estimate: fmt(ctc.credit),
        note: `Up to ${fmt(ctc.refundable)} of it is refundable (the Additional Child Tax Credit).`,
        citation: eitcCtc.citation,
      });
    }

    // SNAP — only the contiguous figures are seeded, so estimate it for that
    // region (Alaska and Hawaii use different allotments).
    const snap = bundled.snap();
    if (snap && fields.region === "contiguous") {
      const snapResult = estimateSnap(
        { householdSize: fields.householdSize, monthlyGrossIncome: fields.income / 12 },
        snap,
        fpl,
      );
      if (snapResult.eligible) {
        findings.push({
          program: "SNAP (food assistance)",
          estimate: `${fmt(snapResult.monthlyBenefit)}/mo`,
          note: "Estimated monthly benefit after the gross and net income tests. States vary; the agency decides.",
          citation: snap.citation,
        });
      }
    }

    // Saver's Credit — needs a contribution amount, which the screener doesn't
    // collect, so surface it only when My Situation already knows one.
    const savers = bundled.saversCredit();
    const contributions = profile.get("retirementContributionsAnnual");
    if (savers && contributions && contributions > 0) {
      const sc = estimateSaversCredit(
        {
          agi: fields.income,
          filingStatus: fields.married ? "married_jointly" : "single",
          contributions,
        },
        savers,
      );
      if (sc.credit.greaterThan(0)) {
        findings.push({
          program: "Saver's Credit",
          estimate: fmt(sc.credit),
          note: "A credit on your retirement contributions, from the amount in My Situation.",
          citation: savers.citation,
        });
      }
    }

    if (pctOfLine <= 138) {
      findings.push({
        program: "Medicaid (likely, in expansion states)",
        estimate: "Eligibility",
        note: `Your income is ${pctOfLine.toFixed(0)}% of the poverty line; at or below 138% suggests Medicaid eligibility where the state expanded it.`,
        citation: fpl.citation,
      });
    }
    // Premium tax credits run from 100% to 400% of the poverty line. The
    // ARPA/IRA enhancement that lifted the 400% cliff expired at the end of
    // 2025, so for the 2026 plan year the cliff is back: above 400% FPL there is
    // no credit (matches the engine's `aboveSubsidyCap` and the ACA tile).
    if (pctOfLine >= 100 && pctOfLine <= 400) {
      findings.push({
        program: "ACA marketplace subsidies (likely)",
        estimate: "Premium tax credit",
        note: `At ${pctOfLine.toFixed(0)}% of the poverty line (within the 100–400% range) you likely qualify for a marketplace premium tax credit. Use the ACA Premium Tax Credit tool for a dollar estimate.`,
        citation: fpl.citation,
      });
    }

    results.append(
      el("p", {
        class: "screener-summary",
        text: `Your household income is ${pctOfLine.toFixed(0)}% of the federal poverty line.`,
      }),
    );
    if (findings.length === 0) {
      results.append(
        el("p", {
          class: "screener-note",
          text: "No programs flagged at this income and household, try the individual tools to explore thresholds.",
        }),
      );
    } else {
      results.append(el("ul", { class: "screener-list" }, ...findings.map(programItem)));
    }
  }

  function numberInput(
    name: string,
    label: string,
    value: number,
    step: number,
    mode: string,
  ): HTMLInputElement {
    return el("input", {
      type: "number",
      name,
      min: 0,
      step,
      value,
      attrs: { "aria-label": label, inputmode: mode },
    });
  }

  const hhInput = numberInput("hh", "Household size", fields.householdSize, 1, "numeric");
  const incInput = numberInput("inc", "Annual household income", fields.income, 1000, "decimal");
  const kidsInput = numberInput("kids", "Qualifying children", fields.children, 1, "numeric");
  const regionSelect = el(
    "select",
    { name: "region", attrs: { "aria-label": "Region" } },
    ...REGIONS.map((r) => option(r.value, r.label, r.value === fields.region)),
  );
  const mfj = marriedCheckbox(fields.married);

  function recompute(): void {
    fields = {
      householdSize: Math.max(1, parseNonNegative(hhInput.value, 1)),
      region: isRegion(regionSelect.value) ? regionSelect.value : "contiguous",
      income: parseNonNegative(incInput.value, 0),
      children: Math.max(0, parseNonNegative(kidsInput.value, 0)),
      married: mfj.checked,
    };
    ctx.setParams(writeFields(fields));
    profile.set("householdSize", fields.householdSize);
    profile.set("annualIncome", fields.income);
    render();
  }

  regionSelect.addEventListener("change", recompute);
  mfj.addEventListener("change", recompute);
  for (const i of [hhInput, incInput, kidsInput]) i.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    hhInput.value = String(fields.householdSize);
    regionSelect.value = fields.region;
    incInput.value = String(fields.income);
    kidsInput.value = String(fields.children);
    mfj.checked = fields.married;
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Household size", hhInput),
    field("Region", regionSelect),
    field("Annual household income", incInput),
    field("Qualifying children", kidsInput),
    el("label", { class: "checkbox" }, mfj, el("span", { text: "Married filing jointly" })),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(intro, form, results);
  render();
}

export const owedScreenerTile: TileDefinition = {
  id: "screener",
  title: "What Am I Owed Screener",
  pillar: "owed",
  description: "Enter your situation once; see every program you likely qualify for.",
  keywords: ["screener", "benefits", "eligibility", "what am i owed"],
  status: "ready",
  how: "You enter your household once, size, income, region, children, and filing status, and we compute your percentage of the poverty line, estimate the refundable credits you likely qualify for (the Earned Income Tax Credit and the Child Tax Credit), and flag where your income suggests Medicaid or ACA-subsidy eligibility. Each line shows its public source.\n\nWe ask for nothing identifying and send nothing anywhere. These are estimates to point you toward programs worth applying for, the agencies make the final determination.",
  resources: [
    { label: "Benefits.gov, find benefits", url: "https://www.benefits.gov/" },
    { label: "HealthCare.gov, lower costs", url: "https://www.healthcare.gov/lower-costs/" },
    {
      label: "IRS, credits & deductions",
      url: "https://www.irs.gov/credits-deductions-for-individuals",
    },
  ],
  mount: mountOwedScreener,
};
