import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { load } from "js-yaml";
import { SUB_TOOLS } from "../../src/tiles/registry";
import { declaredLabels } from "../../scripts/sync-labels";

/**
 * The public on-ramp works, and every claim it makes is checked.
 *
 * An issue template is the first thing a stranger touches, and everything about
 * it fails quietly. A form whose YAML does not parse is not reported as broken:
 * GitHub simply leaves it out of the chooser, so the most valuable report this
 * project can get has no path and nobody finds out. A label the form names and
 * the repository does not have is dropped on the way in the same way — the
 * issue is created, the triage signal is not.
 *
 * That second one had already happened, twice. `wrong-figure.yml` has applied
 * `data` since it was written and the repository had no `data` label, because
 * the label set lived in a web UI, which nothing here could see, review, or
 * diff: the same shape as the token scope moved into the repo on 2026-09-02,
 * one file over. `.github/labels.yml` now holds the set.
 *
 * The second was worse, and was found only because the first version of this
 * file swept `ISSUE_TEMPLATE/` and stopped there. "The issue forms" is not the
 * same set as "the things that create issues": the four scheduled checks that
 * watch for source rot — links, adapters, advisories, the Pillar 4 sources —
 * each open an issue labelled `data-review`, and the repository had no such
 * label either. Those run monthly and quarterly with nobody watching, which is
 * the entire reason they exist. The sweep now reads every file under `.github`.
 *
 * The third thing checked here is a privacy defect rather than a rot one. Every
 * result on this site is deep-linkable, which means a permalink encodes what
 * the reader typed — their income, their balances. `wrong-figure.yml` asked for
 * "the deep link if you have one" and *demonstrated* one carrying `w=85000`, on
 * a public, permanent issue tracker, in the one product whose whole promise is
 * that its figures never leave the device. Both templates now warn in the field
 * that asks, and no placeholder carries a figure.
 */
const ROOT = resolve(__dirname, "..", "..");
const DIR = resolve(ROOT, ".github", "ISSUE_TEMPLATE");
const FILES = readdirSync(DIR)
  .filter((f) => f.endsWith(".yml") && f !== "config.yml")
  .sort();

const LABELS = declaredLabels(readFileSync(resolve(ROOT, ".github", "labels.yml"), "utf8"));
const DECLARED = new Set(LABELS.map((l) => l.name));

/** Every markdown file in the repo, skipping what is generated or vendored. */
function markdownFiles(dir: string): string[] {
  const SKIP = ["node_modules", ".git", "dist", "playwright-report", "test-results", "openspec"];
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.includes(name)) return [];
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return markdownFiles(p);
    return name.endsWith(".md") ? [p] : [];
  });
}

/** Every file under `.github`, which is every place a label can be named. */
function githubFiles(dir = resolve(ROOT, ".github")): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? githubFiles(p) : [p];
  });
}

/**
 * Labels named by a `labels:` list anywhere under `.github`, by file.
 *
 * The issue forms use YAML's `labels: ["bug"]`; the scheduled checks use the
 * same flow-sequence inside a `github-script` body that creates an issue. One
 * pattern reads both, which is the point — sweeping only the templates is how
 * `data-review` stayed broken in four workflows while the forms were fixed.
 */
