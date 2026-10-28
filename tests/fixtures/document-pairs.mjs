import { createHash } from "node:crypto";
import { parseDelimited } from "../../scripts/documents/spreadsheets.js";
import {
  emptyField,
  DOCUMENT_FIELDS,
  LINE_FIELDS,
  validateExtraction,
} from "../../scripts/documents/schema.js";

export function sourceFromCSV(id, text, name = id + ".csv") {
  const hash = createHash("sha256").update(text).digest("hex"),
    sheet = parseDelimited(text),
    prefix = `${id}:${hash.slice(0, 16)}`;
  return {
    id,
    name,
    format: "csv",
    hash,
    pages: [],
    sheets: [sheet],
    warnings: [],
    anchors: sheet.rows.flatMap((r) =>
      r
        .filter((c) => c.text.trim())
        .map((c) => ({
          id: `${prefix}:s1:${c.address}`,
          kind: "cell",
          sheet: sheet.name,
          cell: c.address,
          text: c.text,
          label: `CSV!${c.address}`,
        })),
    ),
  };
}
export function fieldAt(source, address, value = undefined) {
  const anchor = source.anchors.find((a) => a.cell === address);
  if (!anchor) return emptyField();
  return {
    raw: anchor.text,
    value: value ?? anchor.text,
    certainty: "clear",
    issue: null,
    evidence: [{ anchorId: anchor.id, quote: anchor.text, bbox: null }],
  };
}
export function mappingAt(source, field, address) {
  const anchor = source.anchors.find((a) => a.cell === address);
  return {
    field,
    label: anchor.text,
    location: `CSV column ${address.replace(/\d/g, "")}`,
    evidence: [{ anchorId: anchor.id, quote: anchor.text, bbox: null }],
  };
}
function doc(source) {
  return {
    id: source.id,
    type: source.id === "po" ? "purchase_order" : "acknowledgement",
    ...Object.fromEntries(DOCUMENT_FIELDS.map((f) => [f, emptyField()])),
    lines: [],
    conditions: [],
    mappings: [],
    warnings: [],
  };
}
export function line(source, id, row, columns) {
  return {
    id,
    dateKind: "delivery",
    ...Object.fromEntries(
      LINE_FIELDS.map((f) => [
        f,
        columns[f] ? fieldAt(source, columns[f] + row) : emptyField(),
      ]),
    ),
    schedules: [],
    notes: [],
  };
}
export function casePair({
  next = false,
  buyerReference = false,
  unit = "BOX",
  ackQuantity = next ? "15" : "20",
  ackPrice = "9.60",
  poQuantity = next ? "180" : "240",
  poUnit = "EA",
  poPrice = "0.75",
  reference = next ? "45083" : "45082",
} = {}) {
  const poSource = sourceFromCSV(
    "po",
    `Purchase order,${reference}\nSupplier,Harbor Components\nCustomer,Northstar Demo Manufacturing\nCurrency,USD\n\nInternal SKU,Description,Qty,Unit,Price each,Currency,Need by,Extended\nGSK-8,8 mm silicone gasket,${poQuantity},${poUnit},${poPrice},USD,2026-12-10,${Number(poQuantity) * Number(poPrice)}\nPricing basis,1,${poUnit}`,
  );
  const ackSource = sourceFromCSV(
    "ack",
    `Confirmation,ACK-9017\nBuyer reference,${reference}\nSold to,Northstar Demo Manufacturing\nIssued by,Harbor Components\nCurrency,USD\nOur SKU,Customer item,Confirmed,Pack,Net each,Money,Arrives,Line value\nH-G8,${buyerReference ? "GSK-8" : ""},${ackQuantity},${unit},${ackPrice},USD,2026-12-10,${Number(ackQuantity) * Number(ackPrice)}\nPricing basis,1,${unit}`,
  );
  const po = doc(poSource),
    ack = doc(ackSource);
  po.documentNumber = fieldAt(poSource, "B1");
  po.supplier = fieldAt(poSource, "B2");
  po.customer = fieldAt(poSource, "B3");
  po.currency = fieldAt(poSource, "B4");
  ack.documentNumber = fieldAt(ackSource, "B1");
  ack.orderReference = fieldAt(ackSource, "B2");
  ack.customer = fieldAt(ackSource, "B3");
  ack.supplier = fieldAt(ackSource, "B4");
  ack.currency = fieldAt(ackSource, "B5");
  po.lines = [
    line(poSource, "P1", 7, {
      buyerPart: "A",
      description: "B",
      quantity: "C",
      unit: "D",
      unitPrice: "E",
      currency: "F",
      date: "G",
      extendedPrice: "H",
    }),
  ];
  ack.lines = [
    line(ackSource, "A1", 7, {
      supplierPart: "A",
      buyerPart: "B",
      quantity: "C",
      unit: "D",
      unitPrice: "E",
      currency: "F",
      date: "G",
      extendedPrice: "H",
    }),
  ];
  po.lines[0].priceBasisQuantity = fieldAt(poSource, "B8");
  po.lines[0].priceBasisUnit = fieldAt(poSource, "C8");
  ack.lines[0].priceBasisQuantity = fieldAt(ackSource, "B8");
  ack.lines[0].priceBasisUnit = fieldAt(ackSource, "C8");
  po.mappings = [
    mappingAt(poSource, "documentNumber", "A1"),
    mappingAt(poSource, "line.buyerPart", "A6"),
    mappingAt(poSource, "line.quantity", "C6"),
    mappingAt(poSource, "line.unitPrice", "E6"),
    mappingAt(poSource, "line.date", "G6"),
  ];
  ack.mappings = [
    mappingAt(ackSource, "orderReference", "A2"),
    mappingAt(ackSource, "line.supplierPart", "A6"),
    mappingAt(ackSource, "line.quantity", "C6"),
    mappingAt(ackSource, "line.unitPrice", "E6"),
    mappingAt(ackSource, "line.date", "G6"),
  ];
  const sources = [poSource, ackSource];
  return {
    sources,
    extraction: validateExtraction(
      {
        schemaVersion: 1,
        documents: [po, ack],
        links: [
          {
            poIds: ["P1"],
            ackIds: ["A1"],
            reason:
              "The descriptions and order reference suggest a correspondence, but the supplier code needs confirmation.",
            evidence: [
              ...po.lines[0].buyerPart.evidence,
              ...ack.lines[0].supplierPart.evidence,
            ],
            splitExplicit: false,
          },
        ],
        uncertainties: [],
      },
      sources,
    ),
  };
}
export function splitPair({ explicit = true } = {}) {
  const poSource = sourceFromCSV(
    "po",
    "PO,45084\nSupplier,Harbor Components\nCustomer,Northstar Demo Manufacturing\nCurrency,USD\n\nInternal SKU,Description,Qty,Unit,Price each,Currency,Need by,Extended\nNX-204,Aluminum housing rev C,120,EA,24.00,USD,2026-12-10,2880.00",
  );
  const ackSource = sourceFromCSV(
    "ack",
    "Confirmation,ACK-9021\nBuyer reference,45084\nSold to,Northstar Demo Manufacturing\nIssued by,Harbor Components\nCurrency,USD\nOur SKU,Customer item,Scheduled quantity,Pack,Net each,Money,Arrival,Line value\nHC-A20,NX-204,60,EA,24.00,USD,2026-12-12,1440.00\nHC-A20,NX-204,60,EA,24.00,USD,2026-12-18,1440.00",
  );
  const po = doc(poSource),
    ack = doc(ackSource);
  for (const [target, source, fields] of [
    [
      po,
      poSource,
      { documentNumber: "B1", supplier: "B2", customer: "B3", currency: "B4" },
    ],
    [
      ack,
      ackSource,
      {
        documentNumber: "B1",
        orderReference: "B2",
        customer: "B3",
        supplier: "B4",
        currency: "B5",
      },
    ],
  ])
    for (const [key, address] of Object.entries(fields))
      target[key] = fieldAt(source, address);
  po.lines = [
    line(poSource, "P1", 7, {
      buyerPart: "A",
      description: "B",
      quantity: "C",
      unit: "D",
      unitPrice: "E",
      currency: "F",
      date: "G",
      extendedPrice: "H",
    }),
  ];
  ack.lines = [7, 8].map((row, index) =>
    line(ackSource, `A${index + 1}`, row, {
      supplierPart: "A",
      buyerPart: "B",
      quantity: "C",
      unit: "D",
      unitPrice: "E",
      currency: "F",
      date: "G",
      extendedPrice: "H",
    }),
  );
  po.mappings = [
    mappingAt(poSource, "documentNumber", "A1"),
    mappingAt(poSource, "line.quantity", "C6"),
    mappingAt(poSource, "line.unitPrice", "E6"),
    mappingAt(poSource, "line.date", "G6"),
  ];
  ack.mappings = [
    mappingAt(ackSource, "orderReference", "A2"),
    mappingAt(ackSource, "line.quantity", "C6"),
    mappingAt(ackSource, "line.unitPrice", "E6"),
    mappingAt(ackSource, "line.date", "G6"),
  ];
  const sources = [poSource, ackSource];
  return {
    sources,
    extraction: validateExtraction(
      {
        schemaVersion: 1,
        documents: [po, ack],
        links: [
          {
            poIds: ["P1"],
            ackIds: ["A1", "A2"],
            reason:
              "The acknowledgement explicitly schedules two deliveries for the ordered customer part.",
            evidence: [fieldAt(ackSource, "C6").evidence[0]],
            splitExplicit: explicit,
          },
        ],
        uncertainties: [],
      },
      sources,
    ),
  };
}
