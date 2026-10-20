/**
 * Is the Second Income Worth It?: the "How this works" block, loaded with the
 * tool rather than with the shell (SPEC-5 §7.5). The build reads it for the
 * tool's crawlable page.
 */
import { OBBBA_DEDUCTIONS_NOT_MODELED } from "./deductionCopy";

export const how =
  "We work out what your household has now, and what it would have with the second paycheck. Each is pay after federal income tax, Social Security and Medicare, and state income tax, plus the Earned Income and Child Tax Credits, the ACA premium tax credit, and SNAP, the same calculation the Benefit Cliff Explorer runs.\n\nFrom the difference we take away the childcare the job needs and your own costs of working, such as commuting or a second car. We add back the better of the child and dependent care credit or a dependent care FSA on that childcare. The credit counts only where it cancels tax the Child Tax Credit has not already cancelled. The FSA lowers the pay the tax and credit rules see, but we do not let it lower the income SNAP counts. What is left is what the job adds in a year. The share of the paycheck that does not reach you can pass 100%, and when it does we show it rather than round it down.\n\nLosing Medicaid is shown as a change in coverage, never as a dollar amount. The biggest program this leaves out is a childcare subsidy: states set their own income limits for it, and losing one can cost more than anything shown here, so your real cliff may be larger.\n\n" +
  OBBBA_DEDUCTIONS_NOT_MODELED;
