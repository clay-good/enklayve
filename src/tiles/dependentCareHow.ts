/**
 * Child & Dependent Care: Credit or FSA?: the "How this works" block, loaded
 * with the tool rather than with the shell (SPEC-5 §7.5). The build reads it
 * for the tool's crawlable page.
 */
import { OBBBA_DEDUCTIONS_NOT_MODELED } from "./deductionCopy";

export const how =
  "There are two federal ways to get back part of what you pay for care while you work: the child and dependent care credit, and a dependent care FSA through an employer. Both were changed for 2026.\n\nThe credit is a percentage of up to $3,000 of care for one child under 13, or $6,000 for two or more. The percentage starts at 50% for the lowest incomes and steps down to 35%, then steps down again to 20% at higher incomes, with a wider step on a joint return. The credit can only cancel federal income tax you owe. It is never paid out as a refund. A married couple has to file jointly to claim it.\n\nAn FSA takes up to $7,500 a year out of your pay before tax, so you save income tax and also Social Security and Medicare tax on it. Whatever goes through the FSA comes off the credit's limit, so the two mostly do not stack. We run your return both ways and show what each route saves. At most incomes the FSA wins. At low incomes the credit can.\n\nAn FSA is use-it-or-lose-it, and you choose the amount at your employer's open enrollment, usually before the year starts. Both routes count care only up to the lower earner's pay. A spouse who is a full-time student or cannot care for themselves counts as earning a set amount a month. The child, or a dependent or spouse who cannot care for themselves, must meet the IRS tests, and the care must be so you can work. Several states have their own dependent care credit, which this does not compute.\n\n" +
  OBBBA_DEDUCTIONS_NOT_MODELED;
