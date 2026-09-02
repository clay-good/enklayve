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
  "If you take the standard deduction we also apply §170(p), which since 2026 lets you deduct up to $1,000 of cash giving — $2,000 on a joint return — without itemizing. It counts only cash to a public charity, not gifts of property or to a donor-advised fund, so if your giving was not all of that kind the real figure is smaller. If you itemize instead, the same Act works the other way: §170(b)(1)(I) allows your giving only above 0.5% of your income, so the first $500 of giving at $100,000 deducts nothing. The floor applies to itemizers only — §170(p) is computed without regard to it — which is why the same $1,000 can be worth more to someone who does not itemize.";

/** §163(h)(4), which needs a car loan interest figure and so reaches one tile. */
const CAR_LOAN =
  "Tell us the interest you paid on a car loan and we apply §163(h)(4): up to $10,000 a year, falling by $200 for every $1,000 of income — or part of one — over $100,000, or $200,000 on a joint return, so it is gone by $150,000 and $250,000. Unlike the tips and overtime deductions this one is open to a married filer filing separately. Because a part of a thousand counts as a whole one, crossing a thousand-dollar line costs the whole $200 — so if you are just above $100,000 the marginal rate here can look startling for the next hundred dollars, and it is real. It reaches only a loan taken out after 2024, secured by a first lien on a new vehicle assembled in the United States that you drive yourself, and the VIN goes on your return.";

/** §224 and §225, which need a breakdown of wages and so reach only take-home. */
const TIPS_OVERTIME =
  "Tell us how much of your pay was tips or an overtime premium and we apply §224 and §225: up to $25,000 of tips and $12,500 of overtime — $25,000 on a joint return — each falling by $100 for every whole $1,000 of income over $150,000, or $300,000 jointly, and neither available to a married filer except on a joint return. These reduce income tax only: Social Security and Medicare are still owed on every one of those dollars. What counts is narrower than it sounds — cash tips in an occupation the Treasury lists, and the premium half of overtime the Fair Labor Standards Act requires — so treat the figure as a ceiling.";

/**
 * For the four tiles that run the same federal engine and ask for none of it.
 *
 * The W-4 check, the paycheck optimizer, quarterly taxes and the marginal
 * explorer all compute federal income tax from wages and a filing status, which
 * means each one is high for a tipped worker, an hourly worker paid overtime,
 * anyone 65, anyone giving without itemizing, and anyone paying a car loan. The
 * fix is not five more fields on four more tiles — those tools are about
 * withholding, deferral, set-aside and rates, not about composing a return — it
 * is saying so, and naming the two tools that do ask.
 *
 * Deliberately carries no dollar figures. Every amount in these deductions is a
 * shard field that phases out on its own schedule, and a figure repeated in six
 * files is five more places for it to go stale; the two tiles that actually
 * compute them quote the numbers, and those quotes are bound to the shard by
 * `proseFigures.test.ts`.
 */
export const OBBBA_DEDUCTIONS_NOT_MODELED =
  "Five deductions new for 2026 are not modeled here: tips (§224), overtime (§225), car loan interest (§163(h)(4)), the deduction at 65 (§151(d)(5)(C)), and giving without itemizing (§170(p)). If any of them applies to you, your real federal tax is lower than the figure above. Take-Home and Federal Income Tax ask for them and apply them.";

/** The federal income tax tile: giving is an input, wage composition is not. */
export const OBBBA_DEDUCTIONS_HOW = `${SENIOR}\n\n${CHARITY}\n\n${CAR_LOAN}\n\nTwo other 2026 deductions are not modeled here, so if one applies to you your real tax is lower than this: up to $25,000 of tips (§224), and up to $12,500 of overtime — $25,000 filing jointly — (§225). Take-Home asks for those and applies them.`;

/**
 * Only take-home asks which state you live in, so only take-home can say what
 * happens there. Four states start their income tax at federal TAXABLE income,
 * which means these federal deductions are state deductions too without the
 * state legislating one — and Colorado is the reason this is a sentence rather
 * than a footnote, since it adds the overtime back and leaves the tips alone.
 */
const CONFORMITY =
  "In Idaho, Iowa, Montana, and North Dakota these federal deductions lower your state tax as well, because those states start from your federal taxable income — the deduction is already inside the number they begin with. Two more start there and add back exactly one deduction each: Colorado the overtime deduction, Oregon the car loan interest. Everywhere else your state begins from adjusted gross income, so these change your federal tax only.";

/** Take-home: wage composition is an input, charitable giving is not. */
export const OBBBA_DEDUCTIONS_HOW_NO_GIVING = `${SENIOR}\n\n${TIPS_OVERTIME}\n\nTwo other 2026 deductions are not modeled here, so if one applies to you your real tax is lower than this: $1,000 of cash giving without itemizing, $2,000 jointly (§170(p)), and up to $10,000 of car loan interest (§163(h)(4)). The Federal Income Tax tool asks for both and applies them.\n\n${CONFORMITY}`;
