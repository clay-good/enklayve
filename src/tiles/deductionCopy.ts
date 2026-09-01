/**
 * The One Big Beautiful Bill Act's individual deductions, as they apply to a
 * calculator that asks for wages and giving and nothing else.
 *
 * Shared by the two tiles that compute federal income tax, because it is the
 * same paragraph and a duplicated one drifts. Both tiles state the modelled
 * §170(p) and the three that are not, so a reader over 65, or living on tips,
 * is told the figure on the screen is too high for them.
 */
export const OBBBA_DEDUCTIONS_HOW =
  "If you take the standard deduction we also apply IRC \u00a7170(p), which since 2026 lets you deduct up to $1,000 of cash giving \u2014 $2,000 on a joint return \u2014 without itemizing. It counts only cash to a public charity, not gifts of property or to a donor-advised fund, so if your giving was not all of that kind the real figure is smaller.\n\nThree other 2026 deductions are not modeled here, so if one applies to you your real tax is lower than this: the $6,000-per-person deduction at 65 (\u00a7151(d)(5)(C)), up to $25,000 of tips (\u00a7224), and up to $12,500 of overtime \u2014 $25,000 filing jointly \u2014 (\u00a7225). Each needs a figure this calculator does not ask you for.";
