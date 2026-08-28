# SPEC-4 companion — Readout v2: documents that answer

> Generalizes the Readout ([SPEC-2.md](SPEC-2.md) §2) from *extraction* to *answers*, per [SPEC-4.md](SPEC-4.md) §2.2. Hardened 2026-08-28: §2.1 type shapes, §3 phase mapping, §4.1 the check registry contract. The determinism, anchoring, and confirmation rules of SPEC-2 §2.2 are unchanged and non-negotiable.

---

## 1. What changes, and what does not

**Unchanged.** Extraction stays anchored and rule-based — labels and box numbers, never inference, never a model. Extractors stay pinned to a form revision and flag an unrecognized revision instead of guessing. OCR-sourced text still marks every field lower-confidence and needs-review. **Nothing reaches My Situation without the user confirming it.** Nothing leaves the device.

**What changes.** Today a Readout ends at a table of fields. Users do not have a field-extraction problem; they have a *"what does this mean and what do I do"* problem. Readout v2 adds a layer on top of the same extraction: every recognized document produces an **answer** in a fixed four-part shape.

---

## 2. The four-part answer shape

Every document, every kind, renders the same four sections in the same order. The shape is the product.

| Section | Contents | Rule |
| --- | --- | --- |
| **What this says** | The document restated in plain English — the two or three numbers that matter and what they mean. | Restatement only. Every figure traces to an extracted field. |
| **What looks wrong** | Deterministic checks that failed, each phrased as a question to ask, not a verdict. Empty is a valid and common result, rendered as "nothing flagged." | Never asserts an error. States the arithmetic or the rule mismatch and who to ask. |
| **What you may be owed** | Credits, refunds, protections, or programs this document indicates the household may be eligible for, each linking to the tile that computes it. | An estimate with a citation, never a determination. |
| **What to do next, by when** | An ordered list of next actions. Any action with a statutory clock is a `Deadline` ([SPEC-4.md](SPEC-4.md) §7.3) and renders through `renderDeadline`. | An action must be free or clearly labeled otherwise, and must name the specific channel. |

A document kind that cannot fill a section leaves it empty with a one-line reason. Empty is honest; filler is not.

### 2.1 The shape, as types

Added to `src/readout/types.ts`, sitting on top of the existing `ExtractionResult` rather than replacing it:

```ts
export interface ReadoutAnswer {
  /** The extraction this answer was built from — unchanged, still user-confirmed. */
  source: ExtractionResult;
  says: { label: string; value: string; fieldId: string }[];
  flags: CheckOutcome[];
  owed: { label: string; estimate?: Money; citation: CitationData; tileId: string }[];
  next: { label: string; channel?: { label: string; url: string }; deadline?: Deadline }[];
  /** Why a section is empty, when it is. Keyed by section name. */
  emptyReasons: Partial<Record<"says" | "flags" | "owed" | "next", string>>;
}
```

`ReadoutTarget` (the narrow set of My Situation fields the Readout may populate) widens only when a new document kind genuinely maps to a profile field, and each addition is a deliberate edit — the narrowness is the safety property, not an oversight.

---

## 3. New document kinds

Existing `DocKind` values (W-2, 1040, paystub, the 1099 series, 1095-A, 1098, FAFSA summary) all gain the four-part answer layer. New kinds:

| Kind | Extract | The answer it enables | Phase |
| --- | --- | --- | --- |
| `eobHealth` — Explanation of Benefits | Billed, allowed, plan paid, patient responsibility, deductible/OOP applied, network status | The plan-math and balance-billing checks of [SPEC-4-safety-net.md](SPEC-4-safety-net.md) §B1 | 22 |
| `medicalBill` — itemized hospital/provider bill | Line items, quantities, dates of service, total | Duplicate and arithmetic screens; the §A6 charity-care pointer via FPL | 22 |
| `benefitsNotice` — Medicaid / SNAP / ACA / UI determination or denial | Determination, reason code, effective date, **appeal deadline** | §B3: make it legible, surface the clock, name the appeal channel | 22 |
| `collectionsNotice` | Alleged creditor, original creditor, amount, dates | The debt-validation window and the garnishment screener (§B2); routes to CFPB and legal aid | unscheduled |
| `retirementStatement` — 401(k)/403(b) statement with fee disclosure | Balance, contributions, employer match, expense ratios / fee disclosure | Match capture vs. the plan's full match; lifetime cost of the expense ratio via the existing compound-growth engine | unscheduled |
| `closingDisclosure` | Loan terms, rate, points, itemized closing costs, cash to close | Arithmetic verification against the loan engine; term/rate reconciliation against the Loan Estimate | unscheduled |
| `insuranceDeclarations` — auto / home / renters | Coverage limits, deductibles, premium | Feeds the umbrella-coverage sizing tile with real limits instead of guesses | unscheduled |
| `propertyTaxBill` | Assessed value, rate, exemptions applied | Which exemption *categories* exist to ask the assessor about | unscheduled |

