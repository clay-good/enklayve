/**
 * On-device document text extraction (BUILD-SPEC-2 §2). Turns a dropped file
 * into plain text in the browser. pdf.js (PDFs, typed or scanned), mammoth (Word .docx), and
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

/**
 * The largest file this will try to read.
 *
 * Everything here runs in the tab: `arrayBuffer()` pulls the whole file into
 * memory before pdf.js or mammoth sees a byte of it, so a file big enough
 * takes the page down with no message at all — the worst way to fail, because
 * the person cannot tell a refusal from a crash. The documents this reads are
 * far smaller: a typed W-2 is under a megabyte, a phone photo ten or fifteen,
 * a long scanned PDF a few dozen. This sits above all of them and below the
 * point where a tab is in trouble.
 */
export const MAX_DOCUMENT_BYTES = 64 * 1024 * 1024;

/** Round to a whole megabyte for a message a person reads, never for arithmetic. */
function megabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/** What to say about a file too large to read here, rather than freezing on it. */
export function tooLargeMessage(bytes: number): string {
  return (
    `That file is ${megabytes(bytes)}, and everything here is read in this tab — above about ` +
    `${megabytes(MAX_DOCUMENT_BYTES)} the page runs out of memory rather than reading it. ` +
    "Save just the pages with your figures on them, or paste the text."
  );
}

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

/**
 * Does this PDF carry no selectable text worth reading?
 *
 * A PDF is a container, not a format: a phone photo or a scanner's output saved
 * as a PDF has no text layer at all, and `getTextContent()` returns empty pages
 * or a few stray characters — a page number, a fax header. Before this existed,
 * such a document fell all the way through to "We couldn't recognize this
 * document. Supported: typed W-2, Form 1040, …", which is wrong twice over: the
 * document usually IS one of those, and the reader owns an OCR engine that would
 * read it if the same pages arrived as a PNG.
 *
 * A stray character or two must not count as text, and a genuine page carries
 * hundreds, so the threshold sits far from both: fewer than twenty non-space
 * characters per page on average. It is advisory — the message it produces asks
 * the reader to supply the pages another way; nothing is discarded on its word.
 */
export function looksLikeScannedPdf(pages: readonly string[]): boolean {
  if (pages.length === 0) return true;
  const dense = pages.join("").replace(/\s+/g, "").length;
  return dense < 20 * pages.length;
}

/**
 * What to tell someone whose scan could not be read even by OCR.
 *
 * A scanned PDF is rendered and read now rather than refused, so this is the
 * last resort: a browser with no `OffscreenCanvas`, or pages OCR came back
 * empty-handed on — a photograph too dark, too skewed, or too low-resolution
 * for the engine. It names the situation and gives a step that works, rather
 * than the message this replaced, which told the person their supported
 * document was unsupported.
 */
export const SCANNED_PDF_MESSAGE =
  "This PDF is a scan, and reading it here on your device found no text on the page — usually " +
  "a photo that is dark, skewed, or too low-resolution. A straight-on, well-lit image of the " +
  "page (PNG or JPG) reads better than a photo of a screen. Pasting the text works too.";

/**
 * Load one of the heavy readers, and say what happened when it cannot be
 * loaded.
 *
 * pdf.js, tesseract and mammoth are dynamically imported so a first visit does
 * not pay for them, and a dynamic import is the one operation here that can
 * fail for a reason that has nothing to do with the document. Two of them are
 * ordinary:
 *
 *   - **Offline, first use.** A lazy chunk is runtime-cached the first time it
 *     is fetched, so a reader who has never opened the Readout has never
 *     cached it. The service worker used to answer that miss with the app
 *     shell, and the browser reported a syntax error for parsing HTML as a
 *     module; it returns a network error now, which is what it is.
 *   - **The site was deployed while the page was open.** Every chunk name
 *     carries a content hash and the host serves only the current build, so
 *     the module this page will ask for stops existing the moment a new one
 *     ships. Nothing is wrong with the reader's copy except that it is one
 *     version behind.
 *
 * Both surface as "Failed to fetch dynamically imported module", which reads
 * to a reader as *this site is broken*. It is the same distinction the service
 * worker fix drew and stopped one layer short of: the message the reader
 * actually sees. It names both causes because the page cannot tell them apart
 * — `navigator.onLine` reports the interface, not reachability — and the
 * action is the same either way.
 */