export function labelsNamedIn(source: string): string[] {
  return [...source.matchAll(/labels:\s*\[([^\]]*)\]/g)].flatMap((m) =>
    m[1]!
      .split(",")
      .map((raw) => raw.trim().replace(/^["']|["']$/g, ""))
      .filter((name) => name.length > 0 && !name.includes("$")),
  );
}

interface Field {
  type?: string;
  id?: string;
  attributes?: { label?: string; value?: string; options?: unknown[]; placeholder?: string };
  validations?: { required?: boolean };
}
interface Form {
  name?: string;
  description?: string;
  labels?: string[];
  body?: Field[];
}

const forms = new Map<string, Form>(
  FILES.map((f) => [f, load(readFileSync(resolve(DIR, f), "utf8")) as Form]),
);

/** Every string anywhere in a parsed form, for the sweeps that read prose. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

describe("there is a template for the report this project most wants", () => {
  it("finds the templates", () => {
    // A directory that has quietly emptied would otherwise turn every test
    // below into a vacuous pass.
    expect(FILES.length).toBeGreaterThanOrEqual(2);
  });

  it("SECURITY.md sends a wrong number to a public issue, and a form is waiting", () => {
    const security = readFileSync(resolve(ROOT, "SECURITY.md"), "utf8");
    expect(security).toMatch(/A wrong number is not a security issue/);
    const names = [...forms.values()].map((f) => f.name ?? "");
    expect(names.some((n) => /figure|number/i.test(n))).toBe(true);
  });

  it("and one for behaviour, which is not the same report", () => {
    const names = [...forms.values()].map((f) => f.name ?? "");
    expect(names.some((n) => /broken/i.test(n))).toBe(true);
  });
});

describe("every issue form is one GitHub will actually show", () => {
  const TYPES = new Set(["markdown", "input", "textarea", "dropdown", "checkboxes"]);

  for (const file of FILES) {
    describe(file, () => {
      const form = forms.get(file)!;

      it("declares a name, a description, and a body", () => {
        expect(form.name, "a form with no name is not offered").toBeTruthy();
        expect(form.description).toBeTruthy();
        expect(Array.isArray(form.body)).toBe(true);
        expect(form.body!.length).toBeGreaterThan(0);
      });

      it("uses only field types the schema defines", () => {
        for (const field of form.body ?? []) expect(TYPES.has(field.type ?? "")).toBe(true);
      });

      it("gives every field that collects an answer a unique id and a label", () => {
        const ids: string[] = [];
        for (const field of form.body ?? []) {
          if (field.type === "markdown") continue;
          expect(field.id, `a ${field.type} with no id cannot be read back`).toBeTruthy();
          expect(field.attributes?.label).toBeTruthy();
          ids.push(field.id!);
        }
        expect(ids.length).toBeGreaterThan(0);
        expect(new Set(ids).size, `duplicate field ids in ${file}`).toBe(ids.length);
      });

      it("keeps its markdown blocks as prose, not as questions", () => {
        // GitHub rejects a form whose markdown block carries an id or a
        // `validations` key -- a required note is not a thing. Rejects, as in
        // does not show the form at all.
        for (const field of form.body ?? []) {
          if (field.type !== "markdown") continue;
          expect(field.attributes?.value).toBeTruthy();
          expect(field.id).toBeUndefined();
          expect(field.validations).toBeUndefined();
        }
      });

      it("gives every dropdown and checkbox something to choose", () => {
        for (const field of form.body ?? []) {
          if (field.type !== "dropdown" && field.type !== "checkboxes") continue;
          expect(field.attributes?.options?.length).toBeGreaterThan(0);
        }
      });
    });
  }
});

describe("every label a form applies exists", () => {
  it("labels.yml is well-formed: unique names, a real color, a description each", () => {
    expect(LABELS.length).toBeGreaterThan(0);
    expect(new Set(LABELS.map((l) => l.name)).size).toBe(LABELS.length);
    for (const { name, color, description } of LABELS) {
      expect(color, `${name} has color "${color}"`).toMatch(/^[0-9a-fA-F]{6}$/);
      expect(description.length, `${name} has no description`).toBeGreaterThan(0);
    }
  });

  it("declares the label the figure form applies", () => {
    // The defect this file was written for: `data` was named by the form and
    // owned by nothing.
    expect(DECLARED.has("data")).toBe(true);
  });

  it("declares the label the four scheduled checks apply to what they find", () => {
    // The same defect as `data`, one directory over and unattended: the link,
    // adapter, advisory and Pillar 4 source checks each open a `data-review`
    // issue on a schedule, and the repository had no such label either.
    expect(DECLARED.has("data-review")).toBe(true);
  });

  describe("reading the labels a file names", () => {
    it("reads a YAML sequence and a github-script call alike", () => {
      expect(labelsNamedIn('labels: ["bug"]\n')).toEqual(["bug"]);
      expect(labelsNamedIn("  labels: ['a', \"b\"],\n")).toEqual(["a", "b"]);
      expect(labelsNamedIn("labels: []")).toEqual([]);
      // An interpolated label is not a literal this can check.
      expect(labelsNamedIn('labels: ["${{ env.L }}"]')).toEqual([]);
    });
  });

  const named = githubFiles()
    .filter((p) => !p.endsWith("labels.yml"))
    .map((p) => [relative(ROOT, p), labelsNamedIn(readFileSync(p, "utf8"))] as const)
    .filter(([, labels]) => labels.length > 0);

  it("finds the files that name a label", () => {
    // Templates and workflows both. A sweep that had quietly stopped matching
    // would otherwise pass by finding nothing to check.
    expect(named.length).toBeGreaterThanOrEqual(5);
  });

  for (const [file, labels] of named) {
    it(`${file} names no label that labels.yml does not declare`, () => {
      expect(labels.filter((l) => !DECLARED.has(l))).toEqual([]);
    });
  }
});

describe("no template teaches a reader to publish their own figures", () => {
  /** `#/<hub>?tool=<id>` -- a calculator is not a route. */
  const DEEP_LINK = /enklayve\.com\/#\/([\w-]+)\?([^\s)]*)/g;
  const HUBS = new Set(SUB_TOOLS.map(({ hubId }) => hubId));
  const TOOLS = new Map(SUB_TOOLS.map(({ tile, hubId }) => [tile.id, hubId]));

  for (const file of FILES) {
    const text = strings(forms.get(file)!).join("\n");
    const links = [...text.matchAll(DEEP_LINK)];

    it(`${file} warns, in the field that asks for a link, that a link carries figures`, () => {
      const asksForALink = /deep link|permalink/i.test(text);
      if (!asksForALink) return;
      expect(text).toMatch(/carries what you typed/);
    });

    it(`${file} shows no example link carrying a money figure`, () => {
      // `w=85000` in a placeholder is an instruction, whatever the prose beside
      // it says. A figure-shaped value in an example link is the defect.
      for (const [, , query] of links) {
        for (const [key, value] of new URLSearchParams(query!)) {
          expect(
            /^\d{4,}$/.test(value),
            `${file}: example link sets ${key}=${value}, a figure a reader would copy`,
          ).toBe(false);
        }
      }
    });

    it(`${file}'s example links name a hub and a tool that exist`, () => {
      for (const [, hub, query] of links) {
        expect(HUBS.has(hub!), `${file}: no hub "${hub}"`).toBe(true);
        const tool = new URLSearchParams(query!).get("tool");
        if (tool === null) continue;
        expect(TOOLS.get(tool), `${file}: tool "${tool}" is not in hub "${hub}"`).toBe(hub);
      }
    });
  }
});

