import { test, expect } from "@playwright/test";

/**
 * A PDF is a container, not a format.
 *
 * A phone photo or a scanner's output saved as a PDF has no text layer, so
 * pdf.js returns nothing and the reader used to answer "We couldn't recognize
 * this document. Supported: typed W-2, Form 1040, ..." — to someone holding a
 * scanned W-2, from a tool that ships an OCR engine capable of reading it.
 *
 * The page is rendered and OCR'd now. This is the only end-to-end proof of that
 * path, because none of it can be exercised without a real browser: an
 * OffscreenCanvas, pdf.js's renderer, and the wasm OCR core. The fixture is
 * built in the page rather than committed — a raster of a W-2 drawn to a canvas
 * and wrapped in a hand-assembled PDF with no text layer at all, which keeps a
 * megabyte of image bytes out of the repository and makes what it contains
 * readable here instead of opaque.
 */
test("a scanned PDF with no text layer is rendered and read by on-device OCR", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/#/readout");
  await page.waitForSelector("input.readout-file");

  await page.evaluate(() => {
    const W = 1240,
      H = 800;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, W, H);
    g.fillStyle = "#000";
    const lines: [string, number, number, string][] = [
      ["Form W-2 Wage and Tax Statement", 60, 70, "bold 34px Helvetica, Arial, sans-serif"],
      ["2026", 1080, 70, "bold 34px Helvetica, Arial, sans-serif"],
      ["1 Wages, tips, other compensation", 60, 180, "26px Helvetica, Arial, sans-serif"],
      ["62150.00", 760, 180, "26px Helvetica, Arial, sans-serif"],
      ["2 Federal income tax withheld", 60, 250, "26px Helvetica, Arial, sans-serif"],
      ["6204.11", 760, 250, "26px Helvetica, Arial, sans-serif"],
      ["3 Social security wages", 60, 320, "26px Helvetica, Arial, sans-serif"],
      ["62150.00", 760, 320, "26px Helvetica, Arial, sans-serif"],
      ["4 Social security tax withheld", 60, 390, "26px Helvetica, Arial, sans-serif"],
      ["3853.30", 760, 390, "26px Helvetica, Arial, sans-serif"],
      ["5 Medicare wages and tips", 60, 460, "26px Helvetica, Arial, sans-serif"],
      ["62150.00", 760, 460, "26px Helvetica, Arial, sans-serif"],
      ["6 Medicare tax withheld", 60, 530, "26px Helvetica, Arial, sans-serif"],
      ["901.18", 760, 530, "26px Helvetica, Arial, sans-serif"],
    ];
    for (const [text, x, y, font] of lines) {
      g.font = font;
      g.fillText(text, x, y);
    }

    const img = g.getImageData(0, 0, W, H).data;
    const px = new Uint8Array(W * H * 3);
    for (let i = 0, j = 0; i < img.length; i += 4, j += 3) {
      px[j] = img[i]!;
      px[j + 1] = img[i + 1]!;
      px[j + 2] = img[i + 2]!;
    }

    const enc = (s: string) => new TextEncoder().encode(s);
    const parts: Uint8Array[] = [];
    const offsets: number[] = [0];
    let len = 0;
    const push = (b: Uint8Array) => {
      parts.push(b);
      len += b.length;
    };
    push(enc("%PDF-1.4\n"));
    const content = `q ${W / 2} 0 0 ${H / 2} 0 0 cm /Im0 Do Q`;
    const objs = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W / 2} ${H / 2}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
      null,
    ];
    for (let i = 0; i < objs.length; i++) {
      offsets.push(len);
      if (objs[i] === null) {
        push(
          enc(
            `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${px.length} >>\nstream\n`,
          ),
        );
        push(px);
        push(enc("\nendstream\nendobj\n"));
      } else {
        push(enc(`${i + 1} 0 obj\n${objs[i]}\nendobj\n`));
      }
    }
    const xref = len;
    let x = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objs.length; i++)
      x += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
    x += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    push(enc(x));

    const file = new File(parts as BlobPart[], "scanned-w2.pdf", { type: "application/pdf" });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.querySelector<HTMLInputElement>("input.readout-file")!;
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  // Loading the wasm core and the language model, then rendering and reading a
  // page, is tens of seconds on a cold cache.
  await page.waitForSelector(".readout-fields", { timeout: 150_000 });
  const text = await page.evaluate(() => document.querySelector("main")?.innerText ?? "");

  // It read the form, and the figures are the ones drawn on the page.
  expect(text).toMatch(/Recognized a W-2 \(2026\)/);
  expect(text).toContain("$62,150.00");
  expect(text).toContain("$6,204.11");

  // And it is honest about where they came from. OCR is the lower-confidence
  // path: every value is flagged for review, and the checks that read exact
  // wording do not run, because a rule check on a misread number is the one
  // thing this reader must never do.
  expect(text).toMatch(/optical character recognition/i);
  expect(text).toMatch(/LOW CONFIDENCE/);
  expect(text).toMatch(/read by OCR, so the checks that depend on exact wording were not run/);

  // The message this replaced.
  expect(text).not.toMatch(/couldn't recognize this document/i);
});
