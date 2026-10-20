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
  medicaidEligibility,
  acaCreditEligible,
  fplKeyedRows,
} from "../engine/benefits";
import { medicareSavingsScreen } from "../engine/medicareSavings";
import { el, option } from "../ui/dom";
import { field, fplPercentText, parseNonNegative, tryExampleButton } from "../ui/form";
import {
  checkboxFilingStatus,
  filesSeparately,
  marriedCheckbox,
  marriedDefault,
} from "./owedShared";
import type { CitationData } from "../data/schemas";
import { fplRegionFor } from "../data/usStates";
import type { FplRegion } from "../data/browser";
import type { SituationStore } from "../profile/situation";
import { EITC_JOINT_RETURN_CITATION } from "../data/statutes";
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
  /** Opt-in: someone 65 or older, or on Medicare (SPEC-5 Phase 30). */
  medicare: boolean;
  /** A child under five, or a pregnancy: WIC and Head Start (SPEC-5 F4). */
  youngChild: boolean;
}

const EXAMPLE: Fields = {
  householdSize: 4,
  region: "contiguous",
  income: 38000,
  children: 2,
  married: true,
  medicare: false,
  youngChild: false,
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
    // Every other surface that draws a poverty line derives the region from the
    // reader's state — the ACA tile, Medicaid, the cliff explorer, charity care
    // and the saved Report all do. This one defaulted to the lower 48, so an
    // Alaskan household was measured against a line about 25% below its own,
    // and the SNAP row's `region === "contiguous"` gate handed them a
    // contiguous allotment figure where the honest answer, which the spec says
    // is the shipped one, is that Alaska and Hawaii are not estimated here.
    region: r && isRegion(r) ? r : fplRegionFor(profile.get("stateCode") ?? ""),
    income: p.has("inc") ? parseNonNegative(p.get("inc"), 0) : (profile.get("annualIncome") ?? 0),
    children: p.has("kids")
      ? Math.max(0, parseNonNegative(p.get("kids"), 0))
      : (profile.get("qualifyingChildren") ?? 0),
    married: p.has("mfj") ? p.get("mfj") === "1" : marriedDefault(profile),
    medicare: p.get("med") === "1",
    youngChild: p.get("young") === "1",
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("hh", String(f.householdSize));
  if (f.region !== "contiguous") p.set("region", f.region);
  p.set("inc", String(f.income));
  p.set("kids", String(f.children));
  // Written whether or not the box is ticked. A link is the sender's answer,
  // and "not a joint return" is an answer: dropping it lets the READER's My
  // Situation answer instead, so the same link opens joint for a married
  // reader and single for everyone else.
  p.set("mfj", f.married ? "1" : "0");
  // Nothing in My Situation answers this one, so its absence is "off" for
  // every reader and only "on" needs writing.
  if (f.medicare) p.set("med", "1");
  if (f.youngChild) p.set("young", "1");
  return p;
}

