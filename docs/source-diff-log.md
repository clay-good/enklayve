# Source diff log

A reverse-chronological journal of every change a data-refresh job proposed to a
bundled dataset — what changed, and the old-to-new values (BUILD-SPEC.md §7.3
step 2). Each refresh workflow (`.github/workflows/refresh-*.yml`) appends an
entry here when it fetches a source, so a reviewer can see exactly what moved
before approving the data pull request. Entries are written by
[`scripts/refresh/run.ts`](../scripts/refresh/run.ts); do not edit them by hand.

How to read an entry:

- **open-pr** — the source was fetched and parsed, values changed, and the entry
  lists each `path: old -> new`. The workflow rebuilds the manifest, runs the
  full golden suite, and opens a PR only if it stays green (the test gate;
  §7.3 steps 3–5). A reviewer still owns rolling a shard to a new effective year
  and transcribing any full bracket table — the adapters refresh figures in
  place; see [`scripts/refresh/adapters.ts`](../scripts/refresh/adapters.ts).
- **alert-pr** — the source 404'd or failed to parse. The committed shard is left
  untouched (last-good data keeps working), and an alert is raised for a human.
  The runtime fail-safe gate already shows a verify-before-relying banner if a
  dataset falls outside its refresh window, so a stale source degrades safely
  rather than shipping a wrong number.
- **no-op** — fetched and valid, but nothing changed; no entry is written.

See [`data-sources.md`](data-sources.md) for the sources and cadence, and
[`contributing.md`](contributing.md) for the workflow.

<!-- entries -->
