<!--
Title: Conventional Commits — `type(scope): imperative summary`, lowercase, no
trailing period. e.g. `fix(engine): the county tax used the state's base`.
-->

## What was wrong / what was missing

<!-- The old behaviour, or why this is needed, in plain language. One paragraph. -->

## What this does

<!-- The new behaviour and the mechanism. -->

## Proof it works

<!--
For a bug: how to reproduce the original, and the concrete evidence it is fixed
— the failing-then-passing test, before/after output, repro steps.
For a feature: the test, demo, or before/after that shows the capability.

"The suite is green" is not proof on its own. A green suite can hold none of
the lines a change draws.
-->

## Notes, limits, follow-ups

<!-- Non-blocking observations, deliberate scope limits, anything deferred. -->

---

### The gate

Run these locally before asking for a review. CI runs exactly the same ones.

- [ ] `npm run format:check`
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run test`
- [ ] `npm run build` then `npm run audit`
- [ ] `npm run test:e2e` (its own CI job — needed if this touches the UI, the
      service worker, or anything a `<select>` does; happy-dom cannot see those)

### If this touches a **figure**

Every number this site shows carries a source, and that is the whole trust
model — so a data change is a sourcing change first and a code change second.

- [ ] The figure is read from the **issuing authority's own document**, not a
      summary, an aggregator, or a search result. The citation links it.
- [ ] `sourceNote` says what the figure **leaves out**, and any omission errs
      *high* (costing the reader more than reality) rather than low.
- [ ] `npm run data:manifest` re-run, with the regenerated `.sha256` and
      `manifest.json` committed.
- [ ] Golden-tested to the cent, and `npm run check:adapters -- --group <group>`
      dry-run if it touches an adapter — read the diff, never just the green.

### If this adds or changes a **dependency**

- [ ] `npm run check:advisories` is clean, or a new advisory has a written entry
      in `scripts/advisory-triage.json` naming the vulnerable entry point and
      what calls it.
