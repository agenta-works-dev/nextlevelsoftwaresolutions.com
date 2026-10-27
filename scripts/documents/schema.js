import { decimal, equal } from "./numbers.js";
import { printedSpanPresent } from "./source-span.js";
export const SCHEMA_VERSION = 1;
export const DOCUMENT_FIELDS = [
  "documentNumber",
  "orderReference",
  "customer",
  "supplier",
  "currency",
];
export const LINE_FIELDS = [
  "buyerPart",
  "supplierPart",
  "description",
  "quantity",
  "unit",
  "unitPrice",
  "priceBasisQuantity",
  "priceBasisUnit",
  "extendedPrice",
  "currency",
  "date",
];
export const LIMITS = Object.freeze({
  fileBytes: 10 * 1024 * 1024,
  pages: 8,
  lines: 80,
  anchors: 1600,
  characters: 90000,
  imageSide: 1800,
  cells: 8000,
  sheets: 8,
  unzippedBytes: 24 * 1024 * 1024,
});
const object = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const string = { type: "string" };
const nullableString = { type: ["string", "null"] };
const array = (items) => ({ type: "array", items });
export const evidenceSchema = object({
  anchorId: string,
  quote: string,
  bbox: {
    anyOf: [
      { type: "null" },
      { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
    ],
  },
});
export const fieldSchema = object({
  raw: nullableString,
  value: nullableString,
  certainty: { type: "string", enum: ["clear", "uncertain", "missing"] },
  issue: nullableString,
  evidence: array(evidenceSchema),
});
const scheduleSchema = object({
  id: string,
  quantity: fieldSchema,
  unit: fieldSchema,
  date: fieldSchema,
  dateKind: { type: "string", enum: ["delivery", "shipment", "unknown"] },
});
const lineSchema = object({
  id: string,
  ...Object.fromEntries(LINE_FIELDS.map((name) => [name, fieldSchema])),
  dateKind: { type: "string", enum: ["delivery", "shipment", "unknown"] },
  schedules: array(scheduleSchema),
  notes: array(fieldSchema),
});
const mappingSchema = object({
  field: string,
  label: string,
  location: string,
  evidence: array(evidenceSchema),
});
const documentSchema = object({
  id: { type: "string", enum: ["po", "ack"] },
  type: {
    type: "string",
    enum: ["purchase_order", "acknowledgement", "unknown"],
  },
  ...Object.fromEntries(DOCUMENT_FIELDS.map((name) => [name, fieldSchema])),
  lines: array(lineSchema),
  conditions: array(fieldSchema),
  mappings: array(mappingSchema),
  warnings: array(string),
});
export const extractionSchema = object({
  schemaVersion: { type: "integer", enum: [1] },
  documents: array(documentSchema),
  links: array(
    object({
      poIds: array(string),
      ackIds: array(string),
      reason: string,
      evidence: array(evidenceSchema),
      splitExplicit: { type: "boolean" },
    }),
  ),
  uncertainties: array({
    anyOf: [
      string,
      object({
        message: string,
        kind: { type: "string", enum: ["relationship", "other"] },
        poIds: array(string),
        ackIds: array(string),
      }),
    ],
  }),
});
export function emptyField() {
  return {
    raw: null,
    value: null,
    certainty: "missing",
    issue: null,
    evidence: [],
  };
}
export class DocumentError extends Error {
  constructor(message, code = "invalid_document") {
    super(message);
    this.name = "DocumentError";
    this.code = code;
  }
}
function assert(condition, message) {
  if (!condition) throw new DocumentError(message, "invalid_extraction");
}
function text(value, max, label) {
  assert(typeof value === "string" && value.length <= max, `Invalid ${label}.`);
}
function checkEvidence(evidence, anchors, label) {
  assert(
    Array.isArray(evidence) && evidence.length <= 8,
    `Invalid evidence in ${label}.`,
  );
  return evidence.map((ref) => {
    text(ref?.anchorId, 160, "source reference");
    text(ref?.quote, 2000, "source quotation");
    const anchor = anchors.get(ref.anchorId);
    assert(anchor, `Unknown source reference in ${label}.`);
    let support = "image_reference";
    if (anchor.text) {
      const normalize = (s) => s.normalize("NFKC").replace(/\s+/g, " ").trim();
      assert(
        ref.quote.trim() &&
          normalize(anchor.text).includes(normalize(ref.quote)),
        `The quoted text is not present at its source in ${label}.`,
      );
      support = "exact_quote";
    } else {
      assert(
        anchor.kind === "page" && ref.quote.trim(),
        `Missing source text in ${label}.`,
      );
      assert(
        Array.isArray(ref.bbox),
        `A scanned value needs a visible source region in ${label}.`,
      );
    }
    if (ref.bbox !== null) {
      assert(
        Array.isArray(ref.bbox) &&
          ref.bbox.length === 4 &&
          ref.bbox.every((n) => Number.isFinite(n) && n >= 0 && n <= 1) &&
          ref.bbox[2] > ref.bbox[0] &&
          ref.bbox[3] > ref.bbox[1],
        `Invalid source region in ${label}.`,
      );
    }
    return {
      anchorId: ref.anchorId,
      quote: ref.quote,
      bbox: ref.bbox,
      support,
    };
  });
}
export function validateExtraction(input, sources) {
  assert(
    input?.schemaVersion === SCHEMA_VERSION &&
      Array.isArray(input.documents) &&
      input.documents.length === 2,
    "The AI response did not contain both documents.",
  );
  const allAnchors = new Map(
    sources.flatMap((source) =>
      source.anchors.map((anchor) => [anchor.id, anchor]),
    ),
  );
  const ids = new Set();
  function field(value, anchors, label) {
    assert(
      value && ["clear", "uncertain", "missing"].includes(value.certainty),
      `Invalid field status in ${label}.`,
    );
    for (const key of ["raw", "value", "issue"])
      assert(
        value[key] === null ||
          (typeof value[key] === "string" && value[key].length <= 2000),
        `Invalid ${key} in ${label}.`,
      );
    const evidence = checkEvidence(value.evidence, anchors, label);
    if (value.value !== null || value.raw !== null)
      assert(evidence.length > 0, `A value has no source in ${label}.`);
    if (value.raw)
      assert(
        evidence.some((ref) =>
          ref.quote
            .normalize("NFKC")
            .replace(/\s+/g, " ")
            .includes(value.raw.normalize("NFKC").replace(/\s+/g, " ")),
        ) ||
          (!/\.(?:quantity|unitPrice|priceBasisQuantity|extendedPrice|date)$/.test(
            label,
          ) &&
            printedSpanPresent(
              value.raw,
              evidence.map((r) => r.quote),
            )),
        `An extracted value is not in its quoted source in ${label}.`,
      );
    if (
      /\.(?:quantity|unitPrice|priceBasisQuantity|extendedPrice)$/.test(
        label,
      ) &&
      decimal(value.raw)
    ) {
      const expected = decimal(value.raw);
      assert(
        evidence.some((ref) =>
          (ref.quote.match(/-?\d+(?:[.,]\d+)*/g) || []).some((token) =>
            equal(decimal(token), expected),
          ),
        ),
        `A numeric reading is only a substring of another value in ${label}.`,
      );
    }
    return {
      raw: value.raw,
      value: value.value,
      certainty: value.certainty,
      issue: value.issue,
      evidence,
    };
  }
  const documents = input.documents.map((doc) => {
    assert(
      ["po", "ack"].includes(doc?.id) && !ids.has(doc.id),
      "Duplicate or unknown document role.",
    );
    ids.add(doc.id);
    assert(
      ["purchase_order", "acknowledgement", "unknown"].includes(doc.type),
      "Unknown document type.",
    );
    const source = sources.find((s) => s.id === doc.id);
    assert(source, "Document source missing.");
    const anchors = new Map(source.anchors.map((a) => [a.id, a]));
    const out = { id: doc.id, type: doc.type };
    for (const key of DOCUMENT_FIELDS)
      out[key] = field(doc[key], anchors, `${doc.id}.${key}`);
    assert(
      Array.isArray(doc.lines) &&
        doc.lines.length > 0 &&
        doc.lines.length <= LIMITS.lines,
      "No usable line items, or too many line items.",
    );
    const lineIds = new Set();
    out.lines = doc.lines.map((line) => {
      text(line?.id, 80, "line identifier");
      assert(
        line.id && !lineIds.has(line.id),
        "Duplicate extracted line identifier.",
      );
      lineIds.add(line.id);
      assert(
        ["delivery", "shipment", "unknown"].includes(line.dateKind),
        "Unknown date meaning.",
      );
      const item = { id: line.id, dateKind: line.dateKind };
      for (const key of LINE_FIELDS)
        item[key] = field(line[key], anchors, `${doc.id}.${line.id}.${key}`);
      assert(
        Array.isArray(line.schedules) && line.schedules.length <= 30,
        "Invalid delivery schedule.",
      );
      const scheduleIds = new Set();
      item.schedules = line.schedules.map((schedule) => {
        text(schedule.id, 80, "schedule identifier");
        assert(!scheduleIds.has(schedule.id), "Duplicate schedule identifier.");
        scheduleIds.add(schedule.id);
        assert(
          ["delivery", "shipment", "unknown"].includes(schedule.dateKind),
          "Unknown schedule date meaning.",
        );
        return {
          id: schedule.id,
          dateKind: schedule.dateKind,
          ...Object.fromEntries(
            ["quantity", "unit", "date"].map((key) => [
              key,
              field(
                schedule[key],
                anchors,
                `${doc.id}.${line.id}.schedule.${key}`,
              ),
            ]),
          ),
        };
      });
      assert(
        Array.isArray(line.notes) && line.notes.length <= 15,
        "Invalid line notes.",
      );
      item.notes = line.notes.map((n) => field(n, anchors, "line condition"));
      return item;
    });
    assert(
      Array.isArray(doc.conditions) &&
        doc.conditions.length <= 25 &&
        Array.isArray(doc.mappings) &&
        doc.mappings.length <= 30 &&
        Array.isArray(doc.warnings) &&
        doc.warnings.length <= 25,
      "Invalid document notes or mappings.",
    );
    out.conditions = doc.conditions.map((v) =>
      field(v, anchors, "document condition"),
    );
    out.mappings = doc.mappings.map((mapping) => {
      text(mapping.field, 100, "mapped field");
      text(mapping.label, 160, "field label");
      text(mapping.location, 240, "field location");
      const evidence = checkEvidence(
        mapping.evidence,
        anchors,
        "field mapping",
      );
      assert(
        evidence.length &&
          printedSpanPresent(
            mapping.label,
            evidence.map((ref) => ref.quote),
          ),
        "A discovered column label is not present at its quoted source.",
      );
      return {
        field: mapping.field,
        label: mapping.label,
        location: mapping.location,
        evidence,
        status: "discovered",
      };
    });
    out.warnings = doc.warnings.map((w) => {
      text(w, 800, "document warning");
      return w;
    });
    return out;
  });
  const po = documents.find((d) => d.id === "po"),
    ack = documents.find((d) => d.id === "ack");
  assert(
    Array.isArray(input.links) && input.links.length <= LIMITS.lines * 2,
    "Invalid line relationships.",
  );
  const links = input.links.map((link) => {
    assert(
      Array.isArray(link.poIds) &&
        link.poIds.length > 0 &&
        link.poIds.length <= 20 &&
        Array.isArray(link.ackIds) &&
        link.ackIds.length > 0 &&
        link.ackIds.length <= 30,
      "Invalid line relationship membership.",
    );
    assert(
      new Set(link.poIds).size === link.poIds.length &&
        new Set(link.ackIds).size === link.ackIds.length &&
        link.poIds.every((id) => po.lines.some((l) => l.id === id)) &&
        link.ackIds.every((id) => ack.lines.some((l) => l.id === id)),
      "A proposed relationship references an unknown or repeated line.",
    );
    text(link.reason, 1600, "relationship explanation");
    assert(
      typeof link.splitExplicit === "boolean",
      "Invalid split shipment status.",
    );
    return {
      poIds: [...link.poIds],
      ackIds: [...link.ackIds],
      reason: link.reason,
      splitExplicit: link.splitExplicit,
      evidence: checkEvidence(link.evidence, allAnchors, "line relationship"),
    };
  });
  assert(
    Array.isArray(input.uncertainties) && input.uncertainties.length <= 30,
    "Invalid uncertainty list.",
  );
  return {
    schemaVersion: SCHEMA_VERSION,
    documents,
    links,
    uncertainties: input.uncertainties.map((item) => {
      const s =
        typeof item === "string"
          ? { message: item, kind: "other", poIds: [], ackIds: [] }
          : item;
      text(s?.message, 1000, "uncertainty");
      assert(
        ["relationship", "other"].includes(s.kind) &&
          Array.isArray(s.poIds) &&
          Array.isArray(s.ackIds) &&
          s.poIds.length <= 40 &&
          s.ackIds.length <= 40 &&
          s.poIds.every((id) => po.lines.some((l) => l.id === id)) &&
          s.ackIds.every((id) => ack.lines.some((l) => l.id === id)),
        "Invalid uncertainty targets.",
      );
      return {
        message: s.message,
        kind: s.kind,
        poIds: [...s.poIds],
        ackIds: [...s.ackIds],
      };
    }),
  };
}