async function loadReader<T>(load: () => Promise<T>, what: string): Promise<T> {
  try {
    return await load();
  } catch {
    throw new Error(
      `The ${what} could not be loaded. Either this device is offline and has not used it ` +
        "before, or the site was updated while this page was open. Reload the page and try " +
        "again — nothing you dropped here has gone anywhere.",
    );
  }
}

/**
 * Open a PDF, and say what is wrong with it in the reader's terms.
 *
 * pdf.js rejects with its own exception types, and their messages are written
 * for the library's caller rather than for the person at the keyboard. A
 * password-protected file rejects with **“No password given”**, which is what
 * the Readout used to put on screen — and a locked PDF is not an edge case
 * here: payroll providers and banks routinely deliver a W-2, a 1099 or a
 * statement encrypted, often with the last four of an SSN as the password. So
 * the most likely single reason a real tax document fails to open was answered
 * with four words that name no cause, offer no next step, and do not say that
 * this page has nowhere to type a password.
 *
 * The wording says what to do instead, and repeats the promise, because the
 * suggestion is "open it somewhere else and come back" and the reason someone
 * chose this page is that nothing leaves the device.
 */
async function openPdf<T>(open: () => Promise<T>): Promise<T> {
  try {
    return await open();
  } catch (err) {
    const name = (err as { name?: string }).name ?? "";
    if (name === "PasswordException") {
      throw new Error(
        "This PDF is password-protected, and there is nowhere here to type the password — " +
          "opening it would mean this page holding one. Open it in your usual PDF reader, save " +
          "an unlocked copy, and drop that here instead. Pasting the text works too, and " +
          "either way nothing you drop leaves this device.",
      );
    }
    if (name === "InvalidPDFException") {
      throw new Error(
        "This file ends in .pdf but is not one a reader can open — it may be damaged, or saved " +
          "from another format under that name. Try re-downloading it, or paste the text.",
      );
    }
    throw err;
  }
}

/**
 * Read a PDF entirely on the device, with no network access. A PDF with a text
 * layer is read from it directly; one without — a scan — is rendered page by
 * page and read by OCR instead.
 */
async function extractPdf(file: File): Promise<ExtractedText> {
  const pdfjs = await loadReader(() => import("pdfjs-dist"), "PDF reader");
  // The worker is bundled as a same-origin asset (CSP `worker-src 'self'`); it
  // is never fetched cross-origin.
  const worker = await loadReader(
    () => import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    "PDF reader",
  );
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const data = new Uint8Array(await file.arrayBuffer());
  // No cmap/standard-font URLs and isEvalSupported:false => no runtime fetch,
  // honoring `connect-src 'none'`.
  const doc = await openPdf(() => pdfjs.getDocument({ data, isEvalSupported: false }).promise);
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
  if (looksLikeScannedPdf(pages)) return ocrPdfPages(doc);
  return { text: pages.join("\n"), pages, source: "typed" };
}

/**
 * How many pages of a scanned PDF this will read.
 *
 * Every page has to be rasterized at print-ish resolution and run through the
 * OCR engine, which is seconds and tens of megabytes each. The documents this
 * reader recognizes are one to a handful of pages — a W-2, a 1099, a pay stub,
 * an EOB — so a scan far past that is a whole file someone dropped, and grinding
 * through it silently for several minutes is worse than saying so. The limit is
 * generous enough that no real form reaches it.
 */
export const MAX_OCR_PDF_PAGES = 12;

/** What to say when a scan is longer than this will read, rather than truncating quietly. */
export function tooManyScannedPagesMessage(pageCount: number): string {
  return (
    `This PDF is a scan of ${pageCount} pages, and reading a scan means running each page ` +
    `through OCR on your device — so it is capped at ${MAX_OCR_PDF_PAGES}. Save just the ` +
    "pages with your figures on them and drop those, as a shorter PDF or as images."
  );
}

/**
 * Read a PDF that has no text layer by rendering each page and running the same
 * on-device OCR the image path uses.
 *
 * This is the reason a scan is not a dead end. A PDF is a container, not a
 * format: a phone photo or a scanner's output saved as a PDF carries pixels and
 * no text, and until this existed the reader told the person holding a scanned
 * W-2 that W-2s were not supported. The pages are rendered at 2× so small print
 * survives, drawn on an OffscreenCanvas that never enters the document, and
 * handed to the worker one at a time so only one page's bitmap is alive at once.
 *
 * The result is marked `"ocr"`, which is not a formality: it flags every
 * extracted field for review and stops the rule checks from running, because a
 * rule check on a misread number is the one thing this reader must never do.
 * Nothing is uploaded — the worker, its wasm core, and the language model are
 * same-origin `/ocr/` assets, and the page keeps `connect-src 'none'`.
 */