interface Finding {
  program: string;
  estimate: string;
  note: string;
  /** Where the figure comes from. */
  citation: CitationData | null;
  /**
   * A second rule the note names, with its own link.
   *
   * The EITC row is the case: the estimate comes from the published schedule and
   * the sentence beside it comes from §32(d). One `citation` field meant one of
   * them lost — either an uncited rule, or a figure with no source — in a
   * project whose first principle is that every rule cites its own.
   */
  caveat?: { label: string; citation: CitationData };
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
              attrs: {
                rel: "noopener noreferrer",
                target: "_blank",
                title: f.citation.sourceDocument,
              },
            },
            "source",
          )
        : null,
      f.caveat ? el("span", { text: " " }) : null,
      f.caveat
        ? el(
            "a",
            {
              class: "cite-link",
              href: f.caveat.citation.sourceUrl,
              attrs: {
                rel: "noopener noreferrer",
                target: "_blank",
                title: f.caveat.citation.sourceDocument,
              },
            },
            f.caveat.label,
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
  let keyedRequested = false;

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
      // The schedule has a joint column and an everyone-else column, and married
      // filing separately belongs to neither: §32(d)(1) applies the credit only
      // to a joint return. Named rather than subtracted — §32(d)(2)(B) reaches a
      // separated spouse who lived with a qualifying child, on facts this
      // screener does not hold.
      const separately = filesSeparately(fields.married, profile);
      findings.push({
        program: "Earned Income Tax Credit",
        estimate: fmt(eitc.credit),
        // The screener has no investment-income field, so §32(i) is named
        // rather than applied: over the limit there is no credit at all, and a
        // figure with no mention of the cliff reads as a promise. The EITC tile
        // asks for the number and answers it.
        note:
          (separately
            ? "A refundable credit based on your earned income and children — but it generally " +
              "requires a joint return, and My Situation says married filing separately. It " +
              "reaches you only if you lived apart from your spouse and with a qualifying child. "
            : "A refundable credit based on your earned income and children. ") +
          `Investment income over ${fmt(Money.from(eitcCtc.disqualifyingInvestmentIncome))} ends it entirely — not asked here; the EITC tool asks.`,
        citation: eitcCtc.citation,
        caveat: separately ? { label: "§32(d)", citation: EITC_JOINT_RETURN_CITATION } : undefined,
      });
    }

    const ctc = estimateCtc(
      {
        qualifyingChildren: fields.children,
        magi: fields.income,
        married: fields.married,
        earnedIncome: fields.income,
      },
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
        {
          householdSize: fields.householdSize,
          monthlyGrossIncome: fields.income / 12,
          // The screener asks for earned income (it is the same figure it hands
          // the EITC, which §32 measures on earnings), so the 20% deduction
          // applies to all of it. A household living on benefits gets a smaller
          // deduction than this and should use the SNAP tool, which asks.
          monthlyEarnedIncome: fields.income / 12,
        },
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
    } else if (snap && fields.region !== "contiguous") {
      // Data-honest: Alaska/Hawaii run on different allotment tables we haven't
      // bundled yet, so we say so rather than silently dropping SNAP (SPEC-3 §B3).
      const place = fields.region === "alaska" ? "Alaska" : "Hawaii";
      findings.push({
        program: "SNAP (food assistance)",
        estimate: "Not estimated here",
        note: `${place} uses different SNAP allotments than the lower 48, and we haven't bundled them yet. Check your eligibility with USA.gov's benefit finder.`,
        citation: null,
      });
    }

    // Saver's Credit — needs a contribution amount, which the screener doesn't
    // collect, so surface it only when My Situation already knows one.
    const savers = bundled.saversCredit();
    const contributions = profile.get("retirementContributionsAnnual");
    if (savers && contributions && contributions > 0) {
      const sc = estimateSaversCredit(
        {
          agi: fields.income,
          filingStatus: checkboxFilingStatus(fields.married, profile),
          contributions,
        },
        savers,
      );
      if (sc.credit.greaterThan(0)) {
        findings.push({
          program: "Saver's Credit",
          estimate: fmt(sc.credit),
          // My Situation holds one contribution figure, and §25B counts each
          // spouse's column separately, so a joint return whose spouse also
          // contributed can be owed more than this. Understating is the safe
          // direction for a screener; saying so is what makes it honest.
          note:
            "A credit on your retirement contributions, from the amount in My Situation." +
            (fields.married
              ? " Your spouse's own contributions count too, in a column of their own — the Saver's Credit tool asks for both."
              : ""),
          citation: savers.citation,
        });
      }
    }

    // Medicaid and the premium tax credit were drawn here with literals — `<= 138`
    // and `>= 100 && <= 400` — which is the shape the Readout Report was fixed
    // out of, one surface later than this one. The 138 is a shard field with a
    // per-state override the literal could not see: DC expanded to 215% until
    // 2026, so a DC resident at 170% of the poverty line was eligible, was told
    // so by the Medicaid tile and by the saved Report, and heard nothing here.
    const medicaidData = bundled.medicaid();
    const stateCode = profile.get("stateCode");
    const medicaidThreshold = medicaidData?.expansionThresholdPctFpl ?? 138;
    if (medicaidData && stateCode) {
      const m = medicaidEligibility(
        { stateCode, income: fields.income, householdSize: fields.householdSize },
        medicaidData,
        fpl,
      );
      if (m.eligible) {
        findings.push({
          program: "Medicaid (likely)",
          estimate: "Eligibility",
          note: `Your income is ${fplPercentText(pctOfLine, [m.thresholdPctFpl ?? medicaidThreshold])} of the poverty line, and ${stateCode.toUpperCase()} covers adults up to ${m.thresholdPctFpl}%.`,
          citation: medicaidData.citation,
        });
      } else if (!m.expansionState && pctOfLine <= medicaidThreshold) {
        // Not a maybe. In a state that did not expand, income alone does not
        // qualify most adults, and saying "likely eligible" to this household
        // would be the coverage gap described as good news.
        findings.push({
          program: "Medicaid",
          estimate: "Depends on more than income",
          note: `${stateCode.toUpperCase()} has not expanded Medicaid, so most adults do not qualify on income alone. Parents, pregnant people, children (CHIP), and people with disabilities may still qualify under separate rules.`,
          citation: medicaidData.citation,
        });
      }
    } else if (pctOfLine <= medicaidThreshold) {
      // No state on file, so the generic answer — with the threshold read from
      // the shard rather than typed here.
      findings.push({
        program: "Medicaid (likely, in expansion states)",
        estimate: "Eligibility",
        note: `Your income is ${fplPercentText(pctOfLine, [medicaidThreshold])} of the poverty line; at or below ${medicaidThreshold}% suggests Medicaid eligibility where the state expanded it. Set your state in My Situation for the figure your state actually uses.`,
        citation: medicaidData?.citation ?? fpl.citation,
      });
    }
    // The premium-tax-credit band is the engine's whole §36B(c)(1)(A) rule now,
    // rather than two literals that happened to agree with it: at least 100% of
    // the poverty line and not more than 400%, the cliff having returned for
    // 2026 when the ARPA/IRA enhancement expired.
    const acaData = bundled.aca();
    if (acaData && acaCreditEligible(pctOfLine, acaData)) {
      findings.push({
        program: "ACA marketplace subsidies (likely)",
        estimate: "Premium tax credit",
        note: `At ${fplPercentText(pctOfLine, [100, 400])} of the poverty line (within the 100–400% range) you likely qualify for a marketplace premium tax credit. Use the ACA Premium Tax Credit tool for a dollar estimate.`,
        citation: acaData.citation,
      });
    }

    // The programs keyed to the poverty line (SPEC-5 F4), each citing the rule
    // that sets its percentage. The region's own guidelines are already in
    // `pctOfLine`, so Alaska and Hawaii get their own lines.
    const keyed = bundled.fplKeyedPrograms();
    // The app starts this load (FPL_KEYED_PROGRAMS in data/browser.ts, which
    // this module cannot import a value from: the build reads it outside Vite).
    // A screener opened first waits for it, once.
    if (
      !keyed &&
      !keyedRequested &&
      bundled.loadedDeferred("fpl-keyed-programs-2026") === undefined
    ) {
      keyedRequested = true;
      void bundled.loadDeferred("fpl-keyed-programs-2026").then(() => render());
    }
    if (keyed) {
      for (const row of fplKeyedRows(
        pctOfLine,
        { children: fields.children, youngChild: fields.youngChild },
        keyed,
      )) {
        findings.push({
          program: row.name,
          estimate:
            row.linePct === null
              ? "Set by your state"
              : row.reducedPrice
                ? "Reduced price likely"
                : "Likely worth applying",
          note:
            row.linePct === null
              ? `${row.worth}. ${row.categorical} Your state's agency has the line.`
              : `${row.worth}. Your income is at or under its line of ${row.linePct}% of the poverty line. ${row.categorical}`,
          citation: row.rule,
        });
      }
    }

    // The 65-plus rows, only with the toggle on. Their shard loads on demand,
    // so the first render after the toggle shows that it is loading and the
    // load renders again. They compare income only: the screener asks nothing
    // about savings, so each row names the savings limit instead of testing it.
    if (fields.medicare) {
      const loaded = bundled.loadedDeferred("medicare-savings-2026");
      const msp = bundled.medicareSavings();
      if (loaded === undefined) {
        void bundled.loadDeferred("medicare-savings-2026").then(() => render());
        findings.push({
          program: "Medicare Savings Programs and Extra Help",
          estimate: "Loading",
          note: "Loading the Medicare limits.",
          citation: null,
        });
      } else if (msp) {
        const screen = medicareSavingsScreen(
          { couple: fields.married, monthlyIncome: fields.income / 12, resources: 0 },
          msp,
        );
        const best = screen.programs.find((p) => p.underIncomeLine);
        const who = fields.married ? "couple" : "individual";
        if (best) {
          findings.push({
            program: "Medicare Savings Program",
            estimate: "Likely worth applying",
            note: `Your income is under the federal line for the ${best.name} program, ${fmt(Money.from(best.monthlyIncomeLine))} a month, which pays ${best.pays}. It also counts savings, up to ${fmt(Money.from(msp.savingsResourceLimit[who]))} federally, and many states go higher. Your state Medicaid agency decides.`,
            citation: msp.citation,
          });
        }
        if (screen.extraHelp.underIncomeLine) {
          findings.push({
            program: "Extra Help with Part D drug costs",
            estimate: "Likely worth applying",
            note: `Your income is under Extra Help's federal line, ${fmt(Money.from(screen.extraHelp.annualIncomeLine))} a year. It also counts savings, up to ${fmt(Money.from(screen.extraHelp.resourceLimitWithBurial))} with the burial allowance. A Medicare Savings Program brings it without a separate application. Social Security decides.`,
            citation: msp.citation,
          });
        }
      }
    }

    results.append(
      el("p", {
        class: "screener-summary",
        text: `Your household income is ${fplPercentText(pctOfLine, [100, 138, 400])} of the federal poverty line.`,
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
  const medicareBox = el("input", { type: "checkbox", name: "med" });
  medicareBox.checked = fields.medicare;
  const youngBox = el("input", { type: "checkbox", name: "young" });
  youngBox.checked = fields.youngChild;

  function recompute(): void {
    fields = {
      householdSize: Math.max(1, parseNonNegative(hhInput.value, 1)),
      region: isRegion(regionSelect.value) ? regionSelect.value : "contiguous",
      income: parseNonNegative(incInput.value, 0),
      children: Math.max(0, parseNonNegative(kidsInput.value, 0)),
      married: mfj.checked,
      medicare: medicareBox.checked,
      youngChild: youngBox.checked,
    };
    ctx.setParams(writeFields(fields));
    profile.set("householdSize", fields.householdSize);
    profile.set("qualifyingChildren", fields.children);
    profile.set("annualIncome", fields.income);
    render();
  }

  regionSelect.addEventListener("change", recompute);
  mfj.addEventListener("change", recompute);
  medicareBox.addEventListener("change", recompute);
  youngBox.addEventListener("change", recompute);
  for (const i of [hhInput, incInput, kidsInput]) i.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    hhInput.value = String(fields.householdSize);
    regionSelect.value = fields.region;
    incInput.value = String(fields.income);
    kidsInput.value = String(fields.children);
    mfj.checked = fields.married;
    medicareBox.checked = fields.medicare;
    youngBox.checked = fields.youngChild;
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
    el(
      "label",
      { class: "checkbox" },
      medicareBox,
      el("span", { text: "Anyone 65 or older, or on Medicare" }),
    ),
    el(
      "label",
      { class: "checkbox" },
      youngBox,
      el("span", { text: "A child under five, or a pregnancy" }),
    ),
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
  how: "You enter your household once, size, income, region, children, and filing status, and we compute your percentage of the poverty line, estimate the refundable credits you likely qualify for (the Earned Income Tax Credit and the Child Tax Credit), and flag where your income suggests Medicaid or ACA-subsidy eligibility. It also lists the federal programs whose income line is a percentage of the poverty line: school meals, Lifeline and home energy help, and, if you tick that there is a child under five or a pregnancy, WIC and Head Start. If anyone is 65 or older or on Medicare, tick that box to add the Medicare Savings Programs and Extra Help, measured against their federal income lines. Each line shows its public source.\n\nWe ask for nothing identifying and send nothing anywhere. These are estimates to point you toward programs worth applying for, the agencies make the final determination.",
  resources: [
    { label: "USA.gov, find benefits", url: "https://www.usa.gov/benefit-finder" },
    { label: "HealthCare.gov, lower costs", url: "https://www.healthcare.gov/lower-costs/" },
    {
      label: "IRS, credits & deductions",
      url: "https://www.irs.gov/credits-and-deductions-for-individuals",
    },
  ],
  mount: mountOwedScreener,
};