**Phase 22 ships the first three only.** The five marked *unscheduled* are specified here so the shape is designed for them, but each needs its own extractor validation against real document layouts before it earns a phase — an extractor built against an imagined layout is the exact failure mode SPEC-2 §2.2 exists to prevent.

---

## 4. The check catalog is a first-class, cited artifact

"What looks wrong" is where a document reader earns its keep and where it can most easily do harm. Every check is a named, tested, cited rule with a fixed shape:

- **Arithmetic checks** — the document is internally inconsistent (line items do not sum to the total; the deductible applied exceeds the deductible). Highest confidence, lowest harm, no citation needed beyond the arithmetic itself.
- **Plan-math checks** — the document is inconsistent with parameters the *user* supplied (their plan's deductible, coinsurance, OOP max). Phrased with explicit dependence on the user's input: "if your deductible is $3,000, this line does not reconcile — worth asking about."
- **Rule checks** — the document appears to conflict with a published rule (a balance bill in a No Surprises Act context; a fee above a statutory cap). Always cited, always Tier 3 screener framing, always paired with the channel to raise it through.
- **Anomaly checks** — statistically unusual but not provably wrong (a duplicate line item on the same date). Phrased at the lowest confidence: "this may be intentional; worth confirming."

### 4.1 The registry contract

Checks live in `src/readout/checks.ts` as a registry, not as inline conditionals, so the properties below are testable in one place:

```ts
export interface CheckDefinition {
  id: string;
  kind: "arithmetic" | "plan-math" | "rule" | "anomaly";
  appliesTo: DocKind[];
  /** Required for kind "rule"; forbidden for kind "arithmetic". */
  citation?: CitationData;
  /** What a false positive looks like, in one sentence. Required for every check. */
  falsePositive: string;
  /** Suppressed when the source text came from OCR (true for "rule" always). */
  suppressOnOcr: boolean;
  run(ctx: CheckContext): CheckOutcome | null;
}
```

**A check that cannot state what a false positive looks like does not ship** — a registry test fails on an empty `falsePositive`, and a second asserts that every `kind: "rule"` check has a citation and `suppressOnOcr: true`. The failure mode we are avoiding is a household disputing a correct bill because we flagged it confidently.

---

## 5. Multi-document reconciliation

Once several documents are in one session, cross-document checks become possible and are among the most valuable things here:

- **Paystub × W-2** — does year-to-date withholding on the final stub reconcile with Box 2?
- **1095-A × 1040** — is the premium tax credit reconciliation consistent with income actually reported?
- **EOB × medical bill** — does the provider's bill match the patient responsibility the plan calculated? This one catches real money, is the single most valuable cross-check on the list, and is the only one scheduled (Phase 22).
- **Closing Disclosure × Loan Estimate** — which costs moved, and were they in a category permitted to move?

Reconciliation obeys the same rule as everything else: a mismatch is a question to ask, never an accusation, and it names the party to ask. Cross-checks live in the same registry with `appliesTo` listing more than one kind, and are skipped silently when only one of the pair is present.

---

## 6. Constraints that do not bend

1. **No inference, no model, no network.** Anchored extraction only. A document we cannot recognize is reported as unrecognized. We never guess at a layout.
2. **Confirmation before use**, exactly as today — every extracted value is shown for confirmation before it populates My Situation.
3. **Nothing persists.** A dropped document is read in memory and gone on unload. Persisting a snapshot is the Standing Ledger's opt-in job ([SPEC-4-ledger.md](SPEC-4-ledger.md)), and even then it holds a user-reviewed snapshot, never the document.
4. **Scanned documents degrade, they do not fail.** OCR-sourced text lowers confidence on every field and suppresses rule checks entirely — an OCR misread must never become a "this bill is wrong" claim. Arithmetic and plan-math checks may still run, clearly labeled as based on a scan.
5. **Every deadline is a `Deadline`.** It carries its citation structurally and renders through `renderDeadline`, as everywhere else in SPEC-4.

---

## 7. Acceptance criteria

1. `ReadoutAnswer` renders all four sections for `eobHealth`, `medicalBill`, and `benefitsNotice`, with an explicit `emptyReasons` entry wherever a section is empty.
2. The check registry test fails any check with an empty `falsePositive`, any `rule` check without a citation, and any `rule` check with `suppressOnOcr: false`.
3. An OCR-sourced document runs zero rule checks — asserted by a test on a fixture marked OCR.
4. The EOB × medical-bill cross-check fires on a matched pair and stays silent on an unmatched single document.
5. No extracted value reaches My Situation without confirmation, and no document or document text is written anywhere — unchanged from SPEC-2 and re-asserted by test.
