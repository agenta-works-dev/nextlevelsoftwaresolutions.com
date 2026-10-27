import {
  canonicalText as canon,
  canonicalUnit,
  decimal,
  rational,
  add,
  subtract,
  multiply,
  divide,
  equal,
  positive,
  nonnegative,
  sum,
  display,
  isoDate,
  ambiguousDate,
  dayDifference,
  conversionFactor,
} from "./numbers.js";
import {
  reusableProfiles,
  scannedProfileCandidates,
  profileRule,
  learningSummary,
} from "./profiles.js";

const words = {
  buyerPart: "your part number",
  supplierPart: "the supplier’s part number",
  quantity: "quantity",
  unit: "unit of measure",
  unitPrice: "price",
  priceBasisQuantity: "pricing quantity",
  priceBasisUnit: "pricing unit",
  extendedPrice: "extended value",
  currency: "currency",
  date: "date",
  customer: "customer",
  supplier: "supplier",
};
const fieldName = (name) =>
  words[name] ||
  (/^delivery-.+-date$/.test(name)
    ? "scheduled date"
    : /^schedule-.+-quantity$/.test(name)
      ? "scheduled quantity"
      : /^schedule-.+-unit$/.test(name)
        ? "scheduled unit of measure"
        : name);
const refs = (...fields) => fields.flatMap((f) => f?.evidence || []);
const label = (line) =>
  line.buyerPart.value ||
  line.supplierPart.value ||
  line.description.value ||
  line.id;
