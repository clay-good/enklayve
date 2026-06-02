import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { extractTextFromFile } from "../../src/readout/extractText";

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

  it("rejects an unsupported file kind with a helpful message", async () => {
    const file = new File(["not a document"], "photo.png", { type: "image/png" });
    await expect(extractTextFromFile(file)).rejects.toThrow(/Word|PDF|paste/);
  });
});
