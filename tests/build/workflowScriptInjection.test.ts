import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * No workflow builds JavaScript by pasting a value into it.
 *
 * `actions/github-script` takes a `script:` block that GitHub evaluates as
 * JavaScript. A `${{ ... }}` inside it is substituted *before* evaluation, so
 * the value becomes part of the program rather than data the program reads.
 * Two things follow, and the second is the one that bites first:
 *
 *   A value containing a backtick, a quote or a newline ends the literal it
 *   landed in and the step dies with a syntax error — on exactly the run that
 *   had something to report, since a healthy run skips the step. The
 *   check-live report is full of markdown code spans; it would have failed the
 *   first time production went wrong, which is the one time it matters.
 *
 *   And a value an outsider can influence is then code. Nothing here reads an
 *   issue title or a branch name today, but the shape is the shape, and it is
 *   the best-known injection in GitHub Actions.
 *
 * `check-links` had it right first: pass through `env:` and read
 * `process.env.X`, where the value is a string no matter what is in it. This
 * sweeps every workflow so the next one written cannot be the exception.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = join(ROOT, ".github", "workflows");

/** The `script:` block bodies in one workflow, with their line offsets. */
function scriptBlocks(text: string): { body: string; line: number }[] {
  const lines = text.split("\n");
  const blocks: { body: string; line: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)script:\s*\|/.exec(lines[i]!);
    if (!m) continue;
    const indent = m[1]!.length;
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]!;
      const blank = line.trim() === "";
      const deeper = line.search(/\S/) > indent;
      if (!blank && !deeper) break;
      body.push(line);
    }
    blocks.push({ body: body.join("\n"), line: i + 1 });
  }
  return blocks;
}

const workflows = readdirSync(DIR)
  .filter((f) => f.endsWith(".yml"))
  .sort();

describe("workflow scripts read values, they do not embed them", () => {
  it("finds the workflows and the script blocks, so an empty sweep cannot pass", () => {
    expect(workflows.length).toBeGreaterThan(5);
    const total = workflows.reduce(
      (n, f) => n + scriptBlocks(readFileSync(join(DIR, f), "utf8")).length,
      0,
    );
    expect(total).toBeGreaterThan(0);
  });

  for (const file of workflows) {
    it(`${file} interpolates nothing into a script block`, () => {
      const offenders: string[] = [];
      for (const block of scriptBlocks(readFileSync(join(DIR, file), "utf8"))) {
        for (const expr of block.body.match(/\$\{\{[^}]*\}\}/g) ?? []) {
          offenders.push(`line ~${block.line}: ${expr.trim()}`);
        }
      }
      expect(
        offenders,
        `${file} pastes a value into JavaScript. Pass it through \`env:\` and read ` +
          `\`process.env.NAME\` instead — a backtick or a quote in the value otherwise ends ` +
          `the literal and the step dies on the run that had something to say`,
      ).toEqual([]);
    });
  }
});
