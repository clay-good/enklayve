/**
 * Hourly ↔ Salary tile (BUILD-SPEC.md §3.1): convert between an hourly wage and
 * an annual salary, with overtime at 1.5× and the option to stack a second job.
 * Pure arithmetic on the user's own pay — there is no external rule to cite, so
 * the tile shows the math rather than linking a source (like Compound Growth).
 */
import { Money } from "../engine/money";
import { annualFromHourly, hourlyFromAnnual } from "../engine/finance";
import { el, option } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import { rememberShared } from "./profileSync";
import type { TileContext, TileDefinition } from "./types";

type Mode = "hourly" | "salary";
const MODES: { value: Mode; label: string }[] = [
  { value: "hourly", label: "From an hourly rate" },
  { value: "salary", label: "From an annual salary" },
];

interface Fields {
  mode: Mode;
  hourlyRate: number;
  hoursPerWeek: number;
  overtimeHours: number;
  weeksPerYear: number;
  salary: number;
  /** Annual income from a second job, stacked on top (§3.1 multi-job). */
  secondJob: number;
}

const EXAMPLE: Fields = {
  mode: "hourly",
  hourlyRate: 28,
  hoursPerWeek: 40,
  overtimeHours: 5,
  weeksPerYear: 52,
  salary: 0,
  secondJob: 0,
};

function isMode(v: string): v is Mode {
  return MODES.some((m) => m.value === v);
}

