import {
  DOCUMENT_FIELDS,
  LINE_FIELDS,
  emptyField,
  validateExtraction,
  DocumentError,
} from "./schema.js";

export const SAMPLES = {
  units: {
    title: "Packaging and part relationships",
    files: ["packaging-order.pdf", "packaging-acknowledgement.xlsx"],
  },
  repeat: {
    title: "Another order with a familiar form",
    files: ["packaging-order-next.pdf", "packaging-acknowledgement-next.xlsx"],
  },
  split: {
    title: "Split deliveries from a scanned acknowledgement",
    files: ["split-order.pdf", "split-acknowledgement.png"],
  },
  unfamiliar: {
    title: "Material release and dispatch advice",
    files: ["material-release.xlsx", "release-acknowledgement.csv"],
  },
};
const norm = (s) => String(s).normalize("NFKC").replace(/\s+/g, " ").trim();
function document(source) {
  return {
    id: source.id,
    type: source.id === "po" ? "purchase_order" : "acknowledgement",
    ...Object.fromEntries(DOCUMENT_FIELDS.map((k) => [k, emptyField()])),
    lines: [],
    mappings: [],
    conditions: [],
    warnings: [],
  };
}
function line(id, fields, options = {}) {
  return {
    id,
    ...Object.fromEntries(LINE_FIELDS.map((k) => [k, emptyField()])),
    dateKind: "delivery",
    schedules: [],
    notes: [],
    ...fields,
    ...options,
  };
}
function anchor(source, text, where = {}) {
  const found = source.anchors.find(
    (a) =>
      (!where.cell || a.cell === where.cell) &&
      (!where.contains || norm(a.text).includes(norm(where.contains))) &&
      norm(a.text).includes(norm(text)),
  );
  if (!found)
    throw new DocumentError(
      `The prepared reading “${text}” was not found in ${source.name}. The sample is not being substituted for an AI interpretation.`,
      "sample_source",
    );
  return found;
}
function fact(source, text, where = {}) {
  if (text === null) return emptyField();
  const a = where.bbox
    ? source.anchors.find((a) => a.kind === "page")
    : anchor(source, text, where);
  const quote = a.text || text;
  return {
    raw: text,
    value: where.value ?? text,
    certainty: "clear",
    issue: null,
    evidence: [{ anchorId: a.id, quote, bbox: where.bbox || null }],
  };
}
function map(doc, source, field, label, where = {}) {
  const f = fact(source, label, where),
    a = source.anchors.find((a) => a.id === f.evidence[0].anchorId);
  doc.mappings.push({ field, label, location: a.label, evidence: f.evidence });
}
function purchaseOrder(source, key) {
  const d = document(source),
    isSplit = key === "split",
    next = key === "repeat";
  d.documentNumber = fact(source, isSplit ? "45084" : next ? "45083" : "45082");
  d.customer = fact(source, "Northstar Demo Manufacturing", {
    contains: "Customer:",
  });
  d.supplier = fact(source, "Harbor Components", { contains: "Supplier:" });
  d.currency = fact(source, "USD", { contains: "Currency:" });
  const f = (v) => fact(source, v, { contains: isSplit ? "NX-204" : "GSK-8" });
  d.lines = [
    line("P1", {
      buyerPart: f(isSplit ? "NX-204" : "GSK-8"),
      description: f(
        isSplit ? "Aluminum housing rev C" : "8 mm silicone gasket",
      ),
      quantity: f(isSplit ? "120" : next ? "180" : "240"),
      unit: f("EA"),
      unitPrice: f(isSplit ? "24.00" : "0.75"),
      extendedPrice: f(isSplit ? "2880.00" : next ? "135.00" : "180.00"),
      priceBasisQuantity: fact(source, "1", { contains: "All unit prices" }),
      priceBasisUnit: fact(source, "EA", { contains: "All unit prices" }),
      date: fact(source, "Dec 10, 2026", { contains: "Requested arrival:" }),
    }),
  ];
  for (const [field, label] of [
    ["documentNumber", "PURCHASE ORDER"],
    ["customer", "Customer:"],
    ["supplier", "Supplier:"],
    ["currency", "Currency:"],
    ["line.buyerPart", "Our item"],
    ["line.quantity", "Order"],
    ["line.unit", "UOM"],
    ["line.unitPrice", "Price each"],
    ["line.extendedPrice", "Net value"],
    ["line.date", "Requested arrival:"],
  ])
    map(d, source, field, label);
  return d;
}
function packagingReply(source, next) {
  const d = document(source),
    f = (text, cell) => fact(source, text, { cell });
  d.documentNumber = f("ACK-9017", "B3");
  d.orderReference = f(next ? "45083" : "45082", "B4");
  d.supplier = f("Harbor Components", "F3");
  d.customer = f("Northstar Demo Manufacturing", "B5");
  d.currency = f("USD", "B6");
  d.lines = [
    line("A1", {
      supplierPart: f("H-G8", "A10"),
      description: f("Silicone seal 8mm", "C10"),
      quantity: f(next ? "15" : "20", "D10"),
      unit: f("BOX", "E10"),
      unitPrice: f("9.6", "F10"),
      extendedPrice: f(next ? "144" : "192", "H10"),
      date: f("2026-12-10", "G10"),
    }),
  ];
  for (const [field, cell] of [
    ["documentNumber", "A3"],
    ["orderReference", "A4"],
    ["supplier", "E3"],
    ["customer", "A5"],
    ["currency", "A6"],
    ["line.supplierPart", "A9"],
    ["line.quantity", "D9"],
    ["line.unit", "E9"],
    ["line.unitPrice", "F9"],
    ["line.date", "G9"],
    ["line.extendedPrice", "H9"],
  ]) {
    const a = source.anchors.find((a) => a.cell === cell);
    map(d, source, field, a.text, { cell });
  }
  return d;
}
function scannedReply(source) {
  const d = document(source),
    box = (x, y, w, h = 18) => [
      x / 612,
      (792 - y - 4) / 792,
      (x + w) / 612,
      (792 - y + h) / 792,
    ];
  const f = (text, x, y, w, h) => fact(source, text, { bbox: box(x, y, w, h) });
  d.documentNumber = f("ACK-9021", 179, 616, 120);
  d.orderReference = f("45084", 179, 637, 75);
  d.customer = f("Northstar Demo Manufacturing", 179, 658, 310);
  d.supplier = f("HARBOR COMPONENTS", 44, 724, 420, 32);
  d.currency = f("USD", 297, 516, 28);
  const fields = {
    buyerPart: f("NX-204", 142, 578, 100),
    supplierPart: f("HC-A20", 396, 578, 100),
    quantity: f("120", 280, 383, 30),
    unit: f("EA", 310, 383, 25),
    unitPrice: f("24.00", 250, 479, 50),
    priceBasisQuantity: f("1", 222, 324, 10),
    priceBasisUnit: f("EA", 237, 324, 25),
    extendedPrice: f("2880.00", 294, 361, 80),
  };
  d.lines = [
    line("A1", fields, {
      schedules: [
        {
          id: "S1",
          quantity: f("60", 125, 479, 20),
          unit: f("EA", 188, 479, 20),
          date: f("Dec 12, 2026", 355, 479, 118),
          dateKind: "delivery",
        },
        {
          id: "S2",
          quantity: f("60", 125, 439, 20),
          unit: f("EA", 188, 439, 20),
          date: f("Dec 18, 2026", 355, 439, 118),
          dateKind: "delivery",
        },
      ],
    }),
  ];
  for (const [field, label, x, y, w] of [
    ["orderReference", "Customer PO:", 44, 637, 120],
    ["customer", "Sold to:", 44, 658, 100],
    ["line.buyerPart", "Customer item:", 44, 578, 100],
    ["line.supplierPart", "Our ref:", 337, 578, 62],
    ["line.quantity", "Commit qty", 103, 516, 76],
    ["line.unit", "UOM", 188, 516, 35],
    ["line.unitPrice", "Net each USD", 235, 516, 100],
    ["line.date", "Promised arrival", 351, 516, 130],
    ["line.schedules", "SCHEDULED DELIVERIES", 44, 546, 270],
  ])
    map(d, source, field, label, { bbox: box(x, y, w) });
  d.warnings = [
    "This prepared sample contains image transcriptions. The highlighted image regions let you inspect each reading.",
  ];
  return d;
}
function release(source) {
  const d = document(source),
    f = (text, cell) => fact(source, text, { cell });
  d.documentNumber = f("R-731", "F3");
  d.customer = f("Northstar Demo Manufacturing", "D6");
  d.supplier = f("Meridian Precision Demo", "D5");
  d.currency = f("USD", "G5");
  d.lines = [
    line("P1", {
      buyerPart: f("BR-110", "B10"),
      description: f("Mounting bracket, 110 mm", "C10"),
      quantity: f("150", "D10"),
      unit: f("EA", "E10"),
      unitPrice: f("200", "F10"),
      priceBasisQuantity: f("100", "F9"),
      priceBasisUnit: f("EA", "F9"),
      extendedPrice: f("300", "H10"),
      date: f("2026-12-05", "G10"),
    }),
  ];
  for (const [field, cell] of [
    ["documentNumber", "B3"],
    ["customer", "B6"],
    ["supplier", "B5"],
    ["currency", "F5"],
    ["line.buyerPart", "B9"],
    ["line.quantity", "D9"],
    ["line.unit", "E9"],
    ["line.unitPrice", "F9"],
    ["line.date", "G9"],
    ["line.extendedPrice", "H9"],
  ]) {
    const a = source.anchors.find((a) => a.cell === cell);
    map(d, source, field, a.text, { cell });
  }
  return d;
}
function dispatch(source) {
  const d = document(source),
    f = (text, cell) => fact(source, text, { cell });
  d.documentNumber = f("M-2001", "B1");
  d.orderReference = f("R-731", "B2");
  d.supplier = f("Meridian Precision Demo", "B3");
  d.customer = f("Northstar Demo Manufacturing", "B4");
  d.currency = f("USD", "B5");
  d.lines = [
    line(
      "A1",
      {
        buyerPart: f("BR-110", "A8"),
        supplierPart: f("MP-BR110", "B8"),
        quantity: f("150", "C8"),
        unit: f("EA", "D8"),
        unitPrice: f("2.10", "E8"),
        priceBasisQuantity: f("1", "E7"),
        priceBasisUnit: f("EA", "E7"),
        date: f("2026-12-01", "F8"),
        extendedPrice: f("315.00", "G8"),
      },
      { dateKind: "shipment" },
    ),
    line(
      "A2",
      {
        buyerPart: f("BR-112", "A9"),
        supplierPart: f("MP-BR112", "B9"),
        quantity: f("10", "C9"),
        unit: f("EA", "D9"),
        unitPrice: f("2.50", "E9"),
        priceBasisQuantity: f("1", "E7"),
        priceBasisUnit: f("EA", "E7"),
        date: f("2026-12-03", "F9"),
        extendedPrice: f("25.00", "G9"),
      },
      { dateKind: "shipment" },
    ),
  ];
  for (const [field, cell] of [
    ["documentNumber", "A1"],
    ["orderReference", "A2"],
    ["supplier", "A3"],
    ["customer", "A4"],
    ["currency", "A5"],
    ["line.buyerPart", "A7"],
    ["line.supplierPart", "B7"],
    ["line.quantity", "C7"],
    ["line.unit", "D7"],
    ["line.unitPrice", "E7"],
    ["line.date", "F7"],
    ["line.extendedPrice", "G7"],
  ]) {
    const a = source.anchors.find((a) => a.cell === cell);
    map(d, source, field, a.text, { cell });
  }
  return d;
}
// Prepared readings apply only to these exact published sample files. Unknown
// visitor documents always require the configured AI service; there is no mock fallback.
export function preparedSample(key, sources, manifest) {
  if (
    !SAMPLES[key] ||
    sources.some(
      (source, i) =>
        source.name !== SAMPLES[key].files[i] ||
        manifest[source.name] !== source.hash,
    )
  )
    throw new DocumentError(
      "Prepared readings are available only for the unchanged fictional sample files.",
      "sample_source",
    );
  const po =
    key === "unfamiliar" ? release(sources[0]) : purchaseOrder(sources[0], key);
  const ack =
    key === "unfamiliar"
      ? dispatch(sources[1])
      : key === "split"
        ? scannedReply(sources[1])
        : packagingReply(sources[1], key === "repeat");
  const extraction = validateExtraction(
    {
      schemaVersion: 1,
      documents: [po, ack],
      links:
        key === "units" || key === "repeat"
          ? [
              {
                poIds: ["P1"],
                ackIds: ["A1"],
                reason:
                  "The gasket descriptions suggest a possible relationship, but the supplier reference H-G8 is not the customer's GSK-8. Please confirm the part correspondence.",
                splitExplicit: false,
                evidence: ack.lines[0].description.evidence,
              },
            ]
          : [],
      uncertainties: [],
    },
    sources,
  );
  return {
    extraction,
    receipt: {
      mode: "prepared",
      provider: null,
      model: null,
      sample: key,
      generatedAt: new Date().toISOString(),
      requestId: null,
      sourceHashes: sources.map((s) => ({ role: s.id, hash: s.hash })),
    },
  };
}
