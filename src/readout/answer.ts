/**
 * Readout v2 — the answer layer (SPEC-4-readout-v2 §2).
 *
 * Users do not have a field-extraction problem; they have a "what does this mean
 * and what do I do" problem. This module sits *on top of* {@link ExtractionResult}
 * and turns it into the fixed four-part answer every document renders:
 *
 * 1. **What this says** — the document restated. Every figure traces to a field.
 * 2. **What looks wrong** — {@link runChecks}, each phrased as a question to ask.
 * 3. **What you may be owed** — an estimate with a citation, never a determination.
 * 4. **What to do next, by when** — free, named channels, in order.
 *
 * A section that cannot be filled is left empty with a one-line reason. Empty is
 * honest; filler is not. Nothing here persists, nothing reaches My Situation
 * (that still runs through the user's confirmation in `toSituation`), and the
 * module is pure: extractions in, an answer out.
 */
import { HOSPITAL_FAP_CITATION } from "../data/statutes";
import type { NoSurprisesData } from "../data/schemas";
import { runChecks, type CheckDefinition, type PlanParameters } from "./checks";
import type { AnswerSection, ExtractedField, ExtractionResult, ReadoutAnswer } from "./types";

/** Free, government-run or nonprofit channels. Nothing here costs a household money. */
const CHANNELS = {
  medicalBillRights: {
    label: "CMS: your rights against surprise medical bills",
    url: "https://www.cms.gov/medical-bill-rights",
  },
  hospitalFap: {
    label: "IRS: what a nonprofit hospital's financial assistance policy must contain",
    url: "https://www.irs.gov/charities-non-profits/financial-assistance-policy-and-emergency-medical-care-policy-section-501r4",
  },
  legalAid: {
    label: "Find free legal help near you",
    url: "https://www.lsc.gov/about-lsc/what-legal-aid/i-need-legal-help",
  },
  snapAgency: {
    label: "Your state's SNAP agency — the office that hears the appeal",
    url: "https://www.fna.usda.gov/snap/state-directory",
  },
  marketplaceAppeals: {
    label: "HealthCare.gov: how to appeal a Marketplace decision",
    url: "https://www.healthcare.gov/appeals/",
  },
} as const;

export interface BuildAnswerOptions {
  /** Every extraction in the session, so §5 cross-document checks can fire. */
  documents?: ExtractionResult[];
  /** Plan parameters the user supplied, for `plan-math` checks. */
  plan?: PlanParameters;
  /** The No Surprises Act scope shard. Absent leaves the rule check unrun and
   * the EOB's "what you may be owed" honestly empty. */
  noSurprises?: NoSurprisesData;
  /** Injectable registry, so a test can exercise the contract without a fixture shard. */
  registry?: CheckDefinition[];
}

