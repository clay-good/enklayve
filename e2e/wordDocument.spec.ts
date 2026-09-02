import { test, expect } from "@playwright/test";

/**
 * A Word document read in a real browser.
 *
 * The .docx path is unzipped and XML-parsed by mammoth, which does not use the
 * browser's own DOMParser: it bundles `@xmldom/xmldom` and ships it to the
 * device. That library moved from 0.8 to 0.9 to clear a published advisory, a
 * major version under the one document kind a household is most likely to have
 * been *emailed* rather than downloaded — a benefits determination, a letter
 * from a payroll office, an offer letter.
 *
 * The unit suite covers the same call, but in happy-dom, where the environment
 * supplies its own DOM and the failure mode being guarded against here — a
 * bundled parser that behaves differently once minified and run in a browser —
 * cannot appear. So this proves it where it actually runs.
 *
 * The fixture is built in the page rather than committed: a minimal OOXML
 * package (stored, uncompressed zip entries, so the whole format is visible in
 * this file rather than opaque in a binary).
 */
test("a typed Word .docx is unzipped, XML-parsed, and recognized on the device", async ({
  page,
}) => {
  await page.goto("/#/readout");
  await page.waitForSelector("input.readout-file");

  await page.evaluate(() => {
    const enc = new TextEncoder();

    // CRC-32, which a zip entry's header must carry even when it is stored.
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c >>> 0;
    }
    const crc32 = (b: Uint8Array): number => {
      let c = 0xffffffff;
      for (const byte of b) c = table[(c ^ byte) & 0xff]! ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    };

    const files: [string, string][] = [
      [
        "[Content_Types].xml",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Default Extension="xml" ContentType="application/xml"/>` +
          `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
          `</Types>`,
      ],
      [
        "_rels/.rels",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
          `</Relationships>`,
      ],
      [
        "word/document.xml",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
          [
            "Form W-2 Wage and Tax Statement 2026",
            "1 Wages, tips, other compensation 62150.00",
            "2 Federal income tax withheld 6204.11",
            "3 Social security wages 62150.00",
            "4 Social security tax withheld 3853.30",
            "5 Medicare wages and tips 62150.00",
            "6 Medicare tax withheld 901.18",
          ]
            .map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`)
            .join("") +
          `</w:body></w:document>`,
      ],
    ];

    const local: Uint8Array[] = [];
    const central: Uint8Array[] = [];
    let offset = 0;
    const u32 = (v: number): number[] => [
      v & 255,
      (v >> 8) & 255,
      (v >> 16) & 255,
      (v >>> 24) & 255,
    ];
    const u16 = (v: number): number[] => [v & 255, (v >> 8) & 255];

    for (const [name, xml] of files) {
      const nameBytes = enc.encode(name);
      const data = enc.encode(xml);
      const crc = crc32(data);
      // Method 0 (stored): the data is the data, so nothing here depends on a
      // compressor and the bytes below are the whole format.
      const header = new Uint8Array([
        ...u32(0x04034b50),
        ...u16(20),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u32(crc),
        ...u32(data.length),
        ...u32(data.length),
        ...u16(nameBytes.length),
        ...u16(0),
        ...nameBytes,
      ]);
      local.push(header, data);
      central.push(
        new Uint8Array([
          ...u32(0x02014b50),
          ...u16(20),
          ...u16(20),
          ...u16(0),
          ...u16(0),
          ...u16(0),
          ...u16(0),
          ...u32(crc),
          ...u32(data.length),
          ...u32(data.length),
          ...u16(nameBytes.length),
          ...u16(0),
          ...u16(0),
          ...u16(0),
          ...u16(0),
          ...u32(0),
          ...u32(offset),
          ...nameBytes,
        ]),
      );
      offset += header.length + data.length;
    }

    const centralSize = central.reduce((n, b) => n + b.length, 0);
    const end = new Uint8Array([
      ...u32(0x06054b50),
      ...u16(0),
      ...u16(0),
      ...u16(files.length),
      ...u16(files.length),
      ...u32(centralSize),
      ...u32(offset),
      ...u16(0),
    ]);

    const file = new File([...local, ...central, end] as BlobPart[], "w2.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.querySelector<HTMLInputElement>("input.readout-file")!;
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  await page.waitForSelector(".readout-fields", { timeout: 20_000 });
  const text = await page.evaluate(() => document.querySelector("main")?.innerText ?? "");

  // The text came out of the XML, and the figures are the ones in the document.
  expect(text).toMatch(/Recognized a W-2 \(2026\)/);
  expect(text).toContain("$62,150.00");
  expect(text).toContain("$6,204.11");

  // A typed document is the HIGH-confidence path — unlike the scanned-PDF case,
  // nothing here is OCR, so the rule checks are allowed to run.
  expect(text).not.toMatch(/optical character recognition/i);
  expect(text).not.toMatch(/couldn't recognize this document/i);
});
