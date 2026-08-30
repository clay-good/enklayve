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
import { fetchSource, INCOMPLETE_CERT_CHAIN } from "./fetch-source.ts";
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
): { regressions: string[]; recovered: string[] } {
  const nowAnchored = new Set(anchored);
  const known = new Set(baseline);
  return {
    // An adapter that was watching its shard and has stopped. This is the only
    // thing that fails the check.
    regressions: baseline.filter((id) => !nowAnchored.has(id)).sort(),
    // An adapter anchoring that the baseline does not list yet. Not a failure —
    // it wants a dry run first, since anchoring is not correctness — but worth
    // saying, because this is how the healthy list grows.
    recovered: anchored.filter((id) => !known.has(id)).sort(),
  };
}

/** Group results into the report the workflow posts and a human reads. */
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

  const { regressions, recovered } = againstBaseline(
    [...agrees, ...wouldChange].map((r) => r.adapterId),
    baseline,
  );
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

async function check(adapter: RefreshAdapter): Promise<AnchorResult> {
  const current = JSON.parse(readFileSync(join(DATA_DIR, `${adapter.id}.json`), "utf8")) as Record<
    string,
    unknown
  >;
  const fetched = await fetchSource(adapter.sourceUrl);
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
  const report = renderAnchorReport(results, baseline);
  process.stdout.write(`${report}\n`);

  const out = process.env.GITHUB_OUTPUT;
  if (out) {
    const { regressions } = againstBaseline(
      results
        .filter((r) => r.status === "agrees" || r.status === "wouldChange")
        .map((r) => r.adapterId),
      baseline,
    );
    const wouldChange = results.filter((r) => r.status === "wouldChange").length;
    const unreachable = results.filter((r) => r.status === "unreachable").length;
    appendFileSync(
      out,
      `regressions=${regressions.length}\nwouldChange=${wouldChange}\nunreachable=${unreachable}\n`,
    );
    appendFileSync(out, `report<<EOF\n${report}\nEOF\n`);
  }
  // Only a NEW breakage fails. The forty-odd known ones are a backlog, not a
  // monthly alarm, and an alarm that always fires is not an alarm. Unreachable
  // is reported and left alone: usually the agency's afternoon, not our defect.
  const { regressions } = againstBaseline(
    results
      .filter((r) => r.status === "agrees" || r.status === "wouldChange")
      .map((r) => r.adapterId),
    baseline,
  );
  if (regressions.length > 0) process.exitCode = 1;
}

if (process.argv[1] && process.argv[1].endsWith("check-adapters.ts")) {
  await main();
}
/* c8 ignore stop */
