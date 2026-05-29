/**
 * The Readout Report view (BUILD-SPEC-2 §5): an in-app preview of the
 * downloadable summary, with a one-tap download of a self-contained HTML file
 * and a print button. Everything is generated on the device from My Situation
 * — nothing is uploaded. The report itself is reproducible: the same profile and
 * dataset versions always produce the same document.
 */
import { el, clear } from "./dom";
import { triggerDownload } from "../profile/portable";
import { buildReport, renderReportHtml, type ReportModel } from "../readout/report";
import type { BundledData } from "../data/browser";
import type { SituationStore } from "../profile/situation";

export interface RenderReportOptions {
  container: HTMLElement;
  navigate: (id: string | null) => void;
  profile: SituationStore;
  data: BundledData | null;
}

function sectionEl(section: ReportModel["sections"][number]): HTMLElement {
  const children: HTMLElement[] = [
    el("h2", { class: "report-section-title", text: section.title }),
  ];
  if (section.lines.length > 0) {
    const rows = section.lines.map((l) =>
      el(
        "tr",
        { class: "bd-row" },
        el("th", { class: "bd-label", attrs: { scope: "row" }, text: l.label }),
        el("td", { class: "bd-value", text: l.value }),
      ),
    );
    children.push(el("table", { class: "breakdown-table report-table" }, el("tbody", {}, ...rows)));
  }
  if (section.note) children.push(el("p", { class: "report-note", text: section.note }));
  return el("section", { class: "report-section" }, ...children);
}

export function renderReport(opts: RenderReportOptions): void {
  const { container, navigate, profile, data } = opts;
  clear(container);
  document.title = "My Readout Report · enklayve";

  const model = buildReport(profile, data);

  const back = el(
    "button",
    { type: "button", class: "btn btn--ghost back-link", on: { click: () => navigate(null) } },
    "← Home",
  );
  const head = el(
    "div",
    { class: "tile-head" },
    back,
    el("h1", { class: "tile-title", text: "My Readout Report" }),
    el("p", {
      class: "tile-desc",
      text: `Where you stand, computed on your device from ${model.effectiveYear} data. Download a private copy or print it, nothing is uploaded.`,
    }),
  );

  const download = el("button", {
    type: "button",
    class: "btn btn--accent",
    text: "Download report (.html)",
    on: { click: () => triggerDownload("your-readout-report.html", renderReportHtml(model)) },
  });
  const print = el("button", {
    type: "button",
    class: "btn btn--ghost",
    text: "Print",
    on: {
      click: () => {
        if (typeof window.print === "function") window.print();
      },
    },
  });
  const planLink = el("button", {
    type: "button",
    class: "btn btn--ghost",
    text: "See My Plan →",
    on: { click: () => navigate("your-plan") },
  });
  const actions = el("div", { class: "report-actions" }, download, print, planLink);

  const sections = el("div", { class: "report-body" }, ...model.sections.map(sectionEl));

  // Appendix: assumptions, dataset versions, and citations (every figure traces here).
  const appendix = el(
    "section",
    { class: "report-section report-appendix" },
    el("h2", { class: "report-section-title", text: "Assumptions & sources" }),
    el(
      "table",
      { class: "breakdown-table report-table" },
      el(
        "tbody",
        {},
        ...model.appendix.assumptions.map((a) =>
          el(
            "tr",
            { class: "bd-row" },
            el("th", { class: "bd-label", attrs: { scope: "row" }, text: a.label }),
            el("td", { class: "bd-value", text: a.value }),
          ),
        ),
      ),
    ),
    el("h3", { class: "report-subhead", text: "Dataset versions used" }),
    el(
      "ul",
      { class: "report-list" },
      ...model.appendix.datasets.map((d) =>
        el("li", { text: `${d.id}, effective ${d.effectiveYear} (${d.status})` }),
      ),
    ),
    el("h3", { class: "report-subhead", text: "Citations" }),
    model.appendix.citations.length > 0
      ? el(
          "ul",
          { class: "report-list" },
          ...model.appendix.citations.map((c) =>
            el(
              "li",
              {},
              el("span", { text: `${c.sourceDocument} (${c.effectiveYear}) ` }),
              el(
                "a",
                {
                  class: "cite-link",
                  href: c.sourceUrl,
                  attrs: { rel: "noopener noreferrer", target: "_blank" },
                },
                "source",
              ),
            ),
          ),
        )
      : el("p", { class: "report-note", text: "Citations appear once your snapshot is computed." }),
  );

  container.append(el("article", { class: "tile report" }, head, actions, sections, appendix));
}
