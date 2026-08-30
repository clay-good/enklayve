import { describe, it, expect } from "vitest";
import {
  looksLikeScannedPdf,
  MAX_DOCUMENT_BYTES,
  MAX_OCR_PDF_PAGES,
  ocrRenderScale,
  SCANNED_PDF_MESSAGE,
  tooLargeMessage,
  tooManyScannedPagesMessage,
} from "../../src/readout/extractText";

/**
 * A PDF is a container, not a format.
 *
 * A phone photo or a scanner's output saved as a PDF has no text layer, so
 * pdf.js returns empty pages or a few stray characters. That document used to
 * fall through to "We couldn't recognize this document. Supported: typed W-2,
 * Form 1040, …" — wrong twice: it usually IS one of those, and the reader owns
 * an OCR engine that would read the same pages arriving as a PNG.
 */
describe("recognizing a PDF with no text layer", () => {
  it("calls a document with no extractable text a scan", () => {
    expect(looksLikeScannedPdf([""])).toBe(true);
    expect(looksLikeScannedPdf(["", "", ""])).toBe(true);
    expect(looksLikeScannedPdf([])).toBe(true);
    // The stray characters a scanner stamps on a page — a page number, a fax
    // header — are not a text layer.
    expect(looksLikeScannedPdf(["1"])).toBe(true);
    expect(looksLikeScannedPdf(["Page 1 of 2", "Page 2 of 2"])).toBe(true);
    // Whitespace is not text either: pdf.js returns runs of spaces for the gaps
    // between glyph boxes it found nothing in.
    expect(looksLikeScannedPdf(["        \n     \t   "])).toBe(true);
  });

  it("leaves a real typed page alone", () => {
    const w2 =
      "Form W-2 Wage and Tax Statement 2026 1 Wages, tips, other compensation 62,150.00" +
      " 2 Federal income tax withheld 6,204.11 3 Social security wages 62,150.00";
    expect(looksLikeScannedPdf([w2])).toBe(false);
    // A long document whose first pages are sparse is still a typed document.
    expect(looksLikeScannedPdf(["", "", w2, w2, w2])).toBe(false);
  });

  it("tells the reader what to do instead of what is unsupported", () => {
    // The old message named the document types the reader was already holding.
    expect(SCANNED_PDF_MESSAGE).not.toMatch(/unsupported|couldn't recognize/i);
    expect(SCANNED_PDF_MESSAGE).toMatch(/scan/i);
    expect(SCANNED_PDF_MESSAGE).toMatch(/PNG|JPG/);
    // And it stays true to the promise: OCR runs on the device.
    expect(SCANNED_PDF_MESSAGE).toMatch(/on your device/i);
  });

  it("is also the test for whether OCR came back with anything", () => {
    // The same predicate gates the input and checks the output: a scan that
    // rendered and OCR'd to nothing must not be reported as a read document
    // with no fields in it.
    expect(looksLikeScannedPdf(["", "", ""])).toBe(true);
    expect(looksLikeScannedPdf(["Wages, tips, other compensation 62,150.00"])).toBe(false);
  });
});

describe("a scan longer than the reader will OCR", () => {
  it("says how long it is and what to send instead, rather than truncating", () => {
    // Every page is rasterized and run through the engine — seconds and tens of
    // megabytes each. Grinding silently through a 60-page file for minutes is
    // worse than saying so, and dropping pages without saying so is worse still.
    const message = tooManyScannedPagesMessage(60);
    expect(message).toContain("60 pages");
    expect(message).toContain(String(MAX_OCR_PDF_PAGES));
    expect(message).toMatch(/pages with your figures/);
  });

  it("leaves room for any form this reader recognizes", () => {
    // A W-2, a 1099, a pay stub, an EOB: one to a handful of pages.
    expect(MAX_OCR_PDF_PAGES).toBeGreaterThanOrEqual(8);
  });
});

describe("bounding what a dropped file can cost", () => {
  it("refuses a file too large to read in a tab, and says how large it was", () => {
    // Everything runs in the tab: `arrayBuffer()` pulls the whole file into
    // memory before pdf.js or mammoth sees a byte, so a large enough file takes
    // the page down with no message — the worst way to fail, because the person
    // cannot tell a refusal from a crash.
    const message = tooLargeMessage(900 * 1024 * 1024);
    expect(message).toContain("900 MB");
    expect(message).toContain("64 MB");
    expect(message).toMatch(/paste the text/);
  });

  it("leaves room for the documents people actually drop", () => {
    // A typed W-2 is under a megabyte, a phone photo ten or fifteen, a long
    // scanned PDF a few dozen.
    expect(MAX_DOCUMENT_BYTES).toBeGreaterThanOrEqual(32 * 1024 * 1024);
  });

  it("renders a normal page at 2x and an oversized one small enough to allocate", () => {
    // A letter page is 612x792 PDF units; 2x is about 150 dpi, which is what
    // small print needs.
    expect(ocrRenderScale(612, 792)).toBe(2);
    expect(ocrRenderScale(792, 612)).toBe(2);
    // The oversized MediaBox some scanners emit would be tens of millions of
    // pixels at 2x, and the allocation fails inside the canvas rather than
    // anywhere this could explain it.
    expect(ocrRenderScale(5000, 8000)).toBeCloseTo(3000 / 8000, 6);
    expect(ocrRenderScale(5000, 8000) * 8000).toBeCloseTo(3000, 6);
    // Degenerate viewports fall back rather than producing 0 or Infinity.
    for (const [w, h] of [
      [0, 0],
      [NaN, NaN],
      [Infinity, 100],
      [-10, -10],
    ]) {
      const scale = ocrRenderScale(w!, h!);
      expect(Number.isFinite(scale)).toBe(true);
      expect(scale).toBeGreaterThan(0);
    }
  });
});
