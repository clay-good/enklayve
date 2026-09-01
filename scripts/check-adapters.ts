/**
 * The adapter-anchoring check.
 *
 * Each refresh adapter (scripts/refresh/adapters.ts) fetches one page and
 * regexes the figure it is responsible for out of it. That only works while the
 * page still *says* the figure in the shape the parser expects. Agencies move
 * numbers into PDFs, behind client-side rendering, or onto a different page
 * entirely, and when that happens the adapter stops anchoring anything.
 *
 * The failure is quiet in the worst way. A refresh that cannot parse opens a
 * fail-safe alert PR rather than a data PR — correct behaviour, and the shard
 * keeps its last-good values — but the *shard stops being watched*. It then sits
 * at whatever year it was authored in while its citation still points at a live
 * .gov page, which is a wrong number wearing a correct citation. The 2026-08-29
 * source audit found exactly that in Illinois, Michigan, Missouri and Georgia:
 * four shards a year or two stale behind adapters that could no longer read
 * their own sources.
 *
 * So this runs every adapter's parser against its live source and reports which
 * ones can still anchor. It is a *dry run*: nothing is written and no shard is
 * changed.
 *
 * **"Anchored" does not mean "correct."** It means the parser found something
 * shaped like its figure. Pointing Maine's standard-deduction adapter at the
 * 2026 Form 1040ES, which does state the deduction, made it "anchor" $49,824 for
 * single and $5,300 for married jointly — a bracket threshold and the personal
 * exemption, scraped off a document dense with other numbers. It reported as
 * anchored. Nothing downstream would have shipped those (the refresh only
 * proposes a PR, the golden suite gates it, and a person reviews), but a green
 * line here is a statement about reachability and phrasing, never about values.
 * Anchoring the WRONG figure is worse than anchoring none, so repointing an
 * adapter means dry-running it and reading the diff, not watching this go green.
 *
 * Like check-links, it runs on a schedule and on demand, never in the unit
 * suite: it needs the network, and a test that fails when a state's website has
 * a bad afternoon teaches people to ignore failing tests.
 *
 *   npm run check:adapters
 *   npm run check:adapters -- --group state-il
 */
import { readFileSync, appendFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADAPTERS,
  adaptersForGroup,
  type RefreshAdapter,
  type RefreshGroup,
} from "./refresh/adapters.ts";
import { fetchSource, sourceExists, INCOMPLETE_CERT_CHAIN } from "./fetch-source.ts";
import { diffShards } from "./refresh/contract.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(ROOT, "data");
const CONCURRENCY = 6;
const BASELINE_FILE = join(ROOT, "scripts", "refresh", "adapter-baseline.json");

/**
 * Why an adapter could not anchor — or, when it did, whether it agrees with the
 * shard it is watching.
 *
 * `agrees` is the healthy steady state: the parser found its figure and the
 * figure is the one already committed. `wouldChange` is not a failure — a real
 * refresh proposes changes, and that is the point of the pipeline — but it IS
 * the thing worth reading, because a change is either a state updating its
 * figures or a parser reading the wrong number, and the diff is what tells them
 * apart. On 2026-08-29 that distinction found nine of the second kind.
 */
/**
 * `settled` is a refusal that is a considered decision rather than a defect:
 * Delaware's deduction is statutory and has not moved since 2000, six states
 * have not published the shard's year, Connecticut has no standard deduction at
 * all. Every one of those used to print the same sentence a genuinely broken
 * parser prints, and a reader who opens a report and finds six entries needing
 * nothing does not open the seventh.
 */
export type AnchorStatus = "agrees" | "wouldChange" | "unparsed" | "settled" | "unreachable";

export interface AnchorResult {
  adapterId: string;
  group: string;
  url: string;
  status: AnchorStatus;
  detail?: string;
  /** For `wouldChange`, the `path: old -> new` lines the refresh would write. */
  diff?: string[];
}

