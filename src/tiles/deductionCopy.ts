/**
 * The One Big Beautiful Bill Act's individual deductions, as they apply to two
 * calculators that ask for different things.
 *
 * Shared rather than duplicated because most of the paragraph is the same and a
 * duplicated sentence drifts — that is how the Child Tax Credit explainer came
 * to say the credit was $2,000 while the tile computed the shard's larger
 * figure. But not IDENTICAL, and the difference is the point: the federal income
 * tax tile asks for charitable giving as one of the itemized "big four", so
 * §170(p) can apply there; take-home asks how your wages are made up, so §224
 * and §225 can apply there. Neither tile can claim a deduction it has no input
 * for, and saying otherwise would describe a calculation that never runs.
 */

/** §151(d)(5)(C), which both tiles model, since both ask who is 65. */
const SENIOR =
  "If you or your spouse are 65 or over we apply IRC §151(d)(5)(C): $6,000 each, phasing out by 6% of income over $75,000, or $150,000 on a joint return. A married filer gets it only on a joint return.";

/** §170(p), which needs a giving figure and so reaches only one of the two. */
const CHARITY =
  "If you take the standard deduction we also apply §170(p), which since 2026 lets you deduct up to $1,000 of cash giving — $2,000 on a joint return — without itemizing. It counts only cash to a public charity, not gifts of property or to a donor-advised fund, so if your giving was not all of that kind the real figure is smaller.";

/** §224 and §225, which need a breakdown of wages and so reach only take-home. */
const TIPS_OVERTIME =
  "Tell us how much of your pay was tips or an overtime premium and we apply §224 and §225: up to $25,000 of tips and $12,500 of overtime — $25,000 on a joint return — each falling by $100 for every whole $1,000 of income over $150,000, or $300,000 jointly, and neither available to a married filer except on a joint return. These reduce income tax only: Social Security and Medicare are still owed on every one of those dollars. What counts is narrower than it sounds — cash tips in an occupation the Treasury lists, and the premium half of overtime the Fair Labor Standards Act requires — so treat the figure as a ceiling.";

/** The federal income tax tile: giving is an input, wage composition is not. */
export const OBBBA_DEDUCTIONS_HOW = `${SENIOR}\n\n${CHARITY}\n\nTwo other 2026 deductions are not modeled here, so if one applies to you your real tax is lower than this: up to $25,000 of tips (§224), and up to $12,500 of overtime — $25,000 filing jointly — (§225). Take-Home asks for those and applies them.`;

/** Take-home: wage composition is an input, charitable giving is not. */
export const OBBBA_DEDUCTIONS_HOW_NO_GIVING = `${SENIOR}\n\n${TIPS_OVERTIME}\n\nOne other 2026 deduction is not modeled here, so if it applies to you your real tax is lower than this: $1,000 of cash giving without itemizing, $2,000 jointly (§170(p)). The Federal Income Tax tool asks for your giving and applies it.`;
