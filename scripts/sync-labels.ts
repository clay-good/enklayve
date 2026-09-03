/**
 * Write `.github/labels.yml` to the repository's label set.
 *
 * A label an issue form names and the repository does not have is dropped on
 * the way in, silently — the issue is created without it, and nothing anywhere
 * says so. `wrong-figure.yml` has applied `data` since it was written and this
 * repository had no `data` label, so the first such report would have arrived
 * untagged — because the label set lived in a web UI rather than in a file
 * anybody could review.
 *
 * This makes the file the source of truth. It creates a label that is missing
 * and updates one whose color or description has drifted; it never deletes.
 * A label somebody made by hand in the middle of a triage is not an error, and
 * losing it on the next push to `main` would be.
 *
 * Runs in CI on a push that touches the file, and on demand. Locally it needs
 * `gh` authenticated; `--dry-run` prints what it would do and calls nothing.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { load } from "js-yaml";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface Label {
  name: string;
  color: string;
  description: string;
}

/** The labels this repository declares, in the order the file lists them. */
export function declaredLabels(source: string): Label[] {
  const doc = load(source) as { labels?: unknown };
  const labels = doc?.labels;
  if (!Array.isArray(labels)) throw new Error("labels.yml has no `labels:` list");
  return labels.map((entry, i) => {
    const { name, color, description } = (entry ?? {}) as Partial<Label>;
    if (!name || !color || !description) {
      throw new Error(`labels.yml entry ${i} needs a name, a color, and a description`);
    }
    return { name, color, description };
  });
}

export function labelsFile(): Label[] {
  return declaredLabels(readFileSync(resolve(ROOT, ".github", "labels.yml"), "utf8"));
}

function main(): void {
  const dryRun = process.argv.includes("--dry-run");
  const labels = labelsFile();
  for (const { name, color, description } of labels) {
    // `--force` is create-or-update: the one call covers a label that is
    // missing and one whose color has drifted, with no read to race against.
    const args = [
      "label",
      "create",
      name,
      "--color",
      color,
      "--description",
      description,
      "--force",
    ];
    if (dryRun) {
      console.log(`would run: gh ${args.join(" ")}`);
      continue;
    }
    execFileSync("gh", args, { stdio: "inherit" });
  }
  console.log(`${dryRun ? "Would sync" : "Synced"} ${labels.length} labels.`);
}

// Run only as a CLI, not when imported by tests -- the same guard the release
// audit uses; `import.meta.main` is not available on the Node this targets.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