/**
 * Classify one adapter's outcome. `unreachable` means the page did not come
 * back at all — a network or HTTP problem, which may be transient and is not
 * the adapter's fault. `unparsed` means the page came back and the parser could
 * not find its figure, which is the condition worth acting on: the source moved
 * and the shard is no longer being watched.
 *
 * A parser may also report that the source answered *and declined to serve* —
 * a quota, a rate limit, a challenge page dressed as a 200. That is the first
 * kind of failure wearing the second's clothes, so it counts as unreachable:
 * nothing about the adapter is broken and nothing about it needs fixing. The
 * BLS CPI API is the standing example, and it is why the distinction exists.
 */
export function classifyAnchor(
  fetched: { ok: true; raw: string } | { ok: false; reason: string },
  parse: () =>
    | { ok: true; diff: string[] }
    | { ok: false; reason: string; denied?: boolean; settled?: boolean },
): { status: AnchorStatus; detail?: string; diff?: string[] } {
  if (!fetched.ok) return { status: "unreachable", detail: fetched.reason };
  const parsed = parse();
  if (!parsed.ok) {
    if (parsed.denied) return { status: "unreachable", detail: parsed.reason };
    return { status: parsed.settled ? "settled" : "unparsed", detail: parsed.reason };
  }
  if (parsed.diff.length === 0) return { status: "agrees" };
  return { status: "wouldChange", diff: parsed.diff };
}

/**
 * Of the sources that did not come back, which ones will still not come back
 * next month?
 *
 * "Unreachable" is reported and not gated because it is usually weather: an
 * agency's bad afternoon, a keyless API's spent daily quota. Both clear by
 * themselves. A server that does not serve a complete certificate chain does
 * not: Node's `fetch` will refuse it every run forever, so the shard behind it
 * has stopped being watched permanently while the report says to wait. That is
 * the failure this whole check exists to catch — a shard sitting at whatever
 * year it was authored in behind a citation that still looks live — filed as
 * something that fixes itself. Mississippi sat there.
 *
 * It still does not fail the check: it fails every run by definition, and an
 * alarm that always fires is not an alarm. It is separated so a reader can see
 * that one of these two entries wants a decision and the other wants a week.
 */
export function willNotClearOnItsOwn(detail: string | undefined): boolean {
  return detail !== undefined && INCOMPLETE_CERT_CHAIN.test(detail);
}

/**
 * Split the adapters that cannot anchor into the ones already known not to and
 * the ones that just stopped.
 *
 * An adapter that was never *reached* belongs to neither group, and conflating
 * it with the second was a real defect: `unreachable` is documented as "usually
 * the agency's afternoon, not our defect" and reported without gating, but a
 * watched adapter that flaked still fell out of the anchoring set and was filed
 * under "Stopped anchoring" — the loudest thing this check says, the one that
 * exits non-zero and opens an issue claiming a shard has gone unwatched.
 * Pennsylvania did exactly that on 2026-08-30 under six-way concurrency and
 * anchored fine on its own a minute later. A check that cries wolf about the
 * failure it exists to catch is worse than no check, so a run that did not
 * reach an adapter now says so instead of guessing.
 *
 * More than forty adapters cannot read their sources today. Reporting that every
 * month, in full, would be an alert nobody reads by the third time — the exact
 * failure the shell-size gate was written to escape ("a warning that always
 * fires is not a warning"). So the backlog is committed, and only a NEW breakage
 * fails the check.
 *
 * The other direction matters too: an id that has disappeared from the baseline
 * is an adapter someone fixed, and saying so is how the list gets shorter.
 */
export function againstBaseline(
  anchored: readonly string[],
  baseline: readonly string[],
  unreached: readonly string[] = [],
): { regressions: string[]; recovered: string[]; unchecked: string[] } {
  const nowAnchored = new Set(anchored);
  const known = new Set(baseline);
  const missed = new Set(unreached);
  return {
    // An adapter that was watching its shard and has stopped. This is the only
    // thing that fails the check.
    regressions: baseline.filter((id) => !nowAnchored.has(id) && !missed.has(id)).sort(),
    // An adapter anchoring that the baseline does not list yet. Not a failure —
    // it wants a dry run first, since anchoring is not correctness — but worth
    // saying, because this is how the healthy list grows.
    recovered: anchored.filter((id) => !known.has(id)).sort(),
    // On the watched list and never reached, so this run has no opinion about
    // it either way. Reported, never gated.
    unchecked: baseline.filter((id) => missed.has(id)).sort(),
  };
}

