/**
 * The enklayve engine: money math and citation primitives that every tile and
 * dataset depends on. See BUILD-SPEC.md §6, §2, §9.
 */
export { Money } from "./money";
export type { MoneyInput } from "./money";
export { cite, isCited, assertCited, citationProblems } from "./citation";
export type { Citation, Cited } from "./citation";
export {
  compoundGrowth,
  debtPayoff,
  monthlyMortgagePayment,
  loanPrincipalFromPayment,
} from "./finance";
export type { CompoundGrowthInput, CompoundGrowthResult, PayoffResult } from "./finance";
export { evaluatePlan, PLAN_STEPS, DEFAULT_CONFIG, DEFAULT_ORDER } from "./plan";
export type {
  PlanStepId,
  DebtStrategy,
  SinkingGoal,
  PlanInput,
  PlanConfig,
  StepLine,
  StepResult,
  PlanResult,
} from "./plan";
export * from "./tax";