const months = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
};
function rawDate(raw, order = null) {
  const v = String(raw || "").trim();
  if (isoDate(v)) return v;
  const date = (year, month, day) =>
    isoDate(
      `${String(year).length === 2 ? "20" + year : year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    );
  let m = v.match(/^(\d{1,2})\s+([a-z]+)[ ,]+(\d{4})$/i);
  if (m && months[m[2].slice(0, 3).toUpperCase()])
    return date(m[3], months[m[2].slice(0, 3).toUpperCase()], m[1]);
  m = v.match(/^([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (m && months[m[1].slice(0, 3).toUpperCase()])
    return date(m[3], months[m[1].slice(0, 3).toUpperCase()], m[2]);
  m = v.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/);
  if (m) {
    const format =
      +m[1] > 12 ? "DMY" : +m[2] > 12 ? "MDY" : +m[1] === +m[2] ? "MDY" : order;
    if (format)
      return format === "MDY" ? date(m[3], m[1], m[2]) : date(m[3], m[2], m[1]);
  }
  return null;
}
function rawNumber(raw) {
  const s = String(raw ?? "")
    .trim()
    .replace(/^(?:USD|CAD|AUD|EUR|GBP|JPY|CHF)\s*/i, "")
    .replace(/\s*(?:USD|CAD|AUD|EUR|GBP|JPY|CHF)$/i, "")
    .replace(/^[$€£¥]\s*/, "")
    .replace(/\u00a0/g, " ");
  if (decimal(s)) return decimal(s);
  if (/^-?\d{1,3}(?:,\d{3})+\.\d{1,6}$/.test(s))
    return decimal(s.replaceAll(",", ""));
  if (/^-?\d{1,3}(?:\.\d{3})+,\d{1,6}$/.test(s))
    return decimal(s.replaceAll(".", "").replace(",", "."));
  if (/^-?\d{1,3}(?: \d{3})+(?:\.\d{1,6})?$/.test(s))
    return decimal(s.replaceAll(" ", ""));
  return null;
}

export function compareDocuments({
  extraction,
  sources,
  profiles = [],
  answers = {},
  now = new Date().toISOString(),
}) {
  const po = extraction.documents.find((d) => d.id === "po"),
    ack = extraction.documents.find((d) => d.id === "ack");
  const active = reusableProfiles(
    profiles,
    sources,
    extraction,
    profiles
      .filter((p) => answers[`profile:${p.id}:${p.revision}`]?.value === "use")
      .map((p) => `${p.id}:${p.revision}`),
  );
  const questions = new Map(),
    usedRules = new Map(),
    learned = new Map();
  const resolvedUncertainties = [];
  const findings = [],
    relationships = [],
    normalizations = [];
  const ask = (q) => {
    if (!questions.has(q.id)) questions.set(q.id, q);
    return null;
  };
  function saved(kind, key) {
    const rule = profileRule(active, kind, key);
    if (rule) usedRules.set(`${rule.profileId}:${kind}:${key}`, rule);
    return rule;
  }
  function learn(kind, key, value, explanation, role) {
    learned.set(`${kind}:${key}`, {
      kind,
      key,
      value: String(value),
      explanation,
      role,
      status: "confirmed",
      confirmedAt: now,
    });
  }
  function finding(
    status,
    title,
    expected,
    actual,
    explanation,
    evidence,
    group = "documents",
  ) {
    const f = {
      id: `finding-${findings.length + 1}`,
      status,
      title,
      expected: String(expected ?? "Not determined"),
      actual: String(actual ?? "Not determined"),
      explanation,
      evidence,
      group,
    };
    findings.push(f);
    return f;
  }
  function read(field, role, lineId, name, type = "text", required = true) {
    const id = `field:${role}:${lineId}:${name}`;
    const answer = answers[id];
    if (answer?.value !== undefined && answer.value !== "") {
      const v =
        type === "number"
          ? decimal(answer.value)
          : type === "date"
            ? isoDate(answer.value)
            : String(answer.value).trim();
      if (v !== null && v !== "") return v;
    }
    if (!field?.value && !field?.raw) {
      if (required)
        ask({
          id,
          kind: type,
          role,
          prompt: `What is ${fieldName(name)} for ${lineId === "document" ? `the ${role === "po" ? "purchase order" : "acknowledgement"}` : `${label((role === "po" ? po : ack).lines.find((l) => l.id === lineId) || { buyerPart: {}, supplierPart: {}, description: {}, id: lineId })}`}? It could not be read reliably.`,
          evidence: refs(field),
          explanation:
            "Enter the value from the source, or leave it unresolved.",
          options: [],
        });
      return null;
    }
    if (type === "date") {
      const formatKey = `${role}:date-format`;
      const formatAnswer = answers[`date-format:${role}`]?.value;
      const formatRule = saved("date_format", formatKey);
      const format = ["MDY", "DMY"].includes(formatAnswer)
        ? formatAnswer
        : formatRule?.value;
      const value = rawDate(field.raw || field.value, format);
      if (!value && ambiguousDate(field.raw || field.value)) {
        if (formatAnswer)
          learn(
            "date_format",
            formatKey,
            formatAnswer,
            "Numeric date order confirmed by the visitor.",
            role,
          );
        ask({
          id: `date-format:${role}`,
          kind: "choice",
          role,
          prompt: `In the ${role === "po" ? "purchase order" : "acknowledgement"}, does “${field.raw || field.value}” use month/day/year or day/month/year?`,
          evidence: refs(field),
          options: [
            { value: "MDY", label: "Month / day / year" },
            { value: "DMY", label: "Day / month / year" },
          ],
          explanation:
            "Both readings could be valid dates. No date comparison uses a guessed order.",
        });
        return null;
      }
      if (formatAnswer && ["MDY", "DMY"].includes(formatAnswer))
        learn(
          "date_format",
          formatKey,
          formatAnswer,
          "Numeric date order confirmed by the visitor.",
          role,
        );
      if (
        value &&
        (field.certainty === "clear" ||
          (format && ambiguousDate(field.raw || field.value)))
      )
        return value;
    } else if (type === "number") {
      const raw = rawNumber(field.raw ?? field.value),
        normalized = decimal(field.value);
      if (
        raw &&
        normalized &&
        equal(raw, normalized) &&
        field.certainty === "clear"
      )
        return normalized;
    } else if (field.certainty === "clear") return field.value || field.raw;
    if (!required) return null;
    ask({
      id,
      kind: type,
      role,
      prompt: `Please confirm ${fieldName(name)} for ${lineId === "document" ? `the ${role === "po" ? "purchase order" : "acknowledgement"}` : `item ${lineId}`}.`,
      evidence: refs(field),
      explanation:
        field.issue ||
        `The extracted reading “${field.raw || field.value}” needs confirmation.`,
      options: [],
    });
    return null;
  }
  function number(field, role, lineId, name, required = true) {
    const v = read(field, role, lineId, name, "number", required);
    if (v && !nonnegative(v)) {
      ask({
        id: `field:${role}:${lineId}:${name}`,
        kind: "number",
        role,
        prompt: `Confirm the non-negative ${words[name] || name} for item ${lineId}.`,
        evidence: refs(field),
        options: [],
        explanation:
          "Credits, cancellations, and negative order quantities need explicit handling outside this demo.",
      });
      return null;
    }
    return v;
  }
  function conversion(from, to, part, role, evidence) {
    from = canonicalUnit(from);
    to = canonicalUnit(to);
    if (!from || !to) return null;
    const samePackageLabel =
      from === to &&
      role === "ack" &&
      /^(?:BOX|CASE|PACK|PK|CTN|CARTON|PALLET|BAG|BUNDLE|ROLL)$/.test(from);
    if (from === to && !samePackageLabel) return rational(1n);
    const key = `${canon(part)}|${from}->${to}`;
    const id = `unit:${key}`;
    const answer = conversionFactor(answers[id]?.value);
    const previous = saved("unit", key);
    if (positive(answer)) {
      learn(
        "unit",
        key,
        answers[id].value,
        samePackageLabel
          ? `For ${part}: one supplier ${from} equals ${answers[id].value} of the order’s ${to}.`
          : `For ${part}: one ${from} equals ${answers[id].value} ${to}.`,
        role,
      );
      return answer;
    }
    const factor = conversionFactor(previous?.value);
    if (positive(factor)) return factor;
    return ask({
      id,
      kind: "ratio",
      role,
      prompt: samePackageLabel
        ? `For ${part}, how many of the order’s ${to} equal one supplier ${from}?`
        : `For ${part}, how many ${to} are in one ${from}?`,
      evidence,
      explanation: `${samePackageLabel ? "Both documents use the same packaging label, but that does not establish the same pack size. Enter 1 if the packs are equivalent." : `“${from}” and “${to}” are different units.`} Quantity and price comparisons wait for this conversion. You can enter an exact fraction such as 1/12.`,
      options: [],
    });
  }
  function currencyFor(doc, line) {
    const own = Boolean(line?.currency?.value),
      field = own ? line.currency : doc.currency,
      lineId = own ? line.id : "document";
    const value = read(field, doc.id, lineId, "currency", "text");
    if (!value) return null;
    const currency = canon(value) === "US$" ? "USD" : canon(value);
    if (/^[A-Z]{3}$/.test(currency)) return currency;
    ask({
      id: `field:${doc.id}:${lineId}:currency`,
      kind: "text",
      role: doc.id,
      prompt: `Which three-letter currency code applies to the ${doc.id === "po" ? "order" : "acknowledgement"}?`,
      evidence: refs(field),
      options: [],
      explanation:
        "A currency symbol alone does not establish USD, CAD, AUD, or another currency. Enter the explicit currency code, or leave price comparisons unresolved.",
    });
    return null;
  }
  function priceFor(doc, line, baseUnit, part) {
    const price = number(line.unitPrice, doc.id, line.id, "unitPrice");
    if (!price) return null;
    const priceLabel =
      doc.mappings.find(
        (m) => m.field === "unitPrice" || m.field === "line.unitPrice",
      )?.label || "price";
    const basisKey = `${doc.id}:${priceLabel}|${canon(part)}|${canonicalUnit(line.unit.value)}`;
    const basisRule = saved("price_basis", basisKey);
    let basisQuantity = number(
      line.priceBasisQuantity,
      doc.id,
      line.id,
      "priceBasisQuantity",
      false,
    );
    let basisUnit = read(
      line.priceBasisUnit,
      doc.id,
      line.id,
      "priceBasisUnit",
      "text",
      false,
    );
    const sameLocation = (a, b) =>
      a.anchorId === b.anchorId &&
      JSON.stringify(a.bbox) === JSON.stringify(b.bbox);
    const copiedQuantityUnit =
      basisUnit &&
      canonicalUnit(basisUnit) !== "EA" &&
      line.priceBasisUnit.evidence.length &&
      line.priceBasisUnit.evidence.every((a) =>
        line.unit.evidence.some((b) => sameLocation(a, b)),
      ) &&
      !line.priceBasisUnit.evidence.some((r) =>
        /\b(?:per|pricing|priced|rate)\b|\//i.test(r.quote),
      ) &&
      !doc.mappings.some(
        (m) =>
          /priceBasisUnit/.test(m.field) &&
          /price|pricing|rate|per/i.test(m.label),
      );
    if (copiedQuantityUnit) basisUnit = null;
    const explicitUnitLabel = doc.mappings.find(
      (m) =>
        /unit.?price|price.?each|net.?each|each.?price/i.test(m.label) &&
        /price/i.test(m.field),
    );
    if (!basisQuantity && explicitUnitLabel) basisQuantity = rational(1n);
    // "Each" is unambiguous for EA, but a BOX quantity does not establish
    // whether "Net each" prices a whole box or an individual piece.
    if (
      !basisUnit &&
      explicitUnitLabel &&
      canonicalUnit(line.unit.value) === "EA"
    )
      basisUnit = "EA";
    if ((!basisQuantity || !basisUnit) && basisRule) {
      const [q, ...u] = basisRule.value.split("|");
      basisQuantity ||= decimal(q);
      basisUnit ||= u.join("|");
    }
    const basisAnswer = answers[`price-basis:${doc.id}:${line.id}`]?.value;
    if ((!basisQuantity || !basisUnit) && basisAnswer) {
      const match = String(basisAnswer).match(/^(\d+(?:\.\d+)?)\s+(.{1,30})$/);
      if (match && positive(decimal(match[1]))) {
        basisQuantity = decimal(match[1]);
        basisUnit = match[2];
        learn(
          "price_basis",
          basisKey,
          `${match[1]}|${match[2]}`,
          `For ${part}, “${priceLabel}” is per ${match[1]} ${match[2]} when the quantity unit is ${line.unit.value}.`,
          doc.id,
        );
      }
    }
    if (!positive(basisQuantity) || !basisUnit) {
      ask({
        id: `price-basis:${doc.id}:${line.id}`,
        kind: "text",
        role: doc.id,
        prompt: `What quantity and unit does the price for ${part} cover?`,
        evidence: refs(
          line.unitPrice,
          line.priceBasisQuantity,
          line.priceBasisUnit,
        ),
        explanation:
          "For example, enter “1 EA”, “100 EA”, or “1 BOX”. A price is not assumed to be per the quantity unit.",
        options: [],
      });
      return null;
    }
    const factor = conversion(
      basisUnit,
      baseUnit,
      part,
      doc.id,
      refs(line.unitPrice, line.priceBasisUnit, line.unit),
    );
    if (!factor) return null;
    const normalized = divide(price, multiply(basisQuantity, factor));
    normalizations.push({
      role: doc.id,
      lineId: line.id,
      field: "unitPrice",
      sourceValue: line.unitPrice.raw,
      result: `${display(normalized)} per ${baseUnit}`,
      basis: `${display(basisQuantity)} ${basisUnit}`,
      evidence: refs(
        line.unitPrice,
        line.priceBasisQuantity,
        line.priceBasisUnit,
      ),
    });
    return normalized;
  }
  function kindFor(doc, line, date, suppliedKind = line.dateKind) {
    if (["delivery", "shipment"].includes(suppliedKind)) return suppliedKind;
    const mapping = doc.mappings.find((m) => /date/i.test(m.field));
    const key = `${doc.id}:${canon(mapping?.label || "unlabeled date")}`;
    const answer = answers[`date-kind:${key}`]?.value;
    if (["delivery", "shipment"].includes(answer)) {
      learn(
        "date_kind",
        key,
        answer,
        `“${mapping?.label || "Date"}” means ${answer} date on this form.`,
        doc.id,
      );
      return answer;
    }
    const rule = saved("date_kind", key);
    if (rule) return rule.value;
    ask({
      id: `date-kind:${key}`,
      kind: "choice",
      role: doc.id,
      prompt: `Does “${mapping?.label || "Date"}” on the ${doc.id === "po" ? "purchase order" : "acknowledgement"} mean shipment or delivery?`,
      evidence: refs(date),
      explanation:
        "A shipment date cannot be compared directly with a delivery date.",
      options: [
        { value: "delivery", label: "Delivery / arrival date" },
        { value: "shipment", label: "Shipment / departure date" },
      ],
    });
    return null;
  }

  for (const doc of [po, ack]) {
    const expectedType = doc.id === "po" ? "purchase_order" : "acknowledgement";
    if (
      doc.type !== expectedType &&
      answers[`document-role:${doc.id}`]?.value !== "confirm"
    ) {
      ask({
        id: `document-role:${doc.id}`,
        kind: "choice",
        role: doc.id,
        prompt: `Is this document intended to be the ${doc.id === "po" ? "purchase order" : "supplier acknowledgement"}? Its business role was not established reliably.`,
        explanation:
          "An invoice, packing slip, or other business form may contain similar numbers without making the same commitment. Confirm the role or replace the document before comparing.",
        evidence: refs(doc.documentNumber),
        options: [
          {
            value: "confirm",
            label: "Yes — I confirm this document’s intended role",
          },
          { value: "replace", label: "I need to replace this document" },
        ],
      });
      finding(
        "unresolved",
        "Document role",
        expectedType.replaceAll("_", " "),
        doc.type.replaceAll("_", " "),
        "The business role needs confirmation before its values can be compared.",
        refs(doc.documentNumber),
      );
    }
  }
  if (questions.size) return finish();
  // Document identity is a separate decision from whether line values happen to match.
  const poReference = read(
    po.documentNumber,
    "po",
    "document",
    "documentNumber",
    "text",
    false,
  );
  const ackReference = read(
    ack.orderReference,
    "ack",
    "document",
    "orderReference",
    "text",
    false,
  );
  const identityMatches =
    poReference && ackReference && canon(poReference) === canon(ackReference);
  if (!identityMatches && answers["document-pair"]?.value !== "confirm") {
    ask({
      id: "document-pair",
      kind: "choice",
      role: "both",
      prompt:
        poReference && ackReference
          ? `The order is “${poReference}”, but the acknowledgement refers to “${ackReference}”. Are these the intended documents?`
          : "Do these two documents belong to the same purchase order? A shared order reference could not be established.",
      evidence: refs(po.documentNumber, ack.orderReference),
      explanation:
        "Line comparisons are held until the relationship is confirmed.",
      options: [
        {
          value: "confirm",
          label: "Yes, compare this pair; I confirm the relationship",
        },
        { value: "replace", label: "No, I need to replace a document" },
      ],
    });
    finding(
      "unresolved",
      "Document relationship",
      poReference,
      ackReference,
      "The relationship between the two documents needs confirmation.",
      refs(po.documentNumber, ack.orderReference),
    );
    return finish();
  }
  finding(
    identityMatches ? "match" : "confirmed",
    "Order reference",
    poReference,
    ackReference,
    identityMatches
      ? "The acknowledgement names this purchase order."
      : "The visitor confirmed this pair despite a missing or different reference.",
    refs(po.documentNumber, ack.orderReference),
  );
  for (const party of ["customer", "supplier"]) {
    const a = read(po[party], "po", "document", party, "text", false),
      b = read(ack[party], "ack", "document", party, "text", false);
    if (a && b && canon(a) !== canon(b))
      finding(
        "difference",
        `${words[party][0].toUpperCase() + words[party].slice(1)} name`,
        a,
        b,
        "The named parties differ. No trading-name equivalence is assumed, and a reusable business profile cannot be scoped until the party names are established consistently.",
        refs(po[party], ack[party]),
      );
    else if (
      (po[party].value || ack[party].value) &&
      (po[party].certainty === "uncertain" ||
        ack[party].certainty === "uncertain")
    )
      finding(
        "unresolved",
        `${words[party]} reading`,
        po[party].raw,
        ack[party].raw,
        "An uncertain party name prevents business-scoped profile reuse. Inspect or correct its extracted reading.",
        refs(po[party], ack[party]),
      );
  }

  const assignments = new Map(),
    unlinked = new Set();
  for (const item of ack.lines) {
    const buyer = read(
      item.buyerPart,
      "ack",
      item.id,
      "buyerPart",
      "text",
      false,
    );
    const supplierPart = read(
      item.supplierPart,
      "ack",
      item.id,
      "supplierPart",
      "text",
      false,
    );
    const direct = po.lines.filter(
      (p) =>
        (buyer &&
          p.buyerPart.certainty === "clear" &&
          canon(p.buyerPart.value) === canon(buyer)) ||
        (supplierPart &&
          p.supplierPart.certainty === "clear" &&
          p.supplierPart.value &&
          canon(p.supplierPart.value) === canon(supplierPart)),
    );
    const partRule = supplierPart ? saved("part", canon(supplierPart)) : null;
    const remembered = partRule
      ? po.lines.filter(
          (p) =>
            p.buyerPart.certainty === "clear" &&
            canon(p.buyerPart.value) === partRule.value,
        )
      : [];
    const candidates = direct.length ? direct : remembered;
    const id = `match:${item.id}`,
      answer = answers[id]?.value;
    let chosen = answer
      ? po.lines.find((p) => p.id === answer)
      : candidates.length === 1
        ? candidates[0]
        : null;
    if (answer === "extra") {
      unlinked.add(item.id);
      continue;
    }
    const proposals = extraction.links.filter((l) =>
      l.ackIds.includes(item.id),
    );
    if (!chosen) {
      ask({
        id,
        kind: "choice",
        role: "both",
        prompt: `Which ordered item does “${label(item)}” acknowledge?`,
        evidence: refs(item.buyerPart, item.supplierPart, item.description),
        explanation:
          proposals[0]?.reason ||
          "A unique relationship could not be established from the available part references.",
        options: [
          ...po.lines.map((p) => ({
            value: p.id,
            label: `${p.id}: ${label(p)} · ${p.description.value || ""}`,
          })),
          { value: "extra", label: "None — this is an additional item" },
        ],
      });
      finding(
        "unresolved",
        `Item relationship · ${label(item)}`,
        "An ordered item",
        label(item),
        "The possible correspondence needs confirmation; it is not counted as a matching line.",
        refs(item.buyerPart, item.supplierPart, item.description),
        item.id,
      );
      continue;
    }
    if (
      answer &&
      supplierPart &&
      chosen.buyerPart.certainty === "clear" &&
      chosen.buyerPart.value
    )
      learn(
        "part",
        canon(supplierPart),
        canon(chosen.buyerPart.value),
        `Supplier part ${supplierPart} corresponds to customer part ${chosen.buyerPart.value}.`,
        "ack",
      );
    if (!assignments.has(chosen.id)) assignments.set(chosen.id, []);
    assignments.get(chosen.id).push(item);
  }
  for (const id of unlinked) {
    const item = ack.lines.find((l) => l.id === id);
    finding(
      "extra",
      `Additional item · ${label(item)}`,
      "Not ordered",
      label(item),
      "The visitor identified this acknowledgement item as additional.",
      refs(item.buyerPart, item.supplierPart, item.quantity),
      item.id,
    );
  }
  for (const ordered of po.lines) {
    const items = assignments.get(ordered.id) || [],
      part = label(ordered);
    if (!items.length) {
      const unresolvedLinks = [...questions.keys()].some((key) =>
        key.startsWith("match:"),
      );
      finding(
        unresolvedLinks ? "unresolved" : "missing",
        `${unresolvedLinks ? "Unassigned" : "Missing"} item · ${part}`,
        part,
        "No confirmed acknowledgement item",
        unresolvedLinks
          ? "A pending relationship question may account for this item."
          : "No acknowledgement item corresponds to this ordered item.",
        refs(ordered.buyerPart, ordered.quantity),
        ordered.id,
      );
      continue;
    }
    const splitKey = canon(
      ordered.buyerPart.value || ordered.supplierPart.value || part,
    );
    const splitConfirmed =
      saved("split", splitKey)?.value === "combine" ||
      answers[`split:${ordered.id}`]?.value === "combine";
    const explicitSplit = extraction.links.some(
      (link) =>
        link.poIds.length === 1 &&
        link.poIds[0] === ordered.id &&
        link.splitExplicit &&
        link.evidence.some(
          (ref) =>
            ref.support === "exact_quote" &&
            /\b(?:split|schedule[ds]?|deliveries|partial shipments?)\b/i.test(
              ref.quote,
            ),
        ) &&
        items.every((i) => link.ackIds.includes(i.id)),
    );
    if (items.length > 1 && !splitConfirmed && !explicitSplit) {
      ask({
        id: `split:${ordered.id}`,
        kind: "choice",
        role: "ack",
        prompt: `Do these ${items.length} acknowledgement entries together fulfill ${part}?`,
        evidence: items.flatMap((i) => refs(i.quantity, i.buyerPart, i.date)),
        explanation:
          "Repeated part numbers could represent split deliveries or duplicate/additional commitments. They are not added together without a basis.",
        options: [
          {
            value: "combine",
            label: "Yes — combine them as deliveries for this ordered item",
          },
        ],
      });
      finding(
        "unresolved",
        `Possible split deliveries · ${part}`,
        "One ordered item",
        `${items.length} acknowledgement entries`,
        "The delivery grouping needs confirmation.",
        items.flatMap((i) => refs(i.quantity, i.date)),
        ordered.id,
      );
      continue;
    }
    if (answers[`split:${ordered.id}`]?.value === "combine")
      learn(
        "split",
        splitKey,
        "combine",
        `Repeated entries for ${part} represent split deliveries on this form.`,
        "ack",
      );
    relationships.push({
      poIds: [ordered.id],
      ackIds: items.map((i) => i.id),
      explanation:
        items.length > 1
          ? "Confirmed or explicitly documented split deliveries."
          : "A unique part reference or visitor-confirmed mapping connects these items.",
      evidence: [
        ...refs(ordered.buyerPart, ordered.supplierPart),
        ...items.flatMap((i) => refs(i.buyerPart, i.supplierPart)),
      ],
    });
    const unit = read(ordered.unit, "po", ordered.id, "unit"),
      baseUnit = canonicalUnit(unit);
    const expectedQ = number(ordered.quantity, "po", ordered.id, "quantity");
    const expectedPrice = baseUnit
      ? priceFor(po, ordered, baseUnit, part)
      : null;
    const expectedCurrency = currencyFor(po, ordered);
    const actualQuantities = [],
      actualTotals = [];
    const expectedDate = read(ordered.date, "po", ordered.id, "date", "date");
    const expectedKind = expectedDate
      ? kindFor(po, ordered, ordered.date)
      : null;
    if (ordered.schedules.length)
      finding(
        "unresolved",
        `Requested schedule · ${part}`,
        `${ordered.schedules.length} requested schedule entries`,
        "Schedule allocation needs review",
        "This demonstration retains the requested schedule as source evidence. It does not automatically allocate multiple requested deliveries against multiple acknowledged deliveries; review that allocation before relying on date findings.",
        ordered.schedules.flatMap((s) => refs(s.quantity, s.date)),
        ordered.id,
      );
    for (const item of items) {
      const statedQuantity = Boolean(item.quantity.raw || item.quantity.value);
      const actualUnit = read(
        item.unit,
        "ack",
        item.id,
        "unit",
        "text",
        statedQuantity || !item.schedules.length,
      );
      const factor =
        baseUnit && actualUnit
          ? conversion(
              actualUnit,
              baseUnit,
              part,
              "ack",
              refs(ordered.unit, item.unit, item.quantity),
            )
          : null;
      const actualQ = number(
        item.quantity,
        "ack",
        item.id,
        "quantity",
        statedQuantity || !item.schedules.length,
      );
      let convertedQ = actualQ && factor ? multiply(actualQ, factor) : null;
      const scheduled = item.schedules.map((s) => {
        const q = number(
          s.quantity,
          "ack",
          item.id,
          `schedule-${s.id}-quantity`,
        );
        const useOwnUnit = Boolean(s.unit.value),
          u = read(
            useOwnUnit ? s.unit : item.unit,
            "ack",
            item.id,
            useOwnUnit ? `schedule-${s.id}-unit` : "unit",
          );
        const f =
          baseUnit && u
            ? conversion(u, baseUnit, part, "ack", refs(s.unit, item.unit))
            : null;
        return q && f ? multiply(q, f) : null;
      });
      if (scheduled.length && scheduled.every(Boolean)) {
        const total = sum(scheduled);
        if (convertedQ && !equal(total, convertedQ))
          finding(
            "difference",
            `Schedule quantity · ${part}`,
            `${display(convertedQ)} ${baseUnit} acknowledged`,
            `${display(total)} ${baseUnit} scheduled`,
            "The delivery schedule does not add up to the stated acknowledged quantity.",
            [
              ...refs(item.quantity),
              ...item.schedules.flatMap((s) => refs(s.quantity)),
            ],
            ordered.id,
          );
        else if (!statedQuantity) {
          convertedQ = total;
          normalizations.push({
            role: "ack",
            lineId: item.id,
            field: "quantity",
            sourceValue: item.schedules
              .map(
                (s) => `${s.quantity.raw} ${s.unit.value || item.unit.value}`,
              )
              .join(" + "),
            result: `${display(total)} ${baseUnit}`,
            basis:
              "Calculated from the explicitly grouped delivery schedule; not a printed parent quantity.",
            evidence: item.schedules.flatMap((s) => refs(s.quantity, s.unit)),
          });
        }
      }
      actualQuantities.push(convertedQ);
      const actualPrice = baseUnit ? priceFor(ack, item, baseUnit, part) : null;
      const actualCurrency = currencyFor(ack, item);
      const currencyMatch =
        expectedCurrency &&
        actualCurrency &&
        canon(expectedCurrency) === canon(actualCurrency);
      if (expectedCurrency && actualCurrency && !currencyMatch)
        finding(
          "difference",
          `Currency · ${part}`,
          expectedCurrency,
          actualCurrency,
          "The currencies differ. No exchange rate or equivalent price is assumed.",
          refs(
            ordered.currency.value ? ordered.currency : po.currency,
            item.currency.value ? item.currency : ack.currency,
          ),
          ordered.id,
        );
      if (expectedPrice && actualPrice && currencyMatch)
        finding(
          equal(expectedPrice, actualPrice) ? "match" : "difference",
          `Unit price · ${part}${items.length > 1 ? ` (${item.id})` : ""}`,
          `${display(expectedPrice)} ${expectedCurrency}/${baseUnit}`,
          `${display(actualPrice)} ${actualCurrency}/${baseUnit}`,
          equal(expectedPrice, actualPrice)
            ? "The prices match after confirmed pricing-basis and unit normalization."
            : `The normalized price differs by ${display(subtract(actualPrice, expectedPrice))} ${expectedCurrency} per ${baseUnit}.`,
          refs(
            ordered.unitPrice,
            ordered.priceBasisQuantity,
            item.unitPrice,
            item.priceBasisQuantity,
          ),
          ordered.id,
        );
      else
        finding(
          "unresolved",
          `Unit price · ${part}`,
          expectedPrice ? display(expectedPrice) : null,
          actualPrice ? display(actualPrice) : null,
          "Price comparison waits for reliable values, currencies, and pricing units.",
          refs(ordered.unitPrice, item.unitPrice),
          ordered.id,
        );
      let extended = number(
        item.extendedPrice,
        "ack",
        item.id,
        "extendedPrice",
        false,
      );
      if (!extended && convertedQ && actualPrice)
        extended = multiply(convertedQ, actualPrice);
      actualTotals.push(currencyMatch ? extended : null);
      const deliveries = item.schedules.length
        ? item.schedules
        : [
            {
              id: item.id,
              quantity: item.quantity,
              unit: item.unit,
              date: item.date,
              dateKind: item.dateKind,
            },
          ];
      for (const delivery of deliveries) {
        const date = read(
          delivery.date,
          "ack",
          item.id,
          `delivery-${delivery.id}-date`,
          "date",
        );
        const kind = date
          ? kindFor(ack, item, delivery.date, delivery.dateKind)
          : null;
        const deliveryLabel =
          item.schedules.length || items.length > 1 ? ` · ${delivery.id}` : "";
        if (
          date &&
          expectedDate &&
          kind &&
          expectedKind &&
          kind === expectedKind
        ) {
          const days = dayDifference(expectedDate, date);
          finding(
            days === 0 ? "match" : "difference",
            `${kind === "delivery" ? "Delivery" : "Shipment"} date · ${part}${deliveryLabel}`,
            expectedDate,
            date,
            days === 0
              ? "These dates have the same meaning and match."
              : `${Math.abs(days)} calendar ${Math.abs(days) === 1 ? "day" : "days"} ${days > 0 ? "later" : "earlier"} than requested. ${delivery.quantity.value ? `This entry covers ${delivery.quantity.value} ${delivery.unit.value || item.unit.value || "units"}.` : ""}`,
            refs(ordered.date, delivery.date, delivery.quantity),
            ordered.id,
          );
        } else
          finding(
            "unresolved",
            `Date comparison · ${part}${deliveryLabel}`,
            expectedDate,
            date,
            expectedKind && kind && expectedKind !== kind
              ? "One date describes shipment and the other describes delivery. They are not directly comparable."
              : "A date value or its meaning remains uncertain.",
            refs(ordered.date, delivery.date),
            ordered.id,
          );
      }
    }
    if (expectedQ && actualQuantities.every(Boolean)) {
      const actualQ = sum(actualQuantities);
      finding(
        equal(expectedQ, actualQ) ? "match" : "difference",
        `Quantity · ${part}`,
        `${display(expectedQ)} ${baseUnit}`,
        `${display(actualQ)} ${baseUnit}`,
        equal(expectedQ, actualQ)
          ? "The total acknowledged quantity matches after confirmed unit conversion."
          : `${display(subtract(actualQ, expectedQ))} ${baseUnit} versus the ordered quantity.`,
        [
          ...refs(ordered.quantity, ordered.unit),
          ...items.flatMap((i) => [
            ...refs(i.quantity, i.unit),
            ...i.schedules.flatMap((s) => refs(s.quantity, s.unit)),
          ]),
        ],
        ordered.id,
      );
    } else
      finding(
        "unresolved",
        `Quantity · ${part}`,
        expectedQ ? `${display(expectedQ)} ${baseUnit}` : null,
        null,
        "The quantity or unit relationship needs clarification.",
        [
          ...refs(ordered.quantity, ordered.unit),
          ...items.flatMap((i) => refs(i.quantity, i.unit)),
        ],
        ordered.id,
      );
    let expectedTotal = number(
      ordered.extendedPrice,
      "po",
      ordered.id,
      "extendedPrice",
      false,
    );
    if (!expectedTotal && expectedQ && expectedPrice)
      expectedTotal = multiply(expectedQ, expectedPrice);
    if (expectedTotal && actualTotals.every(Boolean)) {
      const total = sum(actualTotals);
      finding(
        equal(expectedTotal, total) ? "match" : "difference",
        `Extended value · ${part}`,
        `${display(expectedTotal, 6, 2)} ${expectedCurrency}`,
        `${display(total, 6, 2)} ${expectedCurrency}`,
        equal(expectedTotal, total)
          ? "Extended item values match, excluding taxes, freight, and other charges."
          : `The item value differs by ${display(subtract(total, expectedTotal), 6, 2)} ${expectedCurrency}. Values are compared as exact decimals; no rounding tolerance, taxes, or freight is assumed.`,
        [
          ...refs(ordered.extendedPrice, ordered.quantity, ordered.unitPrice),
          ...items.flatMap((i) =>
            refs(i.extendedPrice, i.quantity, i.unitPrice),
          ),
        ],
        ordered.id,
      );
    }
  }
  for (const doc of [po, ack])
    for (const condition of doc.conditions)
      if (condition.value)
        finding(
          "review",
          `${doc.id === "po" ? "Ordered" : "Acknowledged"} condition`,
          doc.id === "po"
            ? condition.raw
            : "Review alongside purchase order terms",
          doc.id === "ack" ? condition.raw : "Not automatically reconciled",
          "This condition was extracted for review. The tool has not established legal or commercial equivalence.",
          refs(condition),
          "conditions",
        );
  for (const doc of [po, ack])
    for (const line of doc.lines)
      for (const note of line.notes)
        if (note.value)
          finding(
            "review",
            `Item condition · ${label(line)}`,
            doc.id === "po" ? note.raw : "Review alongside the ordered item",
            doc.id === "ack" ? note.raw : "Not automatically reconciled",
            "An additional item condition needs human review.",
            refs(note),
            line.id,
          );
  for (const warning of extraction.uncertainties) {
    const issue =
      typeof warning === "string"
        ? { message: warning, kind: "other", ackIds: [], poIds: [] }
        : warning;
    if (
      issue.kind === "relationship" &&
      issue.ackIds.length &&
      issue.ackIds.every((id) =>
        relationships.some(
          (r) =>
            r.ackIds.includes(id) &&
            (!issue.poIds.length ||
              r.poIds.some((poId) => issue.poIds.includes(poId))),
        ),
      )
    ) {
      resolvedUncertainties.push({
        ...issue,
        resolution:
          "The corresponding items were established from current source identifiers, a user confirmation, or a scoped confirmed profile.",
      });
      continue;
    }
    finding(
      "unresolved",
      "Unresolved document interpretation",
      "A reliable interpretation",
      issue.message,
      "This interpretation was reported as uncertain and has not been treated as a verified business fact. Review the source or correct its extracted reading.",
      [],
      "documents",
    );
  }
  return finish();

  function finish() {
    // Only unresolved questions are inserted; a malformed answer never hides one.
    let pending = [...questions.values()];
    for (const profile of scannedProfileCandidates(
      profiles,
      sources,
      extraction,
    )) {
      const id = `profile:${profile.id}:${profile.revision}`;
      if (
        answers[id]?.value ||
        !pending.some(
          (q) =>
            (q.role === profile.role || q.role === "both") &&
            /^(?:match:|unit:|date-kind:|date-format:|split:|price-basis:)/.test(
              q.id,
            ),
        )
      )
        continue;
      pending = [
        {
          id,
          kind: "choice",
          role: profile.role,
          prompt: `Is this the same scanned form as your saved “${profile.name}” profile?`,
          explanation: `The read labels resemble revision ${profile.revision}, within the same customer and supplier scope. Confirm the form before reusing its ${profile.rules.length} business rule(s), or review the interpretations individually. Image recognition alone does not confirm the form.`,
          evidence: (profile.role === "po" ? po : ack).mappings
            .slice(0, 3)
            .flatMap((m) => m.evidence),
          options: [
            {
              value: "use",
              label: "Yes — reuse this profile’s confirmed interpretations",
            },
            {
              value: "skip",
              label: "No — clarify this document independently",
            },
          ],
        },
        ...pending.filter((q) => q.role !== profile.role && q.role !== "both"),
      ];
      break;
    }
    const counts = Object.fromEntries(
      [
        "match",
        "confirmed",
        "difference",
        "unresolved",
        "missing",
        "extra",
        "review",
      ].map((status) => [
        status,
        findings.filter((f) => f.status === status).length,
      ]),
    );
    return {
      version: 1,
      generatedAt: now,
      findings,
      questions: pending,
      relationships,
      resolvedUncertainties,
      counts,
      usedRules: [...usedRules.values()],
      learnableRules: [...learned.values()],
      normalizations,
      learning: learningSummary(extraction, active, pending),
      profileVersions: active.map((p) => ({
        id: p.id,
        revision: p.revision,
        name: p.name,
      })),
      status:
        counts.unresolved || pending.length
          ? "partly_unresolved"
          : counts.difference || counts.missing || counts.extra || counts.review
            ? "needs_review"
            : "checked_fields_match",
    };
  }
}