async function ocrPdfPages(doc: {
  numPages: number;
  getPage(n: number): Promise<{
    getViewport(o: { scale: number }): { width: number; height: number };
    render(o: { canvasContext: unknown; viewport: unknown }): { promise: Promise<void> };
  }>;
}): Promise<ExtractedText> {
  if (doc.numPages > MAX_OCR_PDF_PAGES) throw new Error(tooManyScannedPagesMessage(doc.numPages));
  if (typeof OffscreenCanvas === "undefined") throw new Error(SCANNED_PDF_MESSAGE);

  const { createWorker } = await loadReader(() => import("tesseract.js"), "text recognizer");
  const worker = await createWorker("eng", 1, {
    workerPath: `${OCR_ASSET_PATH}/worker.min.js`,
    corePath: OCR_ASSET_PATH,
    langPath: OCR_ASSET_PATH,
    workerBlobURL: false,
  });
  try {
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      const unscaled = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({
        scale: ocrRenderScale(unscaled.width, unscaled.height),
      });
      const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");
      if (!context) throw new Error(SCANNED_PDF_MESSAGE);
      // A scan's own page is white, but a PDF page is transparent until drawn,
      // and OCR on a transparent-over-black bitmap reads nothing at all.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport }).promise;
      const { data } = await worker.recognize(await canvas.convertToBlob());
      pages.push(
        data.text
          .replace(/[ \t]+/g, " ")
          .replace(/\n{2,}/g, "\n")
          .trim(),
      );
    }
    if (looksLikeScannedPdf(pages)) throw new Error(SCANNED_PDF_MESSAGE);
    return { text: pages.join("\n"), pages, source: "ocr" };
  } finally {
    await worker.terminate();
  }
}

/** Read a Word (.docx) document on the device with mammoth, dynamically imported
 * so it never weighs down the shell and loads only when a Word file is read.
 * mammoth resolves its browser build via package `browser` fields, so unzipping
 * and file reads happen in the browser with no network access — honoring
 * `connect-src 'none'`. We take the raw text (not HTML), since the anchored
 * extractors read labels and box numbers, not markup. */
async function extractDocx(file: File): Promise<ExtractedText> {
  const mammoth = await loadReader(() => import("mammoth"), "Word document reader");
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

/**
 * Render scale for a scanned PDF page. A PDF's own units are 72 dpi, which OCR
 * reads badly on the small print these forms are full of; 2× lands near 150 dpi,
 * enough for a box label without the memory a 300-dpi bitmap costs.
 */
const OCR_RENDER_SCALE = 2;

/**
 * The longest side a rendered page may reach, in pixels.
 *
 * 2× is right for a letter page and wrong for the oversized MediaBox some
 * scanners emit: at 2× a large-format page becomes a bitmap of tens of millions
 * of pixels, and the allocation fails inside the canvas rather than anywhere
 * this could explain. Scale is reduced to fit instead, which costs resolution on
 * a page that had plenty and keeps the read working.
 */
const OCR_MAX_PAGE_PIXELS = 3_000;

/** The render scale for a page, reduced from 2× only when 2× would be enormous. */
export function ocrRenderScale(unscaledWidth: number, unscaledHeight: number): number {
  const longest = Math.max(unscaledWidth, unscaledHeight);
  if (!Number.isFinite(longest) || longest <= 0) return OCR_RENDER_SCALE;
  return Math.min(OCR_RENDER_SCALE, OCR_MAX_PAGE_PIXELS / longest);
}

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
  const { createWorker } = await loadReader(() => import("tesseract.js"), "text recognizer");
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
 * typed PDF is never sent to OCR. (A PDF *without* a text layer still is —
 * that decision belongs to the PDF reader, which is the only thing that can
 * see whether the pages carry text.)
 */
export const extractTextFromFile: TextExtractor = async (file) => {
  if (file.size > MAX_DOCUMENT_BYTES) throw new Error(tooLargeMessage(file.size));
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
    "Unsupported file. Drop a PDF, a Word (.docx) document, a scanned image (PNG/JPG), or paste the text.",
  );
};