/** Group results into the report the workflow posts and a human reads. */
/**
 * Whether an adapter's wait is over.
 *
 * Eleven adapters refuse because a state has not published the shard's year.
 * Seven of those clear themselves: the parser runs against the watched page
 * first, so the day the page states the figure, it anchors and the refusal stops
 * being printed with nobody having to remember. Four cannot, because the
 * document they are waiting for lives at a *different URL* — Oregon's OR-40
 * booklet, Nebraska's Tax Calculation Schedule, Arkansas's year of forms,
 * Vermont's rate schedules — and the menu page each adapter watches will never
 * state a deduction no matter what the state releases. Their notes all end
 * "repoint this adapter the day the 2026 forms appear", and until now the only
 * thing standing behind that sentence was somebody's memory.
 *
 * `blind` is the verdict that makes the other two worth reading. A probe aimed
 * at a URL pattern a state can rename at will would go on reporting "still
 * waiting" forever, in exactly the words it uses when the wait is real, so each
 * probe is also aimed at the year that IS published and has to hit.
 *
 * Note the asymmetry: a hit on the awaited document is believed even when the
 * calibration misses. Calibration exists to catch a false NEGATIVE — a wait that
 * has quietly become permanent — and a probe that has found the thing it was
 * looking for has no false negative to catch.
 */
export type WaitVerdict = "waiting" | "arrived" | "blind";

export interface WaitResult {
  adapterId: string;
  /** What is being waited for, in a sentence someone can act on. */
  what: string;
  verdict: WaitVerdict;
  /** Where the awaited document would be. */
  url: string;
}

export function classifyWait(arrived: boolean, calibrated: boolean): WaitVerdict {
  if (arrived) return "arrived";
  return calibrated ? "waiting" : "blind";
}

/**
 * Render the waits. Anything other than "still waiting" is work, so it is
 * separated from the Settled list rather than filed inside it: a settled
 * refusal is a decision needing nothing, and these two are the moments a
 * decision stops being true.
 */
export function renderWaitReport(waits: readonly WaitResult[]): string {
  if (waits.length === 0) return "";
  const arrived = waits.filter((w) => w.verdict === "arrived");
  const blind = waits.filter((w) => w.verdict === "blind");
  const waiting = waits.filter((w) => w.verdict === "waiting");
  const lines: string[] = [];

  if (arrived.length > 0) {
    lines.push("", "## The wait is over", "");
    lines.push(
      "The document these adapters were parked on has been published. Each shard is now" +
        " knowably a year behind its source, behind a citation that still points at a live" +
        " .gov page. Repoint the adapter, dry-run it, and read the diff — an arrival is not" +
        " permission to scrape, and anchoring the wrong figure is worse than anchoring none." +
        " This fails the check.",
    );
    lines.push("");
    for (const w of arrived) lines.push(`- \`${w.adapterId}\` — ${w.what}`, `  - ${w.url}`);
  }

  if (blind.length > 0) {
    lines.push("", "## A wait nobody is watching", "");
    lines.push(
      "These probes cannot see the year the state HAS published, so they cannot be trusted" +
        " to notice the year it has not. The state has renamed or moved something and the" +
        " probe now reports patience it has not earned — which is the same failure as an" +
        " adapter that has stopped anchoring, one level up. This fails the check.",
    );
    lines.push("");
    for (const w of blind) lines.push(`- \`${w.adapterId}\` — ${w.what}`, `  - ${w.url}`);
  }

  if (waiting.length > 0) {
    lines.push("", "## Still waiting", "");
    lines.push(
      "Parked on a document the state has not published, and the probe proved this run that" +
        " it can see the year that is published. Nothing to do.",
    );
    lines.push("");
    for (const w of waiting) lines.push(`- \`${w.adapterId}\` — ${w.what}`);
  }
  return lines.join("\n");
}

