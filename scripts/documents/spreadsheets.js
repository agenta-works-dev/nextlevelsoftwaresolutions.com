import { Inflate } from "fflate";
import { SaxesParser } from "saxes";
import { LIMITS, DocumentError } from "./schema.js";

const fail = (message) => {
  throw new DocumentError(message, "spreadsheet_format");
};
export function decodeText(bytes) {
  let encoding = "utf-8";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = "utf-16le";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = "utf-16be";
  try {
    return new TextDecoder(encoding, { fatal: true })
      .decode(bytes)
      .replace(/^\uFEFF/, "");
  } catch {
    fail(
      "This text encoding is not supported. Use a UTF-8 or UTF-16 CSV, or a PDF copy.",
    );
  }
}
export function columnName(index) {
  let name = "";
  for (let n = index; n; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}
export function parseDelimited(text) {
  if (text.length > LIMITS.characters)
    fail("This spreadsheet contains too much text for the free demonstration.");
  text = text.replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "");
  const first = text
    .split("\n")
    .filter((l) => l.trim())
    .slice(0, 12)
    .join("\n");
  const count = (separator) => {
    let quote = false,
      total = 0;
    for (let i = 0; i < first.length; i++) {
      if (first[i] === '"') {
        if (quote && first[i + 1] === '"') i++;
        else quote = !quote;
      } else if (!quote && first[i] === separator) total++;
    }
    return total;
  };
  const delimiter = [",", "\t", ";"].sort((a, b) => count(b) - count(a))[0];
  const rows = [];
  let row = [],
    cell = "",
    quoted = false,
    closed = false,
    cells = 0;
  const endCell = () => {
    row.push(cell);
    cell = "";
    closed = false;
    if (++cells > LIMITS.cells)
      fail("This spreadsheet has too many cells for the demonstration.");
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        closed = true;
      } else cell += c;
    } else if (c === delimiter) endCell();
    else if (c === "\n") endRow();
    else if (c === '"' && !cell && !closed) quoted = true;
    else if (c === '"' || (closed && c !== " "))
      fail(
        "This CSV contains a misplaced quote. Upload the original Excel file or a standard quoted CSV.",
      );
    else if (!closed) cell += c;
    if (cell.length > 6000)
      fail("A spreadsheet cell is too long for the demonstration.");
  }
  if (quoted) fail("A quoted CSV cell is not closed.");
  if (cell || row.length || !rows.length) endRow();
  if (!rows.some((r) => r.some((c) => c.trim())))
    fail("This spreadsheet is empty.");
  return {
    name: "CSV",
    rows: rows.map((r, index) =>
      r.map((value, col) => ({
        address: `${columnName(col + 1)}${index + 1}`,
        row: index + 1,
        column: col + 1,
        text: value,
        type: "text",
        formula: false,
      })),
    ),
  };
}
function xml(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    fail(
      "Document type declarations and external entities are not accepted in workbooks.",
    );
  const parser = new SaxesParser({ xmlns: true });
  const root = { name: "root", children: [], text: "", attrs: {} },
    stack = [root];
  let nodes = 0;
  parser.on("opentag", (tag) => {
    if (++nodes > 100000 || stack.length > 60)
      fail("The workbook XML is too complex.");
    const item = {
      name: tag.local,
      attrs: Object.fromEntries(
        Object.values(tag.attributes).map((a) => [a.name, a.value]),
      ),
      children: [],
      text: "",
    };
    stack[stack.length - 1].children.push(item);
    stack.push(item);
  });
  parser.on("text", (text) => {
    stack[stack.length - 1].text += text;
  });
  parser.on("cdata", (text) => {
    stack[stack.length - 1].text += text;
  });
  parser.on("closetag", () => {
    stack.pop();
  });
  parser.on("error", () => fail("The workbook XML is malformed."));
  try {
    parser.write(text).close();
  } catch (error) {
    if (error instanceof DocumentError) throw error;
    fail("The workbook XML could not be read.");
  }
  return root;
}
const descendants = (node, name) =>
  node.children.flatMap((c) => [
    ...(c.name === name ? [c] : []),
    ...descendants(c, name),
  ]);
const child = (node, name) => node.children.find((c) => c.name === name);
const contents = (node) =>
  node ? node.text + node.children.map(contents).join("") : "";
