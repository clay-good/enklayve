import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { SUB_TOOLS } from "../../src/tiles/registry";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import type { SituationKey } from "../../src/profile/situation";
import type { TileContext, TileDefinition } from "../../src/tiles/types";

/**
 * Which control in which tile is allowed to overwrite which shared field.
 *
 * My Situation is invisible plumbing: a value typed in one tile pre-fills the
 * next, so nobody types their income six times (SPEC-2 §3). The plumbing is
 * only as good as the agreement about what each slot *means*, and the meaning
 * lives in one line of a doc comment — `annualIncome` is "gross annual income",
 * `householdSize` is the reader's household. Every writer is trusted to be
 * writing that quantity, and nothing checked.
 *
 * The failure this catches has already happened once, one field over. Education
 * Credits has a single "married filing jointly" checkbox and wrote
 * `married ? "married_jointly" : "single"` into the shared *five-value* filing
 * status on every keystroke, so a single parent who opened it to compare two
 * credits left as `single` everywhere — a worse standard deduction in every
 * tax tile, for a status they never changed. That is a control whose meaning is
 * narrower than the field it overwrites, and it was fixed by hand, with a test
 * pinned to that one tile.
 *
 * Two more of the same shape were sitting in the numeric fields on 2026-09-05,
 * both in tiles that ask about **somebody else**:
 *
 *   - **FAFSA SAI** wrote "Parents' total income (AGI + untaxed)" into
 *     `annualIncome` and "People in the parents' household" into
 *     `householdSize`. A dependent student who filled the form in honestly
 *     handed Take-Home their parents' $180,000 as their own annual wages, and
 *     moved their own poverty line — read by SNAP, Medicaid, the ACA screener
 *     and the cliff explorer — from a one-person household to a four-person
 *     one.
 *   - **Life Insurance** wrote "Annual income to replace" into `annualIncome`.
 *     That number is a decision rather than a fact: someone earning $120,000
 *     who decides $50,000 of it needs replacing — the rest being a spouse's
 *     salary, or a pension — overwrote the profile with $50,000, and every tax,
 *     subsidy and affordability tile they opened next computed on an income
 *     they do not have.
 *
 * Both now read the shared field as a starting point and write nothing back,
 * which is the right shape for a tile that asks a question about a quantity it
 * does not own.
 *
 * So this pins the whole map rather than one tile: every numeric shared field
 * any calculator writes, together with the label of the control it came from.
 * A new tile that starts writing one, or an existing control that quietly
 * changes what it is asking for, fails here and has to argue for itself. The
 * label is part of the pin on purpose — the label is the only statement of what
 * the quantity *is*, so a reworded label is exactly the moment to re-ask
 * whether it still describes the field it feeds.
 *
 * Scope: numeric fields, because they can be driven with a sentinel and read
 * back unambiguously. `filingStatus`, `stateCode` and `county` are enums with
 * their own coverage in `profileIntegration.test.ts`.
 */
const NUMERIC_FIELDS = [
  "annualIncome",
  "householdSize",
  "qualifyingChildren",
  "qualifiedTipsAnnual",
  "qualifiedOvertimeAnnual",
  "preTaxContributions",
  "retirementContributionsAnnual",
  "employerMatchAnnual",
  "employerMatchCaptured",
  "essentialMonthlyExpenses",
  "totalMonthlyExpenses",
  "liquidSavings",
] as const satisfies readonly SituationKey[];

/**
 * The map, as `tile | field <- control label`, sorted.
 *
 * Read it as a sentence each time: does that control hold that quantity? The
 * borderline rows are the tax-base ones — `ira-deduction`, `ctc`,
 * `savers-credit` and `education-credits` write an AGI or a MAGI, and
 * `eitc` writes earned income, into a slot documented as gross income. Those
 * are a deliberate approximation the catalog already made and
 * `profileIntegration.test.ts` already asserts (a MAGI typed into Education
 * Credits is expected to reach `annualIncome`): the figures differ by
 * adjustments, they describe the same person's own income, and the alternative
 * is asking for income five times. The rows removed above were a different
 * thing — not an approximation of the reader's income but a different
 * household's, or a number that is not an income at all.
 */
