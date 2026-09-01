/**
 * The One Big Beautiful Bill Act's individual deductions, as they apply to two
 * calculators that ask for different things.
 *
 * Shared rather than duplicated because most of the paragraph is the same and a
 * duplicated sentence drifts — that is how the Child Tax Credit explainer came
 * to say $2,000 while the tile computed $2,200. But not IDENTICAL, and the
 * difference matters: the federal income tax tile asks for charitable giving as
 * one of the itemized "big four", so §170(p) can apply there. Take-home does
 * not ask for giving at all, so on that tile §170(p) is one of the deductions
 * that is not modeled, and saying otherwise would be a claim about a
 * calculation that never runs.
 */

/** §151(d)(5)(C), which both tiles now model, since both ask who is 65. */
const SENIOR =
  "If you or your spouse are 65 or over we apply IRC §151(d)(5)(C): $6,000 each, phasing out by 6% of income over $75,000, or $150,000 on a joint return. A married filer gets it only on a joint return.";

/** §170(p), which needs a giving figure and so only reaches one of the two. */
const CHARITY =
  "If you take the standard deduction we also apply §170(p), which since 2026 lets you deduct up to $1,000 of cash giving — $2,000 on a joint return — without itemizing. It counts only cash to a public charity, not gifts of property or to a donor-advised fund, so if your giving was not all of that kind the real figure is smaller.";

const NOT_MODELED =
  "so if one applies to you your real tax is lower than this: up to $25,000 of tips (§224), and up to $12,500 of overtime — $25,000 filing jointly — (§225). Each needs a figure this calculator does not ask you for.";

/** The federal income tax tile: giving is one of its inputs. */
export const OBBBA_DEDUCTIONS_HOW = `${SENIOR}\n\n${CHARITY}\n\nTwo other 2026 deductions are not modeled here, ${NOT_MODELED}`;

/** Take-home: no giving input, so §170(p) joins the list of what is missing. */
export const OBBBA_DEDUCTIONS_HOW_NO_GIVING = `${SENIOR}\n\nThree other 2026 deductions are not modeled here, ${NOT_MODELED.replace(
  "up to $25,000 of tips",
  "$1,000 of cash giving without itemizing — $2,000 jointly — (§170(p)), up to $25,000 of tips",
)}`;