export function renderAnchorReport(
  results: readonly AnchorResult[],
  baseline: readonly string[] = [],
): string {
  const by = (s: AnchorStatus): AnchorResult[] => results.filter((r) => r.status === s);
  const agrees = by("agrees");
  const wouldChange = by("wouldChange");
  const unparsed = by("unparsed");
  const settled = by("settled");
  const unreachable = by("unreachable");
  const walled = unreachable.filter((r) => willNotClearOnItsOwn(r.detail));
  const transient = unreachable.filter((r) => !willNotClearOnItsOwn(r.detail));

  const lines: string[] = [];
  lines.push(`Checked ${results.length} refresh adapters.`);
  lines.push(
    "Anchoring means the parser found something shaped like its figure — never that the" +
      " value is right. The diffs below are the only thing that answers that.",
  );

  if (wouldChange.length > 0) {
    lines.push("");
    lines.push("## Would change its shard");
    lines.push("");
    lines.push(
      "Read every line. A change is either a state that updated its figures — which is" +
        " what this pipeline is for, and the refresh workflow will open the PR — or a parser" +
        " reading the wrong number off the page. Nine of these turned out to be the second" +
        " kind the first time anyone looked, including a standard deduction that anchored a" +
        " year off the page as if it were dollars.",
    );
    lines.push("");
    for (const r of wouldChange) {
      lines.push(`- \`${r.adapterId}\` (${r.group})`);
      lines.push(`  - ${r.url}`);
      for (const line of r.diff ?? []) lines.push(`  - \`${line}\``);
    }
  }
  lines.push(
    `${agrees.length} agree with their shard · ${wouldChange.length} would change it · ` +
      `${unparsed.length} could not parse · ${settled.length} settled · ` +
      `${unreachable.length} unreachable` +
      // Saying how many of those will fail again next month is the difference
      // between a number to skim and a number to act on.
      `${walled.length > 0 ? ` (${walled.length} of them permanently)` : ""}.`,
  );

  const { regressions, recovered, unchecked } = againstBaseline(
    [...agrees, ...wouldChange].map((r) => r.adapterId),
    baseline,
    unreachable.map((r) => r.adapterId),
  );
  if (unchecked.length > 0) {
    lines.push("");
    lines.push("## On the watched list and not reached");
    lines.push("");
    lines.push(
      "These are adapters the baseline says were watching their shard, and this run never" +
        " got an answer from their source — so it has no opinion about whether they still" +
        " anchor, and does not claim one. Read the unreachable entry below for the reason." +
        " A single dropped connection means nothing; the same adapter here two months" +
        " running means its source has gone away and its shard is no longer watched.",
    );
    lines.push("");
    for (const id of unchecked) lines.push(`- \`${id}\``);
  }
  if (recovered.length > 0) {
    lines.push("");
    lines.push("## Anchoring again");
    lines.push("");
    lines.push(
      "These anchor and the baseline does not list them yet. Dry-run each one and read" +
        " the diff (`node scripts/refresh/run.ts --adapter <id> --dry-run`); if it writes the" +
        " right values, add it to scripts/refresh/adapter-baseline.json so a future break" +
        " fails the check.",
    );
    lines.push("");
    for (const id of recovered) lines.push(`- \`${id}\``);
  }
  if (regressions.length > 0) {
    lines.push("");
    lines.push("## Stopped anchoring");
    lines.push("");
    lines.push(
      "These are on the known-anchoring list and are not anchoring now. Each one is a shard" +
        " that has stopped being watched, which is how four of them went a year or two stale" +
        " behind live, correct-looking citations. This is what fails the check.",
    );
    lines.push("");
    for (const id of regressions) {
      const r = results.find((x) => x.adapterId === id);
      lines.push(`- \`${id}\` — ${r?.url ?? ""}`);
      lines.push(`  - ${r?.detail ?? "not reported this run"}`);
    }
  }

  if (settled.length > 0) {
    lines.push("");
    lines.push("## Settled");
    lines.push("");
    lines.push(
      "These refuse on purpose, and none of them wants fixing. A figure that is statutory" +
        " and has not moved in twenty-five years, a state that has not published the shard's" +
        " year, a page whose numbers mean something else — each is a decision with a reason" +
        " attached, and each clears itself when the reason stops being true. They are listed" +
        " apart from the section below because a reader who opens a report and finds six" +
        " entries needing nothing does not open the seventh.",
    );
    lines.push("");
    for (const r of settled) {
      lines.push(`- \`${r.adapterId}\` (${r.group})`);
      lines.push(`  - ${r.url}`);
      lines.push(`  - ${r.detail ?? "no reason given"}`);
    }
  }

  if (unparsed.length > 0) {
    lines.push("");
    lines.push("## Could not anchor");
    lines.push("");
    lines.push(
      "The page came back but the parser could not find its figure. The source has moved" +
        " — into a PDF, behind client-side rendering, or onto another page — so this shard is" +
        " no longer being watched and will sit at whatever year it was authored in. Point the" +
        " adapter at a page that states the number, or convert it to a change-watch and record" +
        " the shard's figures as a reviewer step.",
    );
    lines.push("");
    for (const r of unparsed) {
      lines.push(`- \`${r.adapterId}\` (${r.group})`);
      lines.push(`  - ${r.url}`);
      lines.push(`  - ${r.detail ?? "no reason given"}`);
    }
  }

  if (walled.length > 0) {
    lines.push("");
    lines.push("## Unreachable, and not by accident");
    lines.push("");
    lines.push(
      "The server did not serve a complete certificate chain. A browser and curl repair" +
        " that by fetching the missing intermediate; Node does not, so this fetch will fail" +
        " identically every month. Waiting is not a plan: the shard behind it has stopped" +
        " being watched for good, and will sit at whatever year it was authored in behind a" +
        " citation that still looks live. Repoint the adapter at a host that serves its" +
        " chain, or record the shard as a reviewer step so somebody reads the source.",
    );
    lines.push("");
    for (const r of walled) {
      lines.push(`- \`${r.adapterId}\` (${r.group})`);
      lines.push(`  - ${r.url}`);
      lines.push(`  - ${r.detail ?? "no reason given"}`);
    }
  }

  if (transient.length > 0) {
    lines.push("");
    lines.push("## Unreachable");
    lines.push("");
    lines.push(
      "The page did not come back, or came back declining to serve — a quota, a rate limit," +
        " a challenge page dressed as a 200. This may be transient, and a government site" +
        " having a bad afternoon is not an adapter defect, so it is reported separately and" +
        " does not fail the check on its own.",
    );
    lines.push("");
    for (const r of transient) {
      lines.push(`- \`${r.adapterId}\` (${r.group})`);
      lines.push(`  - ${r.url}`);
      lines.push(`  - ${r.detail ?? "no reason given"}`);
    }
  }

  return lines.join("\n");
}