const EXPECTED = [
  "charity-care | annualIncome <- Household income",
  "charity-care | householdSize <- People in household",
  "cliff-explorer | householdSize <- People in household",
  "cliff-explorer | qualifyingChildren <- Children who qualify for credits",
  "ctc | annualIncome <- Modified adjusted gross income",
  "ctc | qualifyingChildren <- Qualifying children (under 17)",
  "disability-insurance | annualIncome <- Annual income",
  "education-credits | annualIncome <- Modified adjusted gross income (MAGI)",
  "eitc | annualIncome <- Earned income",
  "eitc | qualifyingChildren <- Qualifying children",
  "federal-income-tax | annualIncome <- Wages and income",
  "fpl | annualIncome <- Annual household income",
  "fpl | householdSize <- Household size",
  "home-affordability | annualIncome <- Annual gross income",
  "ira-deduction | annualIncome <- Modified adjusted gross income (MAGI)",
  "marginal-explorer | annualIncome <- Current income",
  "marginal-reality | annualIncome <- Current income",
  "marginal-reality | householdSize <- People in household",
  "marginal-reality | qualifyingChildren <- Children who qualify for credits",
  "medicaid | annualIncome <- Annual household income",
  "medicaid | householdSize <- Household size",
  "paycheck-optimizer | annualIncome <- Gross annual wages",
  "peace-of-mind | essentialMonthlyExpenses <- Essential monthly expenses",
  "peace-of-mind | liquidSavings <- Liquid savings",
  "peace-of-mind | totalMonthlyExpenses <- Total monthly spending",
  "quarterly-taxes | annualIncome <- Net business profit",
  "retirement-optimizer | employerMatchAnnual <- Full employer match offered this year",
  "retirement-optimizer | employerMatchCaptured <- Employer match captured so far",
  "retirement-optimizer | retirementContributionsAnnual <- 401(k) so far this year",
  "sabbatical | essentialMonthlyExpenses <- Essential monthly spending",
  "sabbatical | liquidSavings <- Savings set aside",
  "savers-credit | annualIncome <- Adjusted gross income",
  "savers-credit | retirementContributionsAnnual <- Retirement contributions this year",
  "screener | annualIncome <- Annual household income",
  "screener | householdSize <- Household size",
  "screener | qualifyingChildren <- Qualifying children",
  "se-retirement | annualIncome <- Net business profit",
  "snap | householdSize <- Household size",
  "take-home | annualIncome <- Annual wages",
  "take-home | preTaxContributions <- Pre-tax adjustments",
  "take-home | qualifiedOvertimeAnnual <- Of that, qualified overtime premium",
  "take-home | qualifiedTipsAnnual <- Of that, qualified tips",
  "w4 | annualIncome <- Gross annual wages",
];

let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

afterEach(() => {
  document.body.replaceChildren();
});

const CALCULATORS = SUB_TOOLS.map(({ tile }) => tile).filter((t) => t.mount);

/**
 * Every module outside `src/tiles` that writes a shared field, and where its
 * own map lives.
 *
 * The roster above is the tile registry, which is not the same thing as every
 * writer on the site. The home anti-budget writes four shared fields and is not
 * a tile — it lives in the shell — so nothing here ever had anything to say
 * about it, and it went from launch to 2026-09-06 sharing none of the four
 * questions every tax tile asks. It cannot join the sentinel sweep either, and
 * for the sweep's own reason: its income box is per-period and its expense rows
 * are a sum, so every figure it writes is *derived* from a control rather than
 * equal to one, which is exactly what the sentinel exists to ignore.
 *
 * So a new writer outside `src/tiles` has to be listed here with the test that
 * holds its controls, rather than quietly sitting outside a sweep that reads
 * like it covers everything.
 */
const NON_TILE_WRITERS: Record<string, string> = {
  "src/ui/shell.ts": "tests/ui/homeBudgetProfile.test.ts",
  // The Readout writes confirmed *document* fields through `applyToSituation` —
  // a document's values rather than a control's — and is covered in tests/readout.
  "src/readout/toSituation.ts": "tests/readout",
};

/** The visible label of a control, which is the only statement of what it holds. */
function labelOf(root: HTMLElement, control: HTMLElement): string {
  const id = (control as HTMLInputElement).id;
  const label = id ? root.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
  const text = label?.textContent ?? control.closest("label")?.textContent;
  return (text ?? (control as HTMLInputElement).name ?? id).replace(/\s+/g, " ").trim();
}

/**
 * Type a value nothing else in the catalog would produce into one control, and
 * see which shared fields come back holding it.
 *
 * A sentinel rather than a plausible number, because a tile that writes a
 * *derived* figure — half the income, the income rounded — is not writing the
 * control's value and should not be reported as if it were. It is also large
 * enough to survive the clamps tiles apply to ages and household sizes without
 * being large enough to trip the profile schema's magnitude ceiling.
 */
