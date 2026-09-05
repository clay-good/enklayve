import { describe, it, expect, vi } from "vitest";
import JSZip from "jszip";
import { extractTextFromFile, isImageFile } from "../../src/readout/extractText";

/**
 * I/O-boundary tests for on-device text extraction (BUILD-SPEC-2 §2). The
 * anchored field extractors are golden-tested separately on text fixtures; this
 * file proves the file → text step itself — specifically that Word (.docx)
 * parsing via mammoth actually runs on the device (here, the Node/happy-dom test
 * env, which exercises the same browser unzip + XML path), so the deterministic
 * extractors downstream receive real text.
 */

/** Build a minimal but valid .docx (the OOXML package mammoth expects). */
async function makeDocx(paragraphs: string[]): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      `</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
      `</Relationships>`,
  );
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>${body}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "arraybuffer" });
}

describe("extractTextFromFile — Word (.docx)", () => {
  it("reads the text of a typed .docx on the device", async () => {
    const bytes = await makeDocx([
      "Form 1040 U.S. Individual Income Tax Return 2024",
      "11 Adjusted gross income 95000.00",
    ]);
    const file = new File([bytes], "return.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    const result = await extractTextFromFile(file);

    expect(result.source).toBe("typed");
    expect(result.text).toContain("Form 1040");
    expect(result.text).toContain("Adjusted gross income 95000.00");
    // mammoth flattens the document to one text stream — one page to anchor in.
    expect(result.pages).toHaveLength(1);
  });

  it("recognizes .docx by extension even without a MIME type", async () => {
    const bytes = await makeDocx(["Form W-2 Wage and Tax Statement 2024"]);
    const file = new File([bytes], "w2.docx", { type: "" });
    const result = await extractTextFromFile(file);
    expect(result.text).toContain("Form W-2");
  });

  it("rejects a genuinely unsupported file kind with a helpful message", async () => {
    // Images now route to OCR (below), so an unsupported file is one that is
    // neither a document nor an image — e.g. an archive.
    const file = new File(["PK binary"], "data.zip", { type: "application/zip" });
    await expect(extractTextFromFile(file)).rejects.toThrow(/Word|PDF|image|paste/);
  });
});

describe("isImageFile — OCR routing", () => {
  it("recognizes raster image formats by MIME type", () => {
    for (const type of ["image/png", "image/jpeg", "image/webp", "image/tiff"]) {
      expect(isImageFile(new File([""], "scan", { type }))).toBe(true);
    }
  });

  it("recognizes raster image formats by extension when the MIME type is missing", () => {
    for (const name of ["w2.png", "stub.JPG", "form.jpeg", "scan.tiff", "photo.bmp", "img.gif"]) {
      expect(isImageFile(new File([""], name, { type: "" }))).toBe(true);
    }
  });

  it("does not route documents or text to OCR", () => {
    expect(isImageFile(new File([""], "return.pdf", { type: "application/pdf" }))).toBe(false);
    expect(isImageFile(new File([""], "w2.docx", { type: "" }))).toBe(false);
    expect(isImageFile(new File([""], "notes.txt", { type: "text/plain" }))).toBe(false);
  });
});

/**
 * A reader that will not load is not a broken site.
 *
 * pdf.js, tesseract and mammoth are dynamically imported so a first visit does
 * not pay for them, and a dynamic import fails for two reasons that have
 * nothing to do with the document: the device is offline and has never cached
 * that chunk, or the site was deployed while the page was open — every chunk
 * name carries a content hash and the host serves only the current build, so
 * the module an open page is about to ask for stops existing the moment a new
 * one ships. This site deploys on every push to `main`.
 *
 * Both arrive as "Failed to fetch dynamically imported module", which the
 * Readout used to put on the screen verbatim. That reads as *this site is
 * broken* at the moment somebody has just dropped their tax document on it.
 * The service worker fix drew this same distinction — a chunk that cannot be
 * served is a network error, not the app shell parsed as a module — and
 * stopped one layer short of the sentence the reader sees.
 */
describe("a heavy reader that cannot be loaded", () => {
  it("says the page is behind, not that the document is bad", async () => {
    vi.resetModules();
    vi.doMock("mammoth", () => {
      throw new Error("Failed to fetch dynamically imported module: /assets/lib-D_V-sbDv.js");
    });
    const { extractTextFromFile } = await import("../../src/readout/extractText");
    const file = new File([await makeDocx(["anything"])], "w2.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    await expect(extractTextFromFile(file)).rejects.toThrow(
      /Word document reader could not be loaded/,
    );
    // Both causes named, because the page cannot tell them apart —
    // `navigator.onLine` reports the interface, not reachability — and the
    // action is the same either way.
    await expect(extractTextFromFile(file)).rejects.toThrow(/offline/);
    await expect(extractTextFromFile(file)).rejects.toThrow(/updated while this page was open/);
    await expect(extractTextFromFile(file)).rejects.toThrow(/Reload the page/);
    // And it does not leak the module URL, which is the part that reads as a
    // stack trace to somebody who just dropped their W-2 on the page.
    await expect(extractTextFromFile(file)).rejects.not.toThrow(/assets\//);
    vi.doUnmock("mammoth");
    vi.resetModules();
  });
});

/**
 * A locked PDF is the likeliest way a real tax document fails to open here.
 *
 * Payroll providers and banks routinely deliver a W-2, a 1099 or a statement
 * encrypted — often with the last four of an SSN as the password. pdf.js
 * rejects those with `PasswordException`, whose message is “No password
 * given”, and the Readout put that on the screen: four words naming no cause,
 * offering no next step, and not saying that this page has nowhere to type a
 * password.
 *
 * Driven through a stubbed `pdfjs-dist` rather than a real encrypted PDF,
 * because what is under test is the translation, and building a genuinely
 * encrypted PDF by hand to assert a sentence would be testing pdf.js.
 */
describe("a PDF that will not open", () => {
  async function readStubbedPdf(name: string, message: string): Promise<Error> {
    vi.resetModules();
    vi.doMock("pdfjs-dist", () => ({
      GlobalWorkerOptions: { workerSrc: "" },
      getDocument: () => ({
        promise: Promise.reject(Object.assign(new Error(message), { name })),
      }),
    }));
    vi.doMock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "/worker.js" }));
    const { extractTextFromFile } = await import("../../src/readout/extractText");
    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "w2.pdf", {
      type: "application/pdf",
    });
    return extractTextFromFile(file).then(
      () => {
        throw new Error("expected the read to fail");
      },
      (e: Error) => e,
    );
  }

  it("says a password-protected file is locked, and what to do instead", async () => {
    const err = await readStubbedPdf("PasswordException", "No password given");
    expect(err.message).toMatch(/password-protected/);
    expect(err.message).toMatch(/nowhere here to type the password/);
    expect(err.message).toMatch(/save an unlocked copy/i);
    // The promise is repeated, because the suggestion is "open it somewhere
    // else and come back" and the promise is why this page was chosen.
    expect(err.message).toMatch(/nothing you drop leaves this device/);
    expect(err.message).not.toMatch(/No password given/);
    vi.doUnmock("pdfjs-dist");
    vi.resetModules();
  });

  it("says a file that is not really a PDF is not one, rather than naming a structure", async () => {
    const err = await readStubbedPdf("InvalidPDFException", "Invalid PDF structure.");
    expect(err.message).toMatch(/not one a reader can open/);
    expect(err.message).not.toMatch(/Invalid PDF structure/);
    vi.doUnmock("pdfjs-dist");
    vi.resetModules();
  });

  it("passes anything else through untouched, rather than guessing at it", async () => {
    const err = await readStubbedPdf("UnexpectedResponseException", "something else entirely");
    expect(err.message).toBe("something else entirely");
    vi.doUnmock("pdfjs-dist");
    vi.resetModules();
  });
});
