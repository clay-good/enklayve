# SPEC-4 companion — The Standing Ledger

> The return-visit mechanic for a utility with no accounts, no server, and no telemetry, per [SPEC-4.md](SPEC-4.md) §2.4. Wave C: build this last, once there are answers worth re-running.

---

## 1. The idea in one paragraph

Every personal-finance product that wants you back builds the same loop: an account, a server-side copy of your finances, and a notification. We can build the *useful half* of that loop with none of the machinery. The site holds a snapshot of your situation and the answers you cared about **on your device, under your control**, and when the bundled data changes — new poverty guidelines, a new contribution limit, a new ACA table, a new tax year — it recomputes those answers and shows you the diff: *four answers changed, one crossed a threshold, one has a deadline in 21 days.* That is the entire feature. It is genuinely valuable, it requires no server, and it cannot leak, because there is nothing anywhere to leak.

---

## 2. What a snapshot holds

A snapshot is small, user-reviewed, and legible as plain JSON before it is sealed:

| Part | Contents |
| --- | --- |
| **Situation** | The existing `SituationSnapshot` — values plus per-field provenance. |
| **Watched answers** | For each answer the user chose to keep: the tile id, its URL state (the same deep-link fragment that already reproduces any result), **and the computed result at snapshot time**. |
| **Deadlines** | Any dated obligation surfaced by a life-event sequence or a document Readout: what, when, cited source, and the tile or channel it points to. |
| **Provenance** | The dataset manifest version and per-shard versions in effect when the snapshot was taken, plus the snapshot date. |

**Never in a snapshot:** a document, a document's text, an account number, a name, an address, an SSN, or anything the Readout extracted that the user did not explicitly confirm and choose to keep.

---

## 3. The recompute diff

The mechanism, and the reason no historical data needs to be bundled:

1. The snapshot stores **the answers themselves**, not just the inputs.
2. On reopening with the snapshot loaded, the site recomputes each watched answer from its stored URL state against the **currently bundled** data.
3. The diff is stored-answer vs. recomputed-answer. The site never needs a copy of last year's shards — only last year's *results*, which the user is carrying.

The diff is rendered in three tiers, in this order:

- **Threshold crossings** first — an eligibility status flipped, a phase-out was entered or exited, a cliff moved past you or under you. This is the "the world moved under you" case and it is the whole point.
- **Material changes** next — an answer moved by more than a stated threshold, with the shard that caused it named ("your ACA credit changed because the applicable-percentage table was updated").
- **Deadlines** last, sorted by nearness, each with its citation.

"Nothing changed" is a first-class, calm, common result and must render as reassurance, not as an empty state.

**One honest note on determinism.** Every recomputed answer remains a pure function of the stored inputs and the bundled dataset version. The *deadline* view additionally reads the system clock to compute days remaining, so the clock is treated as an explicit, displayed input — the date used is shown on screen and encoded in any shared link, so the view is reproducible.

---

## 4. Storage: two paths, both user-held

**Path 1 — the carried file (default and recommended).** The snapshot is exported as an encrypted file using the existing portable-profile mechanism. The user keeps it wherever they keep files, and drops it back in like any other document. Nothing is left on the machine. This preserves SPEC §2 principle 8 exactly as written and is the right default on a shared, library, or work computer.

**Path 2 — remember on this device (explicit opt-in).** For a personal device, an encrypted-at-rest device-local snapshot behind a user passphrase, with:

- an explicit consent step that says in plain words what is stored, where, and who can reach it (nobody but this browser on this machine);
- a clear "not on a shared or public computer" warning at the moment of choosing;
- one-click delete that is genuinely complete, discoverable without hunting, and confirms what was removed;
- an expiry — a snapshot untouched past a stated window is dropped automatically rather than lingering;
- **no automatic capture, ever.** A snapshot is created only by a deliberate user action. Closing the tab without saving leaves nothing behind, exactly as today.

Both paths, and neither path, must leave the site's existing behavior untouched: **a user who never opts in experiences the product exactly as it is now** ([SPEC-4.md](SPEC-4.md) §4, addition 10).

---

## 5. What this explicitly is not

- **Not an account.** No identifier, no login, no recovery, no server-side anything. A lost file or a cleared browser means a lost snapshot, and that trade is stated up front and accepted on purpose.
- **Not sync.** Two devices means two files. If you want continuity across devices, you carry the file.
- **Not a notification.** There is no push, no email, and no background process. The diff is computed when you come back — which is the only mechanism available to a site that cannot phone home, and is also the one that respects the user most.
- **Not engagement.** No streaks, no points, no badges, no nudges to return. If nothing changed, the site says so in one calm line and gets out of the way.

---

## 6. Acceptance criteria

1. A user who never opts in sees zero behavioral difference from today — verified by an e2e test asserting no new persisted state on a full session with no opt-in.
2. A snapshot round-trips exactly: export, reimport, and every watched answer reproduces bit-for-bit against the same dataset version.
3. The recompute diff is golden-tested against a **synthetic dataset-version bump** — a fixture with an altered shard proves that threshold crossings, material changes, and unchanged answers are each classified correctly.
4. A snapshot never contains an unconfirmed extracted value, a document, or an identifier; enforced by a schema test on the snapshot shape, not by convention.
5. Device-local storage is encrypted at rest, expires, and its one-click delete is verified by an e2e test that asserts the storage is empty afterward.
6. Every deadline in a snapshot carries its citation and participates in the staleness banner, exactly as a bracket does.