function writesFrom(tile: TileDefinition): string[] {
  const root = document.createElement("div");
  const profile = new SituationStore();
  tile.mount!({
    root,
    params: new URLSearchParams(),
    setParams: () => {},
    permalink: () => "https://enklayve.com/#/x",
    navigate: () => {},
    locale: "en-US",
    data,
    profile,
  } as TileContext);
  // Some tiles open empty; pressing the example gives every control a value, so
  // a recompute triggered below has a complete set of fields to write from.
  [...root.querySelectorAll("button")]
    .find((b) => /try an example/i.test(b.textContent ?? ""))
    ?.click();

  const found: string[] = [];
  const inputs = [...root.querySelectorAll<HTMLInputElement>('input[type="number"]')];
  inputs.forEach((input, i) => {
    const sentinel = 700_000 + i * 1_000 + 3;
    input.value = String(sentinel);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    for (const field of NUMERIC_FIELDS) {
      if (profile.get(field) === sentinel)
        found.push(`${tile.id} | ${field} <- ${labelOf(root, input)}`);
    }
  });
  return found;
}

/**
 * The same map for the three fields a sentinel cannot drive.
 *
 * `filingStatus`, `stateCode` and `county` are enums, so "did this control
 * write it" is answered by walking a control through its own options and asking
 * which shared field comes back holding one. They are the fields where the
 * catalog's one confirmed instance of this bug actually landed — Education
 * Credits' two-value checkbox writing the five-value filing status — and that
 * fix was pinned to that one tile, which is a lock on the door somebody already
 * came through rather than on the corridor.
 *
 * Every row today is a control labelled "Filing status" or "State", which is
 * the honest result: a lock rather than a fix. What it holds is the meaning —
 * these fields say where the reader *lives* and how the reader *files*. A
 * control asking a question shaped like "and if you moved to" or "your spouse's
 * state" belongs to the same species as the two income writers removed above,
 * and the point of a pin is that the row appears here before it ships rather
 * than after.
 *
 * `county` is written by the six tiles that render the residence-local control
 * and by nothing else, and it never appears below: the county select exists
 * only once a state that levies a mandatory local tax is chosen, so it is not
 * reachable by walking the controls a tile opens with. `residenceLocalTiles.test.ts`
 * and the five tiles' own suites cover it, including the clearing case — moving
 * from Maryland to Texas must not leave Montgomery behind.
 */
const EXPECTED_ENUMS = [
  'amt-screener | filingStatus <- select "Filing status"',
  'capital-gains | filingStatus <- select "Filing status"',
  'charity-care | stateCode <- select "State"',
  'cliff-explorer | filingStatus <- select "Filing status"',
  'cliff-explorer | stateCode <- select "State"',
  'contract-vs-salary | filingStatus <- select "Filing status"',
  'education-credits | filingStatus <- checkbox "Married filing jointly"',
  'federal-income-tax | filingStatus <- select "Filing status"',
  'ira-deduction | filingStatus <- select "Filing status"',
  'marginal-explorer | filingStatus <- select "Filing status"',
  'marginal-explorer | stateCode <- select "State"',
  'marginal-reality | filingStatus <- select "Filing status"',
  'marginal-reality | stateCode <- select "State"',
  'paycheck-optimizer | filingStatus <- select "Filing status"',
  'paycheck-optimizer | stateCode <- select "State"',
  'quarterly-taxes | filingStatus <- select "Filing status"',
  'quarterly-taxes | stateCode <- select "State"',
  'savers-credit | filingStatus <- select "Filing status"',
  'se-retirement | filingStatus <- select "Filing status"',
  'self-employment-tax | filingStatus <- select "Filing status"',
  'take-home | filingStatus <- select "Filing status"',
  'take-home | stateCode <- select "State"',
  'w4 | filingStatus <- select "Filing status"',
];

const ENUM_FIELDS = [
  "filingStatus",
  "stateCode",
  "county",
] as const satisfies readonly SituationKey[];

/** Walk every option of every select, and both states of every checkbox. */
function enumWritesFrom(tile: TileDefinition): string[] {
  const root = document.createElement("div");
  const profile = new SituationStore();
  tile.mount!({
    root,
    params: new URLSearchParams(),
    setParams: () => {},
    permalink: () => "https://enklayve.com/#/x",
    navigate: () => {},
    locale: "en-US",
    data,
    profile,
  } as TileContext);

  const found: string[] = [];
  for (const select of root.querySelectorAll<HTMLSelectElement>("select")) {
    // Six options is enough to separate "writes the control's value" from
    // "happens to agree with the default", and keeps a fifty-state picker from
    // costing fifty recomputes in a sweep that runs over the whole catalog.
    for (const option of [...select.options]
      .map((o) => o.value)
      .filter(Boolean)
      .slice(0, 6)) {
      select.value = option;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      select.dispatchEvent(new Event("input", { bubbles: true }));
      for (const field of ENUM_FIELDS) {
        if (profile.get(field) === option) {
          found.push(`${tile.id} | ${field} <- select "${labelOf(root, select)}"`);
        }
      }
    }
  }
  for (const box of root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
    for (const checked of [true, false]) {
      const before = ENUM_FIELDS.map((f) => profile.get(f));
      box.checked = checked;
      box.dispatchEvent(new Event("change", { bubbles: true }));
      ENUM_FIELDS.forEach((field, i) => {
        if (profile.get(field) !== before[i]) {
          found.push(`${tile.id} | ${field} <- checkbox "${labelOf(root, box)}"`);
        }
      });
    }
  }
  return found;
}