/**
 * No document links a pre-filled new-issue URL.
 *
 * `issues/new?template=wrong-figure.yml` is the obvious way to point a reader
 * at a form, and GitHub answers it with a `302` to a login page for anyone not
 * signed in. `npm run check:links` treats a redirect as a failure — correctly,
 * since an agency reusing an article id is how a citation quietly starts
 * pointing somewhere else — so two of those links, added to SECURITY.md and the
 * contributing guide on 2026-09-03, were the only two redirects among 248
 * external links, and would have opened a `data-review` issue every month for
 * as long as they stood. That is the alert-that-cries-wolf failure, self-
 * inflicted one commit after fixing another instance of it.
 *
 * `issues/new/choose` redirects the same way; there is no variant that does not.
 * So the docs link `/issues`, which answers 200, and name the form to pick.
 */
describe("no document links a URL GitHub will redirect", () => {
  const files = markdownFiles(ROOT);

  it("finds the markdown to read", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const file of files) {
    it(`${relative(ROOT, file)} links no pre-filled new-issue URL`, () => {
      const text = readFileSync(file, "utf8");
      const found = [...text.matchAll(/github\.com\/[\w-]+\/[\w-]+\/issues\/new[^\s)]*/g)].map(
        (m) => m[0],
      );
      expect(found, "links the issues page and name the form instead").toEqual([]);
    });
  }
});

describe("the config's contact links agree with the docs they stand in for", () => {
  const config = load(readFileSync(resolve(DIR, "config.yml"), "utf8")) as {
    blank_issues_enabled?: boolean;
    contact_links?: { name?: string; url?: string; about?: string }[];
  };

  it("offers a private path for a security report", () => {
    const security = readFileSync(resolve(ROOT, "SECURITY.md"), "utf8");
    const repo = /(https:\/\/github\.com\/[\w-]+\/[\w-]+)\/security/.exec(security)?.[1];
    expect(repo, "SECURITY.md names no repository").toBeTruthy();
    const link = (config.contact_links ?? []).find((l) => /security|vulnerab/i.test(l.name ?? ""));
    expect(link?.url).toMatch(new RegExp(`^${repo}/security`));
  });

  it("gives every contact link a name, a url, and a reason to click it", () => {
    expect((config.contact_links ?? []).length).toBeGreaterThan(0);
    for (const link of config.contact_links ?? []) {
      expect(link.name).toBeTruthy();
      expect(link.about).toBeTruthy();
      expect(link.url).toMatch(/^https:\/\//);
    }
  });
});
