/**
 * A screen against the federal lines for the Medicare Savings Programs and
 * Extra Help (SPEC-5 later-life L5). It compares income and resources with
 * the published 2026 limits and says which are worth applying for. It never
 * decides eligibility: states set their own rules above the federal floor,
 * and they and SSA exclude income this does not model.
 */
import type { MedicareSavingsData } from "../data/schemas";

export interface MedicareSavingsInput {
  couple: boolean;
  /** Gross monthly income. */
  monthlyIncome: number;
  resources: number;
}

export interface ProgramScreen {
  id: string;
  name: string;
  pays: string;
  monthlyIncomeLine: number;
  underIncomeLine: boolean;
}

export interface MedicareSavingsResult {
  programs: ProgramScreen[];
  savingsResourceLimit: number;
  underSavingsResourceLimit: boolean;
  extraHelp: {
    annualIncomeLine: number;
    underIncomeLine: boolean;
    resourceLimit: number;
    resourceLimitWithBurial: number;
    /** Under the plain limit, under only the burial limit, or over both. */
    resources: "under" | "under-with-burial" | "over";
  };
}

export function medicareSavingsScreen(
  input: MedicareSavingsInput,
  rules: MedicareSavingsData,
): MedicareSavingsResult {
  const who = input.couple ? "couple" : "individual";
  const income = Math.max(0, input.monthlyIncome);
  const resources = Math.max(0, input.resources);
  const eh = rules.extraHelp;
  return {
    programs: rules.programs.map((p) => ({
      id: p.id,
      name: p.name,
      pays: p.pays,
      monthlyIncomeLine: p.monthlyIncomeLine[who],
      underIncomeLine: income <= p.monthlyIncomeLine[who],
    })),
    savingsResourceLimit: rules.savingsResourceLimit[who],
    underSavingsResourceLimit: resources <= rules.savingsResourceLimit[who],
    extraHelp: {
      annualIncomeLine: eh.annualIncomeLine[who],
      underIncomeLine: income * 12 <= eh.annualIncomeLine[who],
      resourceLimit: eh.resourceLimit[who],
      resourceLimitWithBurial: eh.resourceLimitWithBurial[who],
      resources:
        resources <= eh.resourceLimit[who]
          ? "under"
          : resources <= eh.resourceLimitWithBurial[who]
            ? "under-with-burial"
            : "over",
    },
  };
}
