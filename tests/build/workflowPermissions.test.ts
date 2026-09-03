import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Every workflow states the token scope it runs under.
 *
 * A workflow with no `permissions:` block does not run without permissions — it
 * runs with whatever the repository's default happens to be, which is a setting
 * in a web UI that nothing in this repository can see, review, or diff. That
 * was survivable while the repository was private. It is not now: `npm ci` runs
 * install scripts from the whole dependency tree on every push and every pull
 * request, which is the widest untrusted code path this project has, and the
 * only honest answer to "what could that code do to this repository?" is one
 * written down beside it.
 *
 * Two rules, both mechanical:
 *
 * 1. **Every workflow declares one.** Silence is the answer ruled out, the same
 *    way it is for the counts a scheduled check emits.
 * 2. **A caller of a reusable workflow declares exactly what the callee does.**
 *    GitHub caps a called workflow at its caller's scope, so a caller that says
 *    nothing can silently under-grant — the reusable data-refresh job asks for
 *    `contents: write` and would get it or not depending on that same invisible
 *    setting. Exactly, not merely at least, so the 49 refresh callers cannot
 *    drift upward one file at a time either.
 */
const ROOT = resolve(__dirname, "..", "..");
const DIR = resolve(ROOT, ".github", "workflows");
const FILES = readdirSync(DIR)
  .filter((f) => f.endsWith(".yml"))
  .sort();

/** The top-level `permissions:` mapping, or null when the file declares none. */
export function declaredPermissions(source: string): Record<string, string> | null {
  const m = /^permissions:\n((?:[ \t]+\S[^\n]*\n)+)/m.exec(source);
  if (!m) return /^permissions:/m.test(source) ? {} : null;
  const out: Record<string, string> = {};
  for (const line of m[1]!.trimEnd().split("\n")) {
    const kv = /^\s+([a-z-]+):\s*(\S+)\s*$/.exec(line);
    if (kv) out[kv[1]!] = kv[2]!;
  }
  return out;
}

/** Reusable workflows in this repo that a file calls, by filename. */
function callees(source: string): string[] {
  return [...source.matchAll(/uses:\s*\.\/\.github\/workflows\/([\w.-]+\.yml)/g)].map((m) => m[1]!);
}

describe("reading a workflow's declared permissions", () => {
  it("parses a block", () => {
    expect(
      declaredPermissions("on: push\npermissions:\n  contents: read\n  issues: write\n"),
    ).toEqual({ contents: "read", issues: "write" });
  });

  it("is null when there is no block, not an empty one", () => {
    expect(declaredPermissions("on: push\njobs:\n  a:\n    runs-on: x\n")).toBeNull();
  });

  it("does not read a job-level block as the top-level one", () => {
    expect(declaredPermissions("jobs:\n  a:\n    permissions:\n      contents: read\n")).toBeNull();
  });
});

describe("every workflow states its token scope", () => {
  it("finds the workflows to check", () => {
    expect(FILES.length).toBeGreaterThan(50);
  });

  for (const file of FILES) {
    it(`${file} declares permissions`, () => {
      const perms = declaredPermissions(readFileSync(resolve(DIR, file), "utf8"));
      expect(perms === null ? `${file}: no permissions block` : file).toBe(file);
      expect(Object.keys(perms ?? {}).length).toBeGreaterThan(0);
    });
  }
});

describe("a caller grants exactly what the reusable workflow it calls declares", () => {
  const pairs = FILES.flatMap((file) => {
    const source = readFileSync(resolve(DIR, file), "utf8");
    return callees(source).map((callee) => [file, callee] as const);
  });

  it("finds the callers", () => {
    expect(pairs.length).toBe(49);
  });

  for (const [caller, callee] of pairs) {
    it(`${caller} → ${callee}`, () => {
      const mine = declaredPermissions(readFileSync(resolve(DIR, caller), "utf8"));
      const theirs = declaredPermissions(readFileSync(resolve(DIR, callee), "utf8"));
      expect(mine).toEqual(theirs);
    });
  }
});
