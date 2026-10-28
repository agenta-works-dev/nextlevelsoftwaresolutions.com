import test from "node:test";
import assert from "node:assert/strict";
import { printedSpanPresent } from "../scripts/documents/source-span.js";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { zipSync, strToU8 } from "fflate";
import {
  parseDelimited,
  parseWorkbook,
  unzipWorkbook,
  decodeText,
} from "../scripts/documents/spreadsheets.js";
import { imageSize } from "../scripts/documents/readers.js";
import { validateExtraction } from "../scripts/documents/schema.js";
import { casePair } from "./fixtures/document-pairs.mjs";

test("CSV/TSV readers preserve unfamiliar headers, metadata, offsets and types as source text", () => {
  const sheet = parseDelimited(
    'Advice;9017\n\n"Our, ref";"Pack";"Will leave"\n"H-G8";"BOX";"12/10/26"',
  );
  assert.equal(sheet.rows[2][0].text, "Our, ref");
  assert.equal(sheet.rows[3][0].address, "A4");
  assert.equal(sheet.rows[3][2].text, "12/10/26");
  const tab = parseDelimited("Document\tAck\nRef\t45082\n");
  assert.equal(tab.rows[1][1].text, "45082");
});
test("wrapped PDF labels retain every cited source row without inventing words", () => {
  assert.equal(printedSpanPresent("Order qty", ["Lin Order", "e qty"]), true);
  assert.equal(printedSpanPresent("Order pack", ["Lin Order", "e qty"]), false);
  const pair = casePair(),
    source = pair.sources[0];
  source.anchors.push(
    {
      id: "po:wrapped:r1",
      kind: "text",
      text: "Lin Order",
      label: "Page 1 row 8",
      page: 1,
    },
    {
      id: "po:wrapped:r2",
      kind: "text",
      text: "e qty",
      label: "Page 1 row 9",
      page: 1,
    },
  );
  const mapping = pair.extraction.documents[0].mappings.find(
    (m) => m.field === "line.quantity",
  );
  mapping.label = "Order qty";
  mapping.evidence = source.anchors
    .slice(-2)
    .map((a) => ({ anchorId: a.id, quote: a.text, bbox: null }));
  assert.equal(
    validateExtraction(
      pair.extraction,
      pair.sources,
    ).documents[0].mappings.find((m) => m.field === "line.quantity").evidence
      .length,
    2,
  );
  mapping.label = "Order pack";
  assert.throws(
    () => validateExtraction(pair.extraction, pair.sources),
    /not present/,
  );
});
test("quoted multiline data is preserved, malformed rows and enormous cells are rejected", () => {
  assert.equal(
    parseDelimited('Name,Notes\nA,"first line\nsecond line"').rows[1][1].text,
    "first line\nsecond line",
  );
  assert.throws(() => parseDelimited('Name,Value\nA,"unclosed'), /not closed/);
  assert.throws(() => parseDelimited('A,"closed"junk'), /misplaced quote/);
  assert.throws(() => parseDelimited("x".repeat(6001)), /too long/);
});
test("UTF-16 files are decoded explicitly and unknown encodings fail", () => {
  const text = "Our Ref\t45082";
  const bytes = new Uint8Array(2 + text.length * 2);
  bytes.set([255, 254]);
  for (let i = 0; i < text.length; i++) bytes[2 + i * 2] = text.charCodeAt(i);
  assert.equal(decodeText(bytes), text);
  assert.throws(() => decodeText(new Uint8Array([255, 17, 18])), /encoding/);
});
test("the supplier's actual XLSX fixture preserves original addresses and machine dates", async () => {
  const data = new Uint8Array(
    await readFile(
      new URL(
        "../assets/order-samples/packaging-acknowledgement.xlsx",
        import.meta.url,
      ),
    ),
  );
  const sheets = parseWorkbook(data),
    cells = sheets[0].rows.flat();
  assert.equal(sheets[0].name, "Vendor reply");
  assert.equal(cells.find((c) => c.address === "A10").text, "H-G8");
  assert.equal(cells.find((c) => c.address === "E10").text, "BOX");
  assert.equal(cells.find((c) => c.address === "G10").text, "2026-12-10");
  assert.equal(cells.find((c) => c.address === "G10").type, "date");
  assert.equal(cells.find((c) => c.address === "D10").text, "20");
});
test("the unfamiliar workbook is read without a matching table schema", async () => {
  const sheets = parseWorkbook(
    new Uint8Array(
      await readFile(
        new URL(
          "../assets/order-samples/material-release.xlsx",
          import.meta.url,
        ),
      ),
    ),
  );
  const cells = sheets[0].rows.flat();
  assert.equal(cells.find((c) => c.address === "F9").text, "Rate / 100 EA");
  assert.equal(cells.find((c) => c.address === "F10").text, "200");
  assert.equal(cells.find((c) => c.address === "G10").text, "2026-12-05");
});
test("formula results are identified, not executed; hidden sheets stay distinguishable", async () => {
  const book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet("Visible");
  sheet.getCell("C7").value = { formula: "1+1", result: 2 };
  sheet.getCell("D7").value = {
    formula: 'WEBSERVICE("https://example.invalid")',
  };
  book.addWorksheet("Private", { state: "veryHidden" }).getCell("A1").value =
    "Do not upload";
  const data = new Uint8Array(await book.xlsx.writeBuffer());
  const result = parseWorkbook(data);
  assert.equal(result[0].rows[6].find((c) => c.address === "C7").text, "2");
  assert.equal(
    result[0].rows[6].find((c) => c.address === "D7").text,
    "[Formula without a saved result]",
  );
  assert.equal(result[1].hidden, true);
});
test("unsafe archives and XML entity declarations cannot be parsed as ordinary workbooks", () => {
  assert.throws(() => unzipWorkbook(new Uint8Array([1, 2, 3])), /not an XLSX/);
  assert.throws(
    () => unzipWorkbook(zipSync({ "../outside.xml": strToU8("x") })),
    /unsafe/,
  );
  const bad = zipSync({
    "xl/workbook.xml": strToU8(
      '<!DOCTYPE x [<!ENTITY boom "unsafe">]><workbook/>',
    ),
    "xl/_rels/workbook.xml.rels": strToU8("<Relationships/>"),
  });
  assert.throws(() => parseWorkbook(bad), /external entities/);
});
test("source validation rejects numeric substring hallucinations", () => {
  const pair = casePair();
  const value = pair.extraction.documents[0].lines[0].quantity;
  value.raw = "24";
  value.value = "24"; // Source is 240, not 24.
  assert.throws(
    () => validateExtraction(pair.extraction, pair.sources),
    /substring/,
  );
});
test("pixel limits can be checked from image headers before decoding", () => {
  const bytes = new Uint8Array(24),
    view = new DataView(bytes.buffer);
  view.setUint32(0, 0x89504e47);
  view.setUint32(4, 0x0d0a1a0a);
  view.setUint32(16, 50000);
  view.setUint32(20, 50000);
  assert.deepEqual(imageSize(bytes, "png"), [50000, 50000]);
  assert.throws(
    () => imageSize(new Uint8Array(30), "jpeg"),
    /could not be identified/,
  );
});
