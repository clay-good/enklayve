/**
 * On-device document text extraction (BUILD-SPEC-2 §2). Turns a dropped file
 * into plain text in the browser. pdf.js (typed PDFs), mammoth (Word .docx), and
 * tesseract.js (scanned images, the lower-confidence OCR fallback) are each
 * dynamically imported so they never weigh down the shell and load only when a
 * matching document is actually read.
 *
 * Privacy: nothing is uploaded. Every page keeps `connect-src 'none'`; pdf.js is
 * configured to fetch no external resources, mammoth unzips in memory, and the
 * OCR engine loads its worker, wasm core, and language model from same-origin
 * `/ocr/` assets only — so extraction runs fully on the device and the browser
 * physically cannot send the document anywhere.
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

/** Read a Word (.docx) document on the device with mammoth, dynamically imported
 * so it never weighs down the shell and loads only when a Word file is read.
 * mammoth resolves its browser build via package `browser` fields, so unzipping
 * and file reads happen in the browser with no network access — honoring
 * `connect-src 'none'`. We take the raw text (not HTML), since the anchored
 * extractors read labels and box numbers, not markup. */
async function extractDocx(file: File): Promise<ExtractedText> {
  const mammoth = await import("mammoth");
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  const text = result.value.replace(/\r\n/g, "\n").trim();
  // mammoth flattens a .docx to a single text stream; there are no hard page
  // boundaries in the XML, so the whole document is one "page" to anchor within.
  return { text, pages: [text], source: "typed" };
}

/** Read a plain-text file (also used as the manual paste/upload fallback). */
async function extractPlainText(file: File): Promise<ExtractedText> {
  const text = await file.text();
  return { text, pages: text.split(/\f/), source: "typed" };
}

/** Same-origin base path for the OCR engine assets emitted by the build's
 * `ocrAssets` Vite plugin (worker + wasm core + bundled language model). No
 * trailing slash: tesseract.js appends `/<lang>.traineddata.gz` and the core
 * filename itself. */
const OCR_ASSET_PATH = "/ocr";

/** True for the raster image formats the OCR fallback can read. */
export function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  return /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i.test(file.name);
}

/**
 * Read a scanned or photographed image on the device with tesseract.js, which
 * is dynamically imported so it never weighs down the shell and loads only when
 * an image is dropped. The worker, its wasm core, and the English language model
 * are all SAME-ORIGIN assets (the build's `ocrAssets` plugin emits them under
 * `/ocr/`); `workerBlobURL: false` loads the worker from that same-origin URL so
 * it adopts the relaxed `/ocr/*` CSP (`connect-src 'self'`) rather than a blob:
 * worker that would inherit the page's `connect-src 'none'`. Nothing is fetched
 * cross-origin, so the privacy promise holds. OCR text is marked the
 * lower-confidence `"ocr"` source, so every extracted field is flagged for
 * review (§2.2).
 */
async function extractImage(file: File): Promise<ExtractedText> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    workerPath: `${OCR_ASSET_PATH}/worker.min.js`,
    corePath: OCR_ASSET_PATH,
    langPath: OCR_ASSET_PATH,
    workerBlobURL: false,
  });
  try {
    const { data } = await worker.recognize(file);
    const text = data.text
      .replace(/[ \t]+/g, " ")
      .replace(/\n{2,}/g, "\n")
      .trim();
    return { text, pages: [text], source: "ocr" };
  } finally {
    await worker.terminate();
  }
}

/**
 * Extract text from a supported document. Typed PDFs, Word documents, and plain
 * text are read deterministically on the device; scanned or photographed images
 * fall back to on-device OCR (a clearly-labeled, lower-confidence path). The
 * order matters — the type/extension checks run before the image check so a
 * typed PDF is never sent to OCR.
 */
export const extractTextFromFile: TextExtractor = async (file) => {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    return extractPdf(file);
  }
  if (
    name.endsWith(".docx") ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return extractDocx(file);
  }
  if (name.endsWith(".txt") || name.endsWith(".text") || file.type.startsWith("text/")) {
    return extractPlainText(file);
  }
  if (isImageFile(file)) {
    return extractImage(file);
  }
  throw new Error(
    "Unsupported file. Drop a typed PDF, a Word (.docx) document, a scanned image (PNG/JPG), or paste the text.",
  );
};
