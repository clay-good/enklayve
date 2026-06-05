# SPEC-3 companion — Citation Integrity

> The citation contract behind [SPEC-3.md](SPEC-3.md) §3. This is the spec for the load-bearing principle — "every rule cites its source" ([SPEC.md](SPEC.md) §2 principle 5) — restated precisely enough to test, plus the audit results as of 2026-06-05 and the formatting conventions a citation must follow.

A citation is a promise that a number is not invented. The promise has three parts — it must **exist** (coverage), be **current** (freshness), and **read clearly** (formatting). The system already enforces the first hard, the second by documented convention, and the third loosely; this spec tightens the third and closes a few seams in the first.

The audit's verdict: the citation system is healthy. Build-time enforcement is real, every shard in the manifest carries the full provenance record, all source URLs are valid HTTPS, and the deliberate freshness exceptions are documented and defensible. The fixes are three low-severity on-screen consistency gaps and one formatting convention.

---

## 1. The three obligations

### 1.1 Coverage — no orphan numbers

**Contract.** Every figure that originates from the bundled dataset resolves to a non-empty citation, and the resolution is enforced twice:

- **At build time.** [`scripts/audit-release.ts`](../../scripts/audit-release.ts) walks the shipped data and fails the build if any shard is missing a citation field — the "no orphan numbers ship" gate ([SPEC.md](SPEC.md) §9). The engine's [`assertCited`](../../src/engine/citation.ts#L71) is the runtime form of the same gate: it throws if any required citation field is empty or malformed.
- **On screen.** A `BreakdownLine` that displays a statutory figure carries an inline `citation`, rendered as a "source" link by [`resultCard.ts`](../../src/ui/resultCard.ts#L40).

**What must carry an on-screen citation:** any line showing a value read from a shard — a tax bracket result, a contribution or §415(c) limit, a FICA wage base, a poverty line, a credit amount, an applicable percentage, an allowance read from a published table, an I-bond rate.

**What need not:** a figure derived purely by arithmetic on values the user typed or that are already shown and cited on the same card — an effective rate, a sum, a subtotal like "available income = income − allowances". The test is: *could the user reproduce this line with a calculator from numbers already in front of them, cited?* If yes, a citation is optional.

**The consistency rule (the seam the audit found).** When a derived figure sits in a group whose siblings are all cited, cite it too. Three places break this today; all are low-severity and specified in [SPEC-3-hardening.md](SPEC-3-hardening.md) §A:

| # | Line | File | Fix |
|---|------|------|-----|
| A1 | I-bond "Value now" (uncited; "Interest earned" above it is cited) | [`savingsBond.ts:117`](../../src/tiles/savingsBond.ts#L117) | add `citation: cite` |
| A2 | Backdoor-Roth "Tax-free portion" (uncited; "Taxable portion" is cited) | [`backdoorRoth.ts:169`](../../src/tiles/backdoorRoth.ts#L169) | add `citation: PRO_RATA_CITATION` |
| A3 | FAFSA allowance lines (uncited; SAI/Pell are cited) | [`fafsaSai.ts:124-129`](../../src/tiles/fafsaSai.ts#L124) | cite the three table-sourced allowance lines; leave the derived subtotals |

### 1.2 Freshness — current, or documented and within the window

**Contract.** Each shard's `effectiveYear` is the active tax/benefit year, and its `dateRetrieved` is recent. When a figure cannot yet be the current year — because the issuing agency has not published it — the gap is stated plainly in the `sourceDocument` string and the shard stays inside its refresh window; outside the window, the runtime fail-safe ([data-sources.md](../data-sources.md) §"The fail-safe contract") flips the dependent tiles to the verify-before-relying banner.

**Audit result (2026-06-05).** Of 45 shards, exactly one carries `effectiveYear < 2026`, and it is the documented exception:

- **`cpi-u-annual` (effectiveYear 2025).** The `sourceDocument` explains the 2025 figure is the Jan–Sep average because the October 2025 BLS release was delayed by the appropriations lapse. Inside the two-year staleness window; refresh on the next CPI cycle. **Defensible.**

The other deliberate, documented exceptions remain defensible as of today:

- **`state-ca-income-tax-2024`** — carries the FTB's latest *published* (2025) bracket schedule because the 2026 CCPI-indexed brackets are not yet issued; the 2026 standard deduction is confirmed. Conservative (slightly under-indexed). Revisit when the FTB publishes 2026 schedules (typically Dec–Jan).
- **`fafsa-2024-2025`** — uses the 2026-27 dependent-student methodology (the current SAI Formula Guide); the shard id keeps the legacy filename suffix, consistent with the project-wide `-2024` id convention noted in [data-sources.md](../data-sources.md).
- **`aca-2024`** — reflects the post-ARPA 2026 schedule: applicable percentages rise and the 400%-FPL cliff returns. Current and correct.

**No undocumented staleness was found.** All `dateRetrieved` values cluster 2026-06-02 to 2026-06-05.

### 1.3 Formatting — a citation reads clearly at a glance and on hover

**Contract.** On screen, a citation renders as a compact `source` link whose tooltip reads `Source: {sourceDocument} ({effectiveYear})` ([`resultCard.ts:41`](../../src/ui/resultCard.ts#L41)). The link text stays short ("source"); the `sourceDocument` is the human-readable name; the URL is a valid HTTPS deep link to the issuing authority.

**Audit result.** URLs are clean — all HTTPS, no `http://`, no obviously-dead links; the one homepage-only URL (`state-nh-income-tax-2024` → `revenue.nh.gov`) is correct because NH has no wage tax to deep-link. The rendering itself is accessible and does not overflow the table cell (the cell shows only "source").

**The one formatting defect — overlong `sourceDocument` strings (medium).** Five strings have grown well past a tooltip's comfortable length, because they smuggle explanatory prose into the document *name*:

| shard | `sourceDocument` length |
|-------|------------------------:|
| `fafsa-2024-2025` | 840 |
| `state-ut-income-tax-2024` | 753 |
| `state-la-income-tax-2024` | 707 |
| `state-ia-income-tax-2024` | 659 |
| `state-ca-income-tax-2024` | 578 |

An 840-character `title` tooltip is a usability problem (it can span the viewport and is awkward for screen readers reading it as one string). The detail is valuable as an audit record, so the fix is to **split the field, not truncate it** — see §2.

---

## 2. The short-label / long-note convention (the formatting fix)

Today `sourceDocument` does double duty: it is both the short name shown on hover *and* the place maintainers have parked transcription notes ("…the 2026-indexed brackets are not yet issued, so these latest-published values are used…"). Separate the two concerns.

**Proposed schema addition** (additive, backward-compatible). In [`src/data/schemas.ts`](../../src/data/schemas.ts) `CitationSchema`, add an optional `sourceNote`:

```
sourceDocument: z.string().min(1).max(160),   // short, citation-style name
sourceNote:     z.string().optional(),         // the long "why this value / transcription" prose
```

- **`sourceDocument`** becomes the citation-style short name, capped (≈160 chars) so the tooltip stays readable — e.g. `"Utah State Tax Commission, 2026 individual income tax (SB 60, 2026)"` or `"California FTB 2025 tax-rate schedules; 2026 standard deduction"`.
- **`sourceNote`** holds everything currently overflowing the name: the appropriations-lapse explanation, the "latest published, 2026 not yet issued" rationale, the per-state transcription caveats. It is shown in the readout report and the data-sources page, not in the small hover tooltip.

**Rendering.** [`citationLink`](../../src/ui/resultCard.ts#L40) keeps building the tooltip from `sourceDocument (effectiveYear)` — now guaranteed short. The readout report ([`src/readout/report.ts`](../../src/readout/report.ts)) appends `sourceNote` where it has room to wrap. The build audit gains a check that `sourceDocument.length <= 160` so the convention cannot silently regress.

**Migration.** Mechanical, data-only: for each of the five overlong shards (and any future one), move the explanatory tail from `sourceDocument` into `sourceNote`, leaving a clean name. No engine logic changes; the golden suite is unaffected because it does not assert on the prose. This is a reviewer's data edit on the resulting PR, like rolling a bracket table.

---

## 3. Style guide for new citations

So the next jurisdiction or tool stays consistent:

1. **`sourceDocument` is a name, not a paragraph.** Pattern: `"{Agency}, {publication or rule} ({statute / bill / rev-proc})"`. Examples: `"IRS Rev. Proc. 2024-40 (2026 inflation adjustments)"`, `"SSA, 2026 OASDI fact sheet"`, `"Louisiana Dept. of Revenue, RIB 25-012 (Act 11, 2024)"`. Keep it under 160 characters; put rationale in `sourceNote`.
2. **`sourceUrl` is a deep HTTPS link to the issuing authority**, not a search result or an aggregator. A homepage is acceptable only when there is no stable deep link (the NH case).
3. **`effectiveYear` is the tax/benefit year the figure applies to**, independent of the shard's filename suffix or the award-year naming the agency uses.
4. **`dateRetrieved` is the ISO date the value was last transcribed or verified.**
5. **`contentHash` is required for shard-backed data** (it is the tamper/staleness check the refresh workflow records) and **omitted for hand-authored statutory-rule citations** written inline in a tile (e.g. `PRO_RATA_CITATION`), where there is no shard to hash — this is why `contentHash` is optional in `CitationData` and the inline citation is valid without it (see [SPEC-3-hardening.md](SPEC-3-hardening.md) §C3).
6. **Inline tile resources (`resources: [{label, url}]`)** follow the same authority-and-HTTPS rule and use a short human label.

---

## 4. Acceptance criteria

1. The three coverage gaps (§1.1 A1–A3) are closed; `npm run audit` and the golden + UI suites stay green.
2. `CitationSchema` gains the optional `sourceNote`; the five overlong `sourceDocument` strings (§1.3) are split into a ≤160-char name plus a note; the audit enforces the length cap going forward.
3. The readout report renders `sourceNote` where present, and the on-screen tooltip is built only from the short `sourceDocument`.
4. No regression in freshness: every shard remains current-year or a documented exception inside its refresh window, and the one CPI exception is refreshed on its next cycle.