/* c8 ignore start -- network + CLI */

/**
 * Fetch, and on a transport failure fetch once more.
 *
 * A government site dropping a single connection is common and means nothing —
 * the link check has retried once for exactly this reason since it was written.
 * The stakes are higher here: fifty-one sources go out six at a time, and a
 * dropped connection to a *watched* adapter used to read as "this shard has
 * stopped being watched". An HTTP status is not retried, because a 404 is an
 * answer, and neither is a page that came back and failed to parse.
 */
async function fetchTwice(url: string): Promise<Awaited<ReturnType<typeof fetchSource>>> {
  const first = await fetchSource(url);
  if (first.ok || !first.reason.startsWith("fetch failed")) return first;
  return fetchSource(url);
}

async function check(adapter: RefreshAdapter): Promise<AnchorResult> {
  const current = JSON.parse(readFileSync(join(DATA_DIR, `${adapter.id}.json`), "utf8")) as Record<
    string,
    unknown
  >;
  const fetched = await fetchTwice(adapter.sourceUrl);
  const { status, detail, diff } = classifyAnchor(fetched, () => {
    if (!fetched.ok) return { ok: false, reason: fetched.reason };
    try {
      const outcome = adapter.parse(fetched.raw, current);
      if (!outcome.ok)
        return {
          ok: false,
          reason: outcome.reason,
          denied: outcome.denied,
          settled: outcome.settled,
        };
      return { ok: true, diff: diffShards(current, outcome.shard).lines };
    } catch (error) {
      return { ok: false, reason: `parser threw: ${(error as Error).message}` };
    }
  });
  return {
    adapterId: adapter.id,
    group: adapter.group,
    url: adapter.sourceUrl,
    status,
    detail,
    diff,
  };
}

/** One half of a wait probe: is the document there, and does it look like itself? */
async function probe(target: { url: string; match?: RegExp }): Promise<boolean> {
  if (!target.match) return sourceExists(target.url);
  const fetched = await fetchSource(target.url);
  return fetched.ok && target.match.test(fetched.raw);
}

