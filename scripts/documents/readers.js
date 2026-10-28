import { LIMITS, DocumentError } from "./schema.js";
import { parseDelimited, parseWorkbook, decodeText } from "./spreadsheets.js";
import { pageTextAnchors } from "./page-text.js";

export async function sha256(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
export function imageSize(bytes, format) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    format === "png" &&
    bytes.length >= 24 &&
    v.getUint32(0) === 0x89504e47 &&
    v.getUint32(4) === 0x0d0a1a0a
  )
    return [v.getUint32(16), v.getUint32(20)];
  if (
    ["jpg", "jpeg"].includes(format) &&
    bytes[0] === 255 &&
    bytes[1] === 216
  ) {
    for (let at = 2; at + 9 < bytes.length;) {
      if (bytes[at] !== 255) break;
      const code = bytes[at + 1];
      if (code === 255) {
        at++;
        continue;
      }
      const length = v.getUint16(at + 2);
      if (length < 2 || at + 2 + length > bytes.length) break;
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(code)
      )
        return [v.getUint16(at + 7), v.getUint16(at + 5)];
      at += 2 + length;
    }
  }
  if (
    format === "webp" &&
    bytes.length >= 30 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  ) {
    const kind = String.fromCharCode(...bytes.subarray(12, 16));
    if (kind === "VP8X")
      return [
        1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
        1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
      ];
    if (
      kind === "VP8 " &&
      bytes[23] === 0x9d &&
      bytes[24] === 0x01 &&
      bytes[25] === 0x2a
    )
      return [v.getUint16(26, true) & 0x3fff, v.getUint16(28, true) & 0x3fff];
    if (kind === "VP8L" && bytes[20] === 0x2f) {
      const packed = v.getUint32(21, true);
      return [(packed & 0x3fff) + 1, ((packed >>> 14) & 0x3fff) + 1];
    }
  }
  throw new DocumentError(
    "This image could not be identified. Use a PNG, JPEG, or WebP copy.",
  );
}
function canvasImage(canvas) {
  return canvas.toDataURL("image/jpeg", 0.84);
}
function bounded(source) {
  if (
    !source.anchors.length ||
    source.anchors.length > LIMITS.anchors ||
    source.anchors.reduce((sum, a) => sum + (a.text?.length || 0), 0) >
      LIMITS.characters
  )
    throw new DocumentError(
      "This document contains too much text for the free demonstration. Use a smaller redacted excerpt.",
      "document_limit",
    );
  return source;
}
export async function readDocument(
  file,
  id,
  { includeHidden = false, onProgress = () => {} } = {},
) {
  if (
    !["po", "ack"].includes(id) ||
    !file ||
    file.size <= 0 ||
    file.size > LIMITS.fileBytes
  )
    throw new DocumentError(
      "Choose a non-empty document up to 10 MB.",
      "document_limit",
    );
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = await sha256(bytes),
    prefix = `${id}:${hash.slice(0, 16)}`;
  const extension = file.name.toLowerCase().split(".").pop();
  const source = {
    id,
    name: file.name.slice(0, 150),
    hash,
    bytes: bytes.length,
    format: "",
    anchors: [],
    pages: [],
    sheets: [],
    warnings: [],
  };
  onProgress(`Reading ${source.name}…`);
  if (extension === "csv" || extension === "tsv") {
    source.format = "csv";
    source.sheets = [parseDelimited(decodeText(bytes))];
  } else if (extension === "xlsx") {
    source.format = "xlsx";
    const all = parseWorkbook(bytes);
    source.sheets = all.filter((s) => includeHidden || !s.hidden);
    if (source.sheets.length !== all.length)
      source.warnings.push(
        `${all.length - source.sheets.length} hidden worksheet(s) were excluded. Only the visible sheets are analyzed.`,
      );
    if (source.sheets.some((s) => s.rows.some((r) => r.some((c) => c.formula))))
      source.warnings.push(
        "Workbook formulas use their saved results and are not recalculated. A formula without a saved result remains unreadable.",
      );
    if (!source.sheets.length)
      throw new DocumentError(
        "There are no visible worksheets in this file. Choose whether to include hidden sheets before analysis.",
      );
  } else if (extension === "pdf") {
    source.format = "pdf";
    const pdfjs = await import("pdfjs-dist");
    const assetBase = new URL(`./pdfjs-${pdfjs.version}/`, import.meta.url)
      .href;
    pdfjs.GlobalWorkerOptions.workerSrc = assetBase + "pdf.worker.min.mjs";
    const task = pdfjs.getDocument({
      data: bytes.slice(),
      isEvalSupported: false,
      enableXfa: false,
      stopAtErrors: true,
      cMapUrl: assetBase + "cmaps/",
      cMapPacked: true,
      standardFontDataUrl: assetBase + "standard_fonts/",
      wasmUrl: assetBase + "wasm/",
    });
    let pdf;
    try {
      pdf = await task.promise;
    } catch (error) {
      await task.destroy();
      throw new DocumentError(
        error.name === "PasswordException"
          ? "This PDF is password protected. Use an unlocked, redacted copy."
          : "This PDF could not be read. Try a new PDF export or image copy.",
      );
    }
    try {
      if (pdf.numPages > LIMITS.pages)
        throw new DocumentError(
          `Use up to ${LIMITS.pages} pages per document for the free demonstration.`,
          "document_limit",
        );
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        onProgress(
          `Reading ${source.name}, page ${pageNumber} of ${pdf.numPages}…`,
        );
        const page = await pdf.getPage(pageNumber),
          normal = page.getViewport({ scale: 1 });
        const scale = Math.min(
          LIMITS.imageSide / normal.width,
          LIMITS.imageSide / normal.height,
          2.5,
        );
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.min(LIMITS.imageSide, Math.ceil(viewport.width));
        canvas.height = Math.min(LIMITS.imageSide, Math.ceil(viewport.height));
        const context = canvas.getContext("2d");
        await page.render({ canvasContext: context, viewport, canvas }).promise;
        const pageId = `${prefix}:p${pageNumber}`;
        source.pages.push({
          id: pageId,
          number: pageNumber,
          width: canvas.width,
          height: canvas.height,
          image: canvasImage(canvas),
        });
        source.anchors.push({
          id: pageId,
          kind: "page",
          page: pageNumber,
          text: "",
          bbox: [0, 0, 1, 1],
          label: `Page ${pageNumber}`,
        });
        source.anchors.push(
          ...pageTextAnchors(
            await page.getTextContent(),
            viewport,
            canvas.width,
            canvas.height,
            pageId,
            pageNumber,
            pdfjs.Util.transform,
          ),
        );
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();
        bounded(source);
      }
    } finally {
      await task.destroy();
    }
  } else if (["png", "jpg", "jpeg", "webp"].includes(extension)) {
    source.format = "image";
    const [width, height] = imageSize(bytes, extension);
    if (!width || !height || width * height > 24000000)
      throw new DocumentError(
        "Use an image up to 24 megapixels. A smaller redacted copy will be easier to inspect.",
        "document_limit",
      );
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      throw new DocumentError(
        "This image could not be decoded. Try a PNG or JPEG copy.",
      );
    }
    const scale = Math.min(
      1,
      LIMITS.imageSide / bitmap.width,
      LIMITS.imageSide / bitmap.height,
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const pageId = prefix + ":p1";
    source.pages.push({
      id: pageId,
      number: 1,
      width: canvas.width,
      height: canvas.height,
      image: canvasImage(canvas),
    });
    source.anchors.push({
      id: pageId,
      kind: "page",
      page: 1,
      text: "",
      bbox: [0, 0, 1, 1],
      label: "Image 1",
    });
    canvas.width = 0;
    canvas.height = 0;
  } else
    throw new DocumentError(
      "Supported files are PDF, PNG, JPEG, WebP, XLSX, CSV, and TSV. Legacy XLS, HEIC, TIFF, and macro-enabled workbooks need a supported copy.",
      "document_format",
    );
  if (source.sheets.length)
    source.sheets.forEach((sheet, index) => {
      for (const row of sheet.rows)
        for (const cell of row)
          if (cell.text.trim())
            source.anchors.push({
              id: `${prefix}:s${index + 1}:${cell.address}`,
              kind: "cell",
              sheet: sheet.name,
              cell: cell.address,
              row: cell.row,
              column: cell.column,
              text: cell.text,
              valueType: cell.type,
              formula: cell.formula,
              label: `${sheet.name}!${cell.address}`,
            });
    });
  return bounded(source);
}

export function sourceForAPI(source) {
  return {
    id: source.id,
    name: source.name,
    hash: source.hash,
    format: source.format,
    anchors: source.anchors,
    pages: source.pages,
    warnings: source.warnings,
  };
}