function readFields(p: URLSearchParams): Fields {
  const mode = p.get("m");
  return {
    mode: mode && isMode(mode) ? mode : "hourly",
    hourlyRate: parseNonNegative(p.get("hr"), 28),
    hoursPerWeek: parseNonNegative(p.get("h"), 40),
    overtimeHours: parseNonNegative(p.get("ot"), 0),
    weeksPerYear: Math.max(1, parseNonNegative(p.get("wk"), 52)),
    salary: parseNonNegative(p.get("sal"), 0),
    secondJob: parseNonNegative(p.get("j2"), 0),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("m", f.mode);
  if (f.mode === "hourly") {
    p.set("hr", String(f.hourlyRate));
    p.set("h", String(f.hoursPerWeek));
    if (f.overtimeHours > 0) p.set("ot", String(f.overtimeHours));
  } else {
    p.set("sal", String(f.salary));
    p.set("h", String(f.hoursPerWeek));
  }
  if (f.weeksPerYear !== 52) p.set("wk", String(f.weeksPerYear));
  if (f.secondJob > 0) p.set("j2", String(f.secondJob));
  return p;
}

export function mountHourlySalary(ctx: TileContext): void {
  const { root } = ctx;
  root.replaceChildren();
  let fields = readFields(ctx.params);

  const modeSelect = el(
    "select",
    { name: "m", attrs: { "aria-label": "Convert direction" } },
    ...MODES.map((m) => option(m.value, m.label, m.value === fields.mode)),
  );
  const num = (name: string, value: number, label: string, step: number): HTMLInputElement =>
    el("input", {
      type: "number",
      name,
      min: 0,
      step,
      value,
      attrs: { "aria-label": label, inputmode: "decimal" },
    });
  const hrInput = num("hr", fields.hourlyRate, "Hourly rate", 0.5);
  const salInput = num("sal", fields.salary, "Annual salary", 1000);
  const hInput = num("h", fields.hoursPerWeek, "Regular hours per week", 1);
  const otInput = num("ot", fields.overtimeHours, "Overtime hours per week", 1);
  const wkInput = num("wk", fields.weeksPerYear, "Weeks worked per year", 1);
  const j2Input = num("j2", fields.secondJob, "Second job annual income", 1000);

  const hourlyGroup = field("Hourly rate", hrInput);
  const salaryGroup = field("Annual salary", salInput);
  const overtimeGroup = field("Overtime hours / week", otInput);

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function syncMode(): void {
    const hourly = fields.mode === "hourly";
    hourlyGroup.hidden = !hourly;
    overtimeGroup.hidden = !hourly;
    salaryGroup.hidden = hourly;
  }

  function compute(): void {
    const fmt = (m: Money): string => m.format(ctx.locale);
    let primaryAnnual: Money;
    const lines: BreakdownLine[] = [];

    if (fields.mode === "hourly") {
      primaryAnnual = annualFromHourly({
        hourlyRate: fields.hourlyRate,
        hoursPerWeek: fields.hoursPerWeek,
        overtimeHoursPerWeek: fields.overtimeHours,
        weeksPerYear: fields.weeksPerYear,
      });
      lines.push({
        label: `Regular pay (${fields.hoursPerWeek} hrs × ${fields.weeksPerYear} wks)`,
        value: fmt(
          annualFromHourly({
            hourlyRate: fields.hourlyRate,
            hoursPerWeek: fields.hoursPerWeek,
            overtimeHoursPerWeek: 0,
            weeksPerYear: fields.weeksPerYear,
          }),
        ),
      });
      if (fields.overtimeHours > 0) {
        const ot = Money.from(fields.hourlyRate)
          .multiply(1.5)
          .multiply(fields.overtimeHours)
          .multiply(fields.weeksPerYear);
        lines.push({ label: "Overtime pay (1.5×)", value: fmt(ot) });
      }
    } else {
      primaryAnnual = Money.from(fields.salary);
      const equiv = hourlyFromAnnual(fields.salary, fields.hoursPerWeek, fields.weeksPerYear);
      lines.push({
        label: `Equivalent hourly (${fields.hoursPerWeek} hrs × ${fields.weeksPerYear} wks)`,
        value: fmt(equiv),
      });
    }

    lines.push({ label: "This job, annual", value: fmt(primaryAnnual) });
    if (fields.secondJob > 0) {
      lines.push({ label: "Second job, annual", value: fmt(Money.from(fields.secondJob)) });
    }
    const combined = primaryAnnual.add(fields.secondJob);
    lines.push({ label: "Combined annual", value: fmt(combined), emphasis: true });
    lines.push({ label: "Per month", value: fmt(combined.divide(12)) });
    lines.push({ label: "Per week", value: fmt(combined.divide(52)) });

    resultContainer.replaceChildren(
      resultCard({
        label: "Annual income",
        value: combined,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function collect(): void {
    fields = {
      mode: isMode(modeSelect.value) ? modeSelect.value : "hourly",
      hourlyRate: parseNonNegative(hrInput.value, 0),
      hoursPerWeek: parseNonNegative(hInput.value, 40),
      overtimeHours: parseNonNegative(otInput.value, 0),
      weeksPerYear: Math.max(1, parseNonNegative(wkInput.value, 52)),
      salary: parseNonNegative(salInput.value, 0),
      secondJob: parseNonNegative(j2Input.value, 0),
    };
  }

  function recompute(): void {
    collect();
    syncMode();
    ctx.setParams(writeFields(fields));
    const combined = (
      fields.mode === "hourly"
        ? annualFromHourly({
            hourlyRate: fields.hourlyRate,
            hoursPerWeek: fields.hoursPerWeek,
            overtimeHoursPerWeek: fields.overtimeHours,
            weeksPerYear: fields.weeksPerYear,
          })
        : Money.from(fields.salary)
    ).add(fields.secondJob);
    rememberShared(ctx.profile, { annualIncome: combined.roundToCents().toNumber() });
    compute();
  }

  modeSelect.addEventListener("change", recompute);
  for (const i of [hrInput, salInput, hInput, otInput, wkInput, j2Input]) {
    i.addEventListener("input", recompute);
  }

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    modeSelect.value = fields.mode;
    hrInput.value = String(fields.hourlyRate);
    salInput.value = String(fields.salary);
    hInput.value = String(fields.hoursPerWeek);
    otInput.value = String(fields.overtimeHours);
    wkInput.value = String(fields.weeksPerYear);
    j2Input.value = String(fields.secondJob);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Convert", modeSelect),
    hourlyGroup,
    salaryGroup,
    field("Regular hours / week", hInput),
    overtimeGroup,
    field("Weeks per year", wkInput),
    field("Second job, annual (optional)", j2Input),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  syncMode();
  compute();
}

export const hourlySalaryTile: TileDefinition = {
  id: "hourly-salary",
  title: "Hourly ↔ Salary",
  pillar: "take-home",
  description: "Convert pay rates with overtime and multiple jobs.",
  keywords: ["hourly", "salary", "overtime", "wage", "annual", "convert"],
  status: "ready",
  how: "Going from hourly to annual: we pay your regular hours at your rate and any overtime hours at 1.5× (the standard FLSA premium), times the weeks you work in a year. Going from salary to hourly: we divide your annual pay by the hours you actually work in a year (hours per week × weeks).\n\nWorking more than one job? Add the second job's annual income and we stack it on top for your combined picture, with the monthly and weekly equivalents. These are your own numbers, so there is no rule to cite, just the arithmetic shown in full.",
  resources: [
    {
      label: "U.S. Dept. of Labor, overtime pay",
      url: "https://www.dol.gov/agencies/whd/overtime",
    },
    { label: "CFPB, getting paid", url: "https://www.consumerfinance.gov/consumer-tools/" },
  ],
  mount: mountHourlySalary,
};