/**
 * The two lists above, together, are every field the interface declares.
 *
 * They were hand-kept, which is the failure mode this file's own comments name
 * everywhere else: `qualifyingChildren` was added to My Situation, written by
 * four tiles, and the pinned map went on passing because the field was not on
 * the list it walks. A sweep that silently stops covering a field is worse than
 * no sweep, because the green tick is the thing people read.
 */
const DECLARED = (() => {
  const src = readFileSync(resolve(__dirname, "../../src/profile/situation.ts"), "utf8");
  const body = /export interface SituationValues \{([\s\S]*?)\n\}/.exec(src)?.[1] ?? "";
  return [...body.matchAll(/^ {2}(\w+)[?]?:/gm)].map((m) => m[1]!);
})();

describe("what a calculator may write into My Situation", () => {
  it("says which writers are outside this sweep, because the registry is not the site", () => {
    const src = resolve(__dirname, "..", "..", "src");
    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "tiles") walk(full);
          continue;
        }
        if (!entry.name.endsWith(".ts")) continue;
        const text = readFileSync(full, "utf8");
        // Either door into My Situation: the store directly, or the shared writer.
        if (/profile\.set\(|rememberShared\(|store\.set\(/.test(text)) {
          found.push(`src${full.slice(src.length)}`.replace(/\\/g, "/"));
        }
      }
    };
    walk(src);
    // A walk that finds nothing would make the check below vacuous.
    expect(found.length).toBeGreaterThan(0);
    expect(
      found.filter((f) => !(f in NON_TILE_WRITERS)).sort(),
      "these write My Situation from outside src/tiles, so the map above does not cover them —" +
        " add the module to NON_TILE_WRITERS with the test that holds its controls",
    ).toEqual([]);
  });

  it("walks every field My Situation declares", () => {
    const walked = new Set<string>([...NUMERIC_FIELDS, ...ENUM_FIELDS]);
    // `ages` and `debts` are lists rather than scalars: neither can be driven
    // by typing one value into one control, and both have their own coverage —
    // `debts` in `expansionTiles.test.ts`, `ages` in the exemption recorded by
    // `situationFieldsWritten.test.ts`, which is where the reason lives.
    const unwalked = DECLARED.filter((f) => !walked.has(f) && f !== "ages" && f !== "debts");
    expect(DECLARED.length).toBeGreaterThan(10);
    expect(unwalked, "a field My Situation declares that neither sweep drives").toEqual([]);
  });

  it("is exactly the pinned map of control to shared field", () => {
    const actual = [...new Set(CALCULATORS.flatMap(writesFrom))].sort();
    expect(
      actual,
      "a calculator's control now writes a shared field it did not before (or stopped) — " +
        "read the new line as a sentence and decide whether that control really holds that " +
        "quantity for THIS reader before pinning it",
    ).toEqual(EXPECTED);
  });

  it("is exactly the pinned map for the fields a sentinel cannot drive", () => {
    const actual = [...new Set(CALCULATORS.flatMap(enumWritesFrom))].sort();
    expect(
      actual,
      "a calculator's control now writes the reader's filing status, state or county — " +
        "these fields say where the reader lives and how the reader files, so a control " +
        "asking about anywhere or anyone else does not belong on this list",
    ).toEqual(EXPECTED_ENUMS);
  });

  it("asks about somebody else's money without writing it down", () => {
    // The two fixes above, stated as behavior rather than as an absence from a
    // list, so they survive a rewrite of the map.
    for (const [id, label] of [
      ["fafsa-sai", "the parents' income and household"],
      ["life-insurance", "the income a policy would replace"],
    ] as const) {
      const tile = CALCULATORS.find((t) => t.id === id)!;
      expect(tile, `${id} is gone from the catalog`).toBeDefined();
      const wrote = writesFrom(tile).filter((line) => /annualIncome|householdSize/.test(line));
      expect(wrote, `${id} wrote ${label} into the reader's own profile`).toEqual([]);
    }
  });
});