async function checkWait(adapter: RefreshAdapter): Promise<WaitResult | null> {
  const awaiting = adapter.awaiting;
  if (!awaiting) return null;
  const arrived = await probe(awaiting.arrived);
  // Skipped when the document is already there: the calibration only guards the
  // "still waiting" answer, and a second fetch to confirm a hit costs a request
  // against an agency for nothing.
  const calibrated = arrived || (await probe(awaiting.calibration));
  return {
    adapterId: adapter.id,
    what: awaiting.what,
    verdict: classifyWait(arrived, calibrated),
    url: awaiting.arrived.url,
  };
}

async function main(): Promise<void> {
  const groupIdx = process.argv.indexOf("--group");
  const adapters =
    groupIdx === -1 ? [...ADAPTERS] : adaptersForGroup(process.argv[groupIdx + 1] as RefreshGroup);
  if (adapters.length === 0) throw new Error("no adapters selected");

  const results: AnchorResult[] = [];
  let next = 0;
  async function worker(): Promise<void> {
    while (next < adapters.length) {
      results.push(await check(adapters[next++]!));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  results.sort((a, b) => a.adapterId.localeCompare(b.adapterId));

  // Scoped to what this run actually checked. `--group cpi` checks one adapter,
  // and comparing that against the whole baseline reported the other eight as
  // regressions — a red exit code every time anyone debugged a single group,
  // which is the fastest way to teach someone that red means nothing.
  const checked = new Set(results.map((r) => r.adapterId));
  const baseline = (
    JSON.parse(readFileSync(BASELINE_FILE, "utf8")) as { knownAnchoring: string[] }
  ).knownAnchoring.filter((id) => checked.has(id));
  const waits = (await Promise.all(adapters.map(checkWait))).filter(
    (w): w is WaitResult => w !== null,
  );
  waits.sort((a, b) => a.adapterId.localeCompare(b.adapterId));
  const report = `${renderAnchorReport(results, baseline)}\n${renderWaitReport(waits)}`;
  process.stdout.write(`${report}\n`);

  const out = process.env.GITHUB_OUTPUT;
  if (out) {
    const { regressions } = againstBaseline(
      results
        .filter((r) => r.status === "agrees" || r.status === "wouldChange")
        .map((r) => r.adapterId),
      baseline,
      results.filter((r) => r.status === "unreachable").map((r) => r.adapterId),
    );
    const wouldChange = results.filter((r) => r.status === "wouldChange").length;
    const unreachable = results.filter((r) => r.status === "unreachable").length;
    appendFileSync(
      out,
      `regressions=${regressions.length}\nwouldChange=${wouldChange}\nunreachable=${unreachable}\n` +
        `waitsOver=${waits.filter((w) => w.verdict === "arrived").length}\n` +
        `blindWaits=${waits.filter((w) => w.verdict === "blind").length}\n`,
    );
    appendFileSync(out, `report<<EOF\n${report}\nEOF\n`);
  }
  // Only a NEW breakage fails. The known refusals are a backlog, not a monthly
  // alarm, and an alarm that always fires is not an alarm. Unreachable is
  // reported and left alone — usually the agency's afternoon, not our defect —
  // and that now holds for a WATCHED adapter too, which is where it used to
  // fail: a flake dropped it out of the anchoring set and it was reported as a
  // shard that had stopped being watched.
  const { regressions } = againstBaseline(
    results
      .filter((r) => r.status === "agrees" || r.status === "wouldChange")
      .map((r) => r.adapterId),
    baseline,
    results.filter((r) => r.status === "unreachable").map((r) => r.adapterId),
  );
  // A wait that is over, or a probe that has gone blind, is work in exactly the
  // way a regression is: a shard that has stopped being watched and does not
  // look it. Both fail; "still waiting" does not.
  const openWaits = waits.filter((w) => w.verdict !== "waiting");
  if (regressions.length > 0 || openWaits.length > 0) process.exitCode = 1;
}

if (process.argv[1] && process.argv[1].endsWith("check-adapters.ts")) {
  await main();
}
/* c8 ignore stop */
