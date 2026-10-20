/**
 * The Readout's reading half: the extractors, the check registry and the
 * four-part answer, as one chunk the Readout imports when a document is
 * dropped rather than with the shell (SPEC-5 Phase 32). Reading a document
 * already needs pdf.js or the OCR engine, both loaded on first use, so loading
 * this beside them takes nothing away offline that was there before.
 */
export { extractDocument, labelFor } from "./extract";
export { buildAnswer } from "./answer";
