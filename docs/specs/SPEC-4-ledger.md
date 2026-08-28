# SPEC-4 companion — The Standing Ledger

> The return-visit mechanic for a utility with no accounts, no server, and no telemetry, per [SPEC-4.md](SPEC-4.md) §2.4. Phase 24, built last, once there are answers worth re-running. Hardened 2026-08-28: §2.1 the snapshot schema, §3.1 the material-change threshold, §4 Path 2 deferred with its reason.

---

## 1. The idea in one paragraph

Every personal-finance product that wants you back builds the same loop: an account, a server-side copy of your finances, and a notification. We can build the *useful half* of that loop with none of the machinery. The site holds a snapshot of your situation and the answers you cared about **on a file you keep**, and when the bundled data changes — new poverty guidelines, a new contribution limit, a new ACA table, a new tax year — it recomputes those answers and shows you the diff: *four answers changed, one crossed a threshold, one has a deadline in 21 days.* That is the entire feature. It is genuinely valuable, it requires no server, and it cannot leak, because there is nothing anywhere to leak.

---

## 2. What a snapshot holds

A snapshot is small, user-reviewed, and legible as plain JSON before it is sealed:

| Part | Contents |
| --- | --- |
| **Situation** | The existing `SituationSnapshot` — values plus per-field provenance. |
| **Watched answers** | For each answer the user chose to keep: the tile id, its URL state (the same deep-link fragment that already reproduces any result), **and the computed result at snapshot time**. |
| **Deadlines** | Any `Deadline` surfaced by a life-event sequence or a document Readout, carrying its citation as the type requires. |
| **Provenance** | The dataset manifest `schemaVersion`, the per-shard `id`/`version`/`effectiveYear` in effect when the snapshot was taken, and the snapshot date. |

**Never in a snapshot:** a document, a document's text, an account number, a name, an address, an SSN, or anything the Readout extracted that the user did not explicitly confirm and choose to keep.

### 2.1 The schema

Lives in `src/profile/ledger.ts`, validated by Zod on import exactly the way a data shard is:

```ts
export interface WatchedAnswer {
  tileId: string;
  /** The deep-link fragment that reproduces this result. */
  params: string;
  label: string;
  /** The result at snapshot time — this is what makes historical shards unnecessary. */
  value: Money;
  /** Non-numeric results (an eligibility status, a plan name) travel here instead. */
  status?: string;
}

export interface LedgerSnapshot {
  format: "enklayve.ledger";
  version: 1;
  takenOn: string;                       // ISO date
  situation: SituationSnapshot;
  answers: WatchedAnswer[];
  deadlines: Deadline[];
  provenance: { schemaVersion: number; shards: { id: string; version: string; effectiveYear: number }[] };
}
```

An import that fails the schema is rejected with a plain-English reason, never partially applied — the same fail-loudly posture as a malformed shard.

---

## 3. The recompute diff

The mechanism, and the reason no historical data needs to be bundled:

1. The snapshot stores **the answers themselves**, not just the inputs.
2. On import, the site recomputes each watched answer from its stored `params` against the **currently bundled** data.
3. The diff is stored-answer vs. recomputed-answer. The site never needs a copy of last year's shards — only last year's *results*, which the user is carrying.

The diff renders in three tiers, in this order:

- **Threshold crossings** first — an eligibility status flipped, a phase-out was entered or exited, a cliff moved past you or under you. This is the "the world moved under you" case and it is the whole point. Reported **regardless of dollar magnitude**.
- **Material changes** next — an answer moved by more than the §3.1 threshold, with the shard that caused it named ("your ACA credit changed because the applicable-percentage table was updated").
- **Deadlines** last, sorted by nearness, each with its citation.

"Nothing changed" is a first-class, calm, common result and must render as reassurance, not as an empty state.

### 3.1 What counts as material

A recomputed answer is **material** when it differs from the stored value by more than **the greater of $25 or 1%** of the stored value. Below that it is recorded as unchanged, so a rounding-level shift in a bracket does not manufacture a notification. Two rules make this honest:

- A **status** change (`WatchedAnswer.status`) is always a threshold crossing, never subject to the dollar floor.
- A change that is immaterial in isolation but crosses a program's eligibility boundary is a threshold crossing, not a material change — the boundary wins.

The threshold is a named constant with its rationale in a comment, so it is arguable rather than magic.

### 3.2 The clock is an input

Every recomputed answer remains a pure function of the stored inputs and the bundled dataset version. The *deadline* view additionally needs today's date to compute days remaining, so `asOf` is an explicit parameter — displayed on screen and encoded in any shared link, exactly as `renderDeadline` requires ([SPEC-4.md](SPEC-4.md) §7.3). The view is reproducible; the determinism contract is kept honestly rather than quietly bent.

---

## 4. Storage: the carried file, and why that is the only path for now

**Path 1 — the carried file. This is what Phase 24 ships.** The snapshot is exported as a file using the existing portable-profile envelope — `PBKDF2-SHA256` (210,000 iterations) → `AES-GCM`, all via Web Crypto, a local computation permitted under the strict `connect-src 'none'` CSP — under a new `enklayve.ledger` / `enklayve.ledger.encrypted` format id alongside the existing `enklayve.situation` pair. The user keeps it wherever they keep files and drops it back in like any other document. Nothing is left on the machine. This preserves SPEC §2 principle 8 exactly as written and is the right behavior on a shared, library, or work computer.

**Path 2 — "remember on this device" — is deferred, and this is the reason.** The release audit's `checkLocalStorage` permits persistence in exactly one module, which is the mechanical expression of principle 8: *nothing financial persists.* A device-local snapshot would require widening that allowlist, and widening a privacy gate is a decision that should be paid for with evidence — specifically, evidence that real users lose snapshots on the carried-file path and that the feature is therefore worth the weakened invariant. Building it "because it is more convenient" is how a privacy posture erodes one reasonable-sounding step at a time.

If Path 2 is ever adopted, it ships with all of the following or not at all, and the audit rule is widened by exactly one named module (`profile/ledgerStore.ts`) plus a new check asserting that module writes ciphertext only:

- an explicit consent step naming what is stored, where, and who can reach it (nobody but this browser on this machine);
- a "not on a shared or public computer" warning at the moment of choosing;
- one-click delete that is complete, discoverable without hunting, and confirms what was removed;
- an expiry — a snapshot untouched past a stated window is dropped automatically rather than lingering;
- **no automatic capture, ever.** A snapshot is created only by a deliberate user action.

Under either path, the invariant that matters holds: **a user who never opts in experiences the product exactly as it is now** ([SPEC-4.md](SPEC-4.md) §4, addition 10).

---

## 5. What this explicitly is not

- **Not an account.** No identifier, no login, no recovery, no server-side anything. A lost file means a lost snapshot, and that trade is stated up front and accepted on purpose.
- **Not sync.** Two devices means two files. If you want continuity across devices, you carry the file.
- **Not a notification.** There is no push, no email, and no background process. The diff is computed when you come back — the only mechanism available to a site that cannot phone home, and also the one that respects the user most.
- **Not engagement.** No streaks, no points, no badges, no nudges to return. If nothing changed, the site says so in one calm line and gets out of the way.

---

## 6. Acceptance criteria

1. A user who never exports sees zero behavioral difference from today — verified by an e2e test asserting no new persisted state across a full session.
2. A snapshot round-trips exactly: export, reimport, and every watched answer reproduces bit-for-bit against the same dataset version.
3. The recompute diff is golden-tested against a **synthetic dataset-version bump** — a fixture with an altered shard proves that threshold crossings, material changes, and unchanged answers are each classified correctly, including the §3.1 floor and the boundary-wins rule.
4. A snapshot never contains an unconfirmed extracted value, a document, or an identifier; enforced by a Zod schema test on the snapshot shape, not by convention.
5. An import failing the schema is rejected whole, with a plain-English reason, and leaves My Situation untouched.
6. Every deadline in a snapshot carries its citation and participates in the staleness banner, exactly as a bracket does.
7. `checkLocalStorage` is unchanged by this phase — Phase 24 adds no new persistence.