export function unzipWorkbook(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 22 || view.getUint32(0, true) !== 0x04034b50)
    fail(
      "This is not an XLSX workbook. Legacy .xls files need a PDF or .xlsx copy.",
    );
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (
      view.getUint32(i, true) === 0x06054b50 &&
      i + 22 + view.getUint16(i + 20, true) === bytes.length
    ) {
      end = i;
      break;
    }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true))
    fail("Multi-volume or damaged workbooks are not supported.");
  const count = view.getUint16(end + 10, true),
    directorySize = view.getUint32(end + 12, true),
    start = view.getUint32(end + 16, true);
  if (count === 65535 || count > 2048 || start + directorySize > end)
    fail(
      "This workbook archive is too large or uses unsupported ZIP64 encoding.",
    );
  const entries = new Map();
  let pointer = start,
    expandedTotal = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let i = 0; i < count; i++) {
    if (pointer + 46 > end || view.getUint32(pointer, true) !== 0x02014b50)
      fail("The workbook archive directory is malformed.");
    const flags = view.getUint16(pointer + 8, true),
      method = view.getUint16(pointer + 10, true),
      compressed = view.getUint32(pointer + 20, true),
      expanded = view.getUint32(pointer + 24, true),
      nameLength = view.getUint16(pointer + 28, true),
      extraLength = view.getUint16(pointer + 30, true),
      commentLength = view.getUint16(pointer + 32, true),
      offset = view.getUint32(pointer + 42, true);
    if (pointer + 46 + nameLength + extraLength + commentLength > end)
      fail("The workbook directory is truncated.");
    const name = decoder.decode(
      bytes.subarray(pointer + 46, pointer + 46 + nameLength),
    );
    expandedTotal += expanded;
    if (
      flags & 1 ||
      ![0, 8].includes(method) ||
      compressed === 0xffffffff ||
      expanded === 0xffffffff ||
      expandedTotal > LIMITS.unzippedBytes ||
      expanded > 8 * 1024 * 1024 ||
      name.includes("..") ||
      name.startsWith("/") ||
      name.includes("\\") ||
      entries.has(name)
    )
      fail(
        "This workbook is encrypted, too complex, or contains unsafe archive entries.",
      );
    if (offset + 30 > start || view.getUint32(offset, true) !== 0x04034b50)
      fail("The workbook archive entry is invalid.");
    const dataStart =
      offset +
      30 +
      view.getUint16(offset + 26, true) +
      view.getUint16(offset + 28, true);
    if (dataStart + compressed > start)
      fail("The workbook archive entry is truncated.");
    if (name.endsWith(".xml") || name.endsWith(".rels")) {
      const input = bytes.subarray(dataStart, dataStart + compressed),
        chunks = [];
      let size = 0;
      if (method === 0) {
        if (compressed !== expanded)
          fail("The workbook entry size is inconsistent.");
        chunks.push(input);
        size = input.length;
      } else {
        const inflate = new Inflate((chunk) => {
          size += chunk.length;
          if (size > expanded || size > 8 * 1024 * 1024)
            fail("The workbook expanded beyond its declared limit.");
          chunks.push(chunk);
        });
        try {
          for (let p = 0; p < input.length; p += 2048)
            inflate.push(input.subarray(p, p + 2048), p + 2048 >= input.length);
        } catch (error) {
          if (error instanceof DocumentError) throw error;
          fail("The compressed workbook data is invalid.");
        }
      }
      if (size !== expanded) fail("The workbook entry size is inconsistent.");
      const output = new Uint8Array(size);
      let at = 0;
      for (const chunk of chunks) {
        output.set(chunk, at);
        at += chunk.length;
      }
      entries.set(name, decodeText(output));
    } else entries.set(name, null);
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  if (pointer !== start + directorySize)
    fail("The workbook archive directory size is inconsistent.");
  return entries;
}
function excelDate(value, date1904) {
  const serial = Number(value);
  if (
    !Number.isFinite(serial) ||
    serial < 0 ||
    serial > 110000 ||
    (!date1904 && Math.floor(serial) === 60)
  )
    return null;
  const base = date1904
    ? Date.UTC(1904, 0, 1)
    : serial < 60
      ? Date.UTC(1899, 11, 31)
      : Date.UTC(1899, 11, 30);
  return new Date(base + Math.floor(serial) * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function parseWorkbook(bytes) {
  const entries = unzipWorkbook(bytes);
  if (
    !entries.get("xl/workbook.xml") ||
    !entries.get("xl/_rels/workbook.xml.rels")
  )
    fail("The workbook's worksheets could not be found.");
  if ([...entries.keys()].some((n) => /vbaProject\.bin$/i.test(n)))
    fail(
      "Macro-enabled workbooks are not accepted. Use a redacted .xlsx or PDF copy.",
    );
  const book = xml(entries.get("xl/workbook.xml")),
    rels = xml(entries.get("xl/_rels/workbook.xml.rels"));
  const relationships = new Map(
    descendants(rels, "Relationship")
      .filter((r) => r.attrs.TargetMode !== "External")
      .map((r) => [r.attrs.Id, r.attrs.Target]),
  );
  const dates1904 = ["1", "true"].includes(
    descendants(book, "workbookPr")[0]?.attrs.date1904,
  );
  const shared = entries.get("xl/sharedStrings.xml")
    ? descendants(xml(entries.get("xl/sharedStrings.xml")), "si").map((n) =>
        descendants(n, "t").map(contents).join(""),
      )
    : [];
  const styles = entries.get("xl/styles.xml")
    ? xml(entries.get("xl/styles.xml"))
    : { children: [] };
  const formats = new Map(
    descendants(styles, "numFmt").map((f) => [
      f.attrs.numFmtId,
      f.attrs.formatCode,
    ]),
  );
  const xfs = descendants(styles, "cellXfs")[0]?.children || [];
  const hasDateStyle = (index) => {
    const id = Number(xfs[Number(index)]?.attrs.numFmtId || 0);
    const fmt = (formats.get(String(id)) || "").replace(
      /"[^"]*"|\\.|\[[^\]]*\]/g,
      "",
    );
    return (id >= 14 && id <= 17) || id === 22 || /[dy]/i.test(fmt);
  };
  const sheets = descendants(book, "sheet");
  if (!sheets.length || sheets.length > LIMITS.sheets)
    fail(`Use a workbook with 1–${LIMITS.sheets} sheets.`);
  let count = 0,
    characters = 0;
  return sheets.map((sheet) => {
    const target = relationships.get(sheet.attrs["r:id"]);
    if (
      !target ||
      target.includes("..") ||
      target.includes(":") ||
      target.includes("\\")
    )
      fail("The worksheet reference is invalid.");
    const path = target.startsWith("/") ? target.slice(1) : "xl/" + target;
    if (!entries.get(path)) fail("A worksheet is missing from the workbook.");
    const document = xml(entries.get(path)),
      rows = [];
    for (const cell of descendants(document, "c")) {
      const address = cell.attrs.r,
        match = address?.match(/^([A-Z]{1,3})([1-9]\d{0,5})$/);
      if (!match) fail("A workbook cell has an invalid address.");
      const row = Number(match[2]),
        column = [...match[1]].reduce(
          (n, c) => n * 26 + c.charCodeAt(0) - 64,
          0,
        );
      if (row > 2000 || column > 100 || ++count > LIMITS.cells)
        fail("This workbook is too large for the demonstration.");
      const v = contents(child(cell, "v")),
        formula = Boolean(child(cell, "f"));
      let value =
        cell.attrs.t === "s"
          ? shared[Number(v)]
          : cell.attrs.t === "inlineStr"
            ? descendants(cell, "t").map(contents).join("")
            : cell.attrs.t === "b"
              ? v === "1"
                ? "TRUE"
                : "FALSE"
              : v;
      if (value === undefined) fail("A shared workbook string is missing.");
      let type = cell.attrs.t === "n" || !cell.attrs.t ? "number" : "text";
      if (type === "number" && v && hasDateStyle(cell.attrs.s)) {
        const parsed = excelDate(v, dates1904);
        if (parsed) {
          value = parsed;
          type = "date";
        }
      }
      if (formula && !v) value = "[Formula without a saved result]";
      characters += value.length;
      if (characters > LIMITS.characters || value.length > 6000)
        fail("This workbook contains too much text for the demonstration.");
      rows[row - 1] ||= [];
      rows[row - 1].push({
        address,
        row,
        column,
        text: value,
        type,
        formula,
        numberFormat:
          formats.get(xfs[Number(cell.attrs.s)]?.attrs.numFmtId) || null,
      });
    }
    return {
      name: sheet.attrs.name,
      hidden: sheet.attrs.state && sheet.attrs.state !== "visible",
      rows: Array.from({ length: rows.length }, (_, index) =>
        (rows[index] || []).sort((a, b) => a.column - b.column),
      ),
    };
  });
}
