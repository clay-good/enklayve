/**
 * On-device document text extraction (BUILD-SPEC-2 §2). Turns a dropped file
 * into plain text in the browser. pdf.js is dynamically imported so it never
 * weighs down the shell and loads only when a document is actually read.
 *
 * Privacy: nothing is uploaded. The strict CSP keeps `connect-src 'none'`, and
 * pdf.js is configured to fetch no external resources (no cmaps, no standard
 * fonts), so extraction runs fully on the device — the browser physically
 * cannot send the document anywhere.
 */

/** Where the text came from. OCR is a clearly-labeled, lower-confidence source. */
export type TextSource = "typed" | "ocr";

export interface ExtractedText {
  /** Full document text (pages joined by newlines). */
  text: string;
  /** Per-page text, preserved so extractors can anchor within a page. */
  pages: string[];
  /** Typed-PDF/Word text is high confidence; OCR is flagged lower confidence. */
  source: TextSource;
}

/** A function that turns a file into text — injectable so the UI is testable. */
export type TextExtractor = (file: File) => Promise<ExtractedText>;

/** Read a typed PDF entirely on the device, with no network access. */
async function extractPdf(file: File): Promise<ExtractedText> {
  const pdfjs = await import("pdfjs-dist");
  // The worker is bundled as a same-origin asset (CSP `worker-src 'self'`); it
  // is never fetched cross-origin.
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const data = new Uint8Array(await file.arrayBuffer());
  // No cmap/standard-font URLs and isEvalSupported:false => no runtime fetch,
  // honoring `connect-src 'none'`.
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    pages.push(text);
  }
  return { text: pages.join("\n"), pages, source: "typed" };
}

/** Read a plain-text file (also used as the manual paste/upload fallback). */
async function extractPlainText(file: File): Promise<ExtractedText> {
  const text = await file.text();
  return { text, pages: text.split(/\f/), source: "typed" };
}

/**
 * Extract text from a supported document. Typed PDFs and plain text are read
 * deterministically on the device. Scanned images would need the OCR fallback
 * (a clearly-labeled, lower-confidence path that lands with offline support).
 */
export const extractTextFromFile: TextExtractor = async (file) => {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    return extractPdf(file);
  }
  if (name.endsWith(".txt") || name.endsWith(".text") || file.type.startsWith("text/")) {
    return extractPlainText(file);
  }
  throw new Error(
    "Unsupported file. Drop a typed PDF or paste the text. Scanned images need OCR, which is coming with offline support.",
  );
};