/** Render one extracted value the way the document states it. */
function stated(f: ExtractedField): string {
  if (typeof f.value !== "number") return f.value;
  return f.value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

/** Pull the named fields, in the order given, skipping any that were not read. */
function restate(result: ExtractionResult, ids: string[]): ReadoutAnswer["says"] {
  const byId = new Map(result.fields.map((f) => [f.id, f]));
  return ids
    .map((id) => byId.get(id))
    .filter((f): f is ExtractedField => f !== undefined)
    .map((f) => ({ label: f.label, value: stated(f), fieldId: f.id }));
}

/** The value of one field, when it was read. */
function valueOf(result: ExtractionResult, id: string): number | string | undefined {
  return result.fields.find((f) => f.id === id)?.value;
}

/**
 * "What this says", per kind. The EOB and the benefits notice each have two or
 * three numbers that carry the meaning; an itemized bill's meaning is its total
 * and how many lines produced it. Every other kind restates every field it read,
 * which is what the Readout already showed — now inside the same shape.
 */
function saysFor(result: ExtractionResult): ReadoutAnswer["says"] {
  switch (result.kind) {
    case "eobHealth":
      return restate(result, [
        "eob-billed",
        "eob-allowed",
        "eob-plan-paid",
        "eob-patient-responsibility",
        "eob-network",
      ]);
    case "medicalBill": {
      const lines = result.fields.filter((f) => f.id.startsWith("bill-line-"));
      const says = restate(result, ["bill-total"]);
      if (lines.length > 0) {
        says.push({
          label: "Charge lines read",
          value: String(lines.length),
          fieldId: lines[0]!.id,
        });
      }
      return says;
    }
    case "benefitsNotice":
      return restate(result, [
        "notice-decision",
        "notice-program",
        "notice-effective",
        "notice-appeal-by",
        "notice-appeal-window-days",
      ]);
    default:
      return result.fields.map((f) => ({ label: f.label, value: stated(f), fieldId: f.id }));
  }
}

/**
 * "What you may be owed". Both entries are *obligations on the other party* —
 * what a nonprofit hospital must have, what a plan and provider may not do —
 * so pointing at them asserts nothing about this household. Neither carries an
 * `estimate`, because neither is a determination. The EOB entry appears only
 * when the No Surprises shard is loaded: a protection claimed without the rule
 * that grants it is exactly what §4 forbids.
 */
function owedFor(
  result: ExtractionResult,
  noSurprises: NoSurprisesData | undefined,
): ReadoutAnswer["owed"] {
  if (result.kind === "medicalBill") {
    return [
      {
        label:
          "If this bill is from a nonprofit hospital, it must have a written financial assistance policy and give you a paper copy free, on request.",
        citation: HOSPITAL_FAP_CITATION,
        tileId: "charity-care",
      },
    ];
  }
  if (result.kind === "eobHealth" && noSurprises) {
    if (valueOf(result, "eob-network") !== "out-of-network") return [];
    return [
      {
        label:
          "This claim is out-of-network. Federal law protects you from a balance bill in specific situations — emergency care, care from an out-of-network provider during a visit to an in-network hospital or surgical center, and air ambulance. Check whether yours is one of them before you pay.",
        citation: noSurprises.citation,
        tileId: "eob-checker",
      },
    ];
  }
  return [];
}

/** The appeal channel for the program the notice names. */
function appealChannel(program: string | number | undefined): { label: string; url: string } {
  if (program === "SNAP") return CHANNELS.snapAgency;
  if (program === "Marketplace / premium tax credit") return CHANNELS.marketplaceAppeals;
  // Medicaid and unemployment insurance are state-administered, and the appeal
  // route is set by the state, not by a federal page we could link. Free legal
  // aid is the channel that works in every state.
  return CHANNELS.legalAid;
}

/** "What to do next, by when", per kind. Ordered: the first line is the first move. */
function nextFor(result: ExtractionResult): ReadoutAnswer["next"] {
  switch (result.kind) {
    case "eobHealth": {
      const next: ReadoutAnswer["next"] = [
        {
          label:
            "Wait for the provider's bill and compare it against this notice before you pay anything. An EOB is not a bill.",
        },
      ];
      if (valueOf(result, "eob-network") === "out-of-network") {
        next.push({
          label:
            "This claim is marked out-of-network. Read what the federal surprise-billing protections cover before you pay the balance.",
          channel: CHANNELS.medicalBillRights,
        });
      }
      next.push({
        label:
          "Ask your plan to explain any line you do not recognize. Member services is free and the claim number on this notice is all they need.",
      });
      return next;
    }
    case "medicalBill":
      return [
        {
          label:
            "Ask the billing office for an itemized statement if this one is not itemized, and for the billing codes. Both are free to request.",
        },
        {
          label:
            "Ask about financial assistance before you arrange payment. Ask before you put a medical bill on a credit card — the policy can apply to a bill you have not paid, and a card balance is no longer a medical bill.",
          channel: CHANNELS.hospitalFap,
        },
      ];
    case "benefitsNotice": {
      const program = valueOf(result, "notice-program");
      const next: ReadoutAnswer["next"] = [
        {
          label:
            "Keep this notice. It is the document an appeal turns on, and the reason code on it is how the agency looks the decision up.",
        },
      ];
      // The clock is read off the notice itself and shown in "what this says".
      // The *statutory* windows behind it are the Phase 23 `appeal-windows`
      // shard's job — a deadline we cannot cite is a deadline we do not state.
      next.push({
        label:
          "If you disagree, ask for a hearing. Your notice states its own deadline — go by that date, and ask for help well before it.",
        channel: appealChannel(program),
      });
      return next;
    }
    default:
      return [
        {
          label:
            "Check the values above against the document, then confirm them to prefill the tools they feed. Nothing is used until you confirm.",
        },
      ];
  }
}

/** The one-line reason a section is empty, per kind. */
function emptyReason(section: AnswerSection, result: ExtractionResult): string {
  if (section === "flags") {
    return result.source === "ocr"
      ? "Nothing flagged. This was read by OCR, so the checks that depend on exact wording were not run."
      : "Nothing flagged — the figures on this document reconcile against each other.";
  }
  if (section === "owed") {
    if (result.kind === "eobHealth") {
      return valueOf(result, "eob-network") === "in-network"
        ? "This claim is in-network, so the federal surprise-billing protections — which cover out-of-network charges — are not the rule in play."
        : "Nothing listed here. Surprise-billing protections are stated only where we can cite the rule that grants them.";
    }
    return "This document reports figures; it does not by itself indicate a credit or a program.";
  }
  if (section === "says") {
    return "We recognized the document but could not read its fields — enter them by hand.";
  }
  return "No further step from this document alone.";
}

/**
 * Build the four-part answer for one document. `documents` carries the whole
 * session so a cross-document check (EOB × medical bill) can fire; pass just the
 * one document and those checks stay silent rather than half-firing.
 */
export function buildAnswer(
  result: ExtractionResult,
  options: BuildAnswerOptions = {},
): ReadoutAnswer {
  const documents = options.documents ?? [result];
  const says = saysFor(result);
  const flags = runChecks({ primary: result, documents, plan: options.plan }, options.registry);
  const owed = owedFor(result, options.noSurprises);
  const next = nextFor(result);

  const emptyReasons: ReadoutAnswer["emptyReasons"] = {};
  if (says.length === 0) emptyReasons.says = emptyReason("says", result);
  if (flags.length === 0) emptyReasons.flags = emptyReason("flags", result);
  if (owed.length === 0) emptyReasons.owed = emptyReason("owed", result);
  if (next.length === 0) emptyReasons.next = emptyReason("next", result);

  return { source: result, says, flags, owed, next, emptyReasons };
}
