import test from "node:test";
import assert from "node:assert/strict";
import { compareDocuments } from "../scripts/documents/compare.js";
import {
  createProfile,
  importProfiles,
  validateProfile,
} from "../scripts/documents/profiles.js";
import { validateExtraction, emptyField } from "../scripts/documents/schema.js";
import {
  decimal,
  display,
  equal,
  divide,
} from "../scripts/documents/numbers.js";
import { casePair, splitPair } from "./fixtures/document-pairs.mjs";

test("a supplier part alias is questioned instead of silently inferred", () => {
  const r = compareDocuments(casePair());
  assert.equal(r.questions.length, 1);
  assert.equal(r.questions[0].id, "match:A1");
  assert.equal(r.status, "partly_unresolved");
  assert.ok(!r.findings.some((f) => f.title.startsWith("Unit price")));
});
test("a confirmed part match exposes the necessary unit conversion question", () => {
  const r = compareDocuments({
    ...casePair(),
    answers: { "match:A1": { value: "P1" } },
  });
  assert.equal(r.questions.length, 1);
  assert.equal(r.questions[0].id, "unit:GSK-8|BOX->EA");
  assert.match(r.questions[0].prompt, /how many EA.*one BOX/);
  assert.ok(
    r.findings.some(
      (f) => f.title.startsWith("Quantity") && f.status === "unresolved",
    ),
  );
});
test("confirmed BOX conversion yields matching quantity but a real price discrepancy", () => {
  const r = compareDocuments({
    ...casePair(),
    answers: {
      "match:A1": { value: "P1" },
      "unit:GSK-8|BOX->EA": { value: "12" },
    },
  });
  assert.equal(r.questions.length, 0);
  assert.equal(
    r.findings.find((f) => f.title.startsWith("Quantity")).status,
    "match",
  );
  const price = r.findings.find((f) => f.title.startsWith("Unit price"));
  assert.equal(price.expected, "0.75 USD/EA");
  assert.equal(price.actual, "0.8 USD/EA");
  assert.equal(price.status, "difference");
  assert.match(price.explanation, /0.05 USD/);
  assert.match(
    r.findings.find((f) => f.title.startsWith("Extended")).explanation,
    /12.00 USD/,
  );
  assert.equal(r.learnableRules.length, 2);
});
test("an explicit pricing unit is kept separate from the quantity unit", () => {
  const c = casePair({ buyerReference: true, ackPrice: "0.80" });
  const ack = c.extraction.documents.find((d) => d.id === "ack");
  ack.lines[0].priceBasisUnit = structuredClone(
    c.extraction.documents[0].lines[0].unit,
  );
  const r = compareDocuments({
    ...c,
    answers: { "unit:GSK-8|BOX->EA": { value: "12" } },
  });
  assert.equal(
    r.findings.find((f) => f.title.startsWith("Unit price")).actual,
    "0.8 USD/EA",
  );
});
test("a saved versioned profile reuses confirmed business rules on a new order", () => {
  const first = casePair(),
    answers = {
      "match:A1": { value: "P1" },
      "unit:GSK-8|BOX->EA": { value: "12" },
    };
  const result = compareDocuments({ ...first, answers });
  const profile = createProfile({
    ...first,
    source: first.sources[1],
    confirmedMappings: ["line.quantity", "line.unitPrice"],
    confirmedRules: result.learnableRules,
    id: "harbor-profile-001",
  });
  const next = casePair({ next: true });
  const replay = compareDocuments({ ...next, profiles: [profile] });
  assert.equal(replay.questions.length, 0);
  assert.equal(
    replay.findings.find((f) => f.title.startsWith("Quantity")).expected,
    "180 EA",
  );
  assert.equal(
    replay.findings.find((f) => f.title.startsWith("Quantity")).actual,
    "180 EA",
  );
  assert.ok(replay.usedRules.some((r) => r.kind === "unit"));
  assert.ok(replay.usedRules.some((r) => r.kind === "part"));
  assert.equal(replay.profileVersions[0].revision, 1);
});
test("profile revisions preserve the original result and prior profile", () => {
  const c = casePair();
  const one = compareDocuments({
    ...c,
    answers: {
      "match:A1": { value: "P1" },
      "unit:GSK-8|BOX->EA": { value: "12" },
    },
  });
  const profile = createProfile({
    ...c,
    source: c.sources[1],
    confirmedRules: one.learnableRules,
    id: "harbor-profile-001",
  });
  const before = JSON.stringify({ one, profile });
  const correction = compareDocuments({
    ...c,
    answers: {
      "match:A1": { value: "P1" },
      "unit:GSK-8|BOX->EA": { value: "10" },
    },
  });
  const second = createProfile({
    ...c,
    source: c.sources[1],
    previous: profile,
    confirmedRules: correction.learnableRules,
  });
  assert.equal(second.revision, 2);
  assert.equal(second.rules.find((r) => r.kind === "unit").value, "10");
  assert.equal(JSON.stringify({ one, profile }), before);
});
test("an unrelated customer cannot reuse another business's profile", () => {
  const c = casePair(),
    r = compareDocuments({
      ...c,
      answers: {
        "match:A1": { value: "P1" },
        "unit:GSK-8|BOX->EA": { value: "12" },
      },
    });
  const p = createProfile({
    ...c,
    source: c.sources[1],
    confirmedRules: r.learnableRules,
    id: "harbor-profile-001",
  });
  const changed = structuredClone(c);
  changed.extraction.documents[0].customer.value = "Another Customer";
  const result = compareDocuments({ ...changed, profiles: [p] });
  assert.equal(result.profileVersions.length, 0);
  assert.equal(result.questions[0].id, "match:A1");
});
test("changed form labels prevent silent reuse of a saved profile", () => {
  const c = casePair(),
    p = createProfile({
      ...c,
      source: c.sources[1],
      id: "harbor-profile-001",
      confirmedRules: [],
    });
  const changed = structuredClone(c);
  changed.sources[1].anchors = changed.sources[1].anchors.map((a) => ({
    ...a,
    text: a.text
      .replace("Net each", "List amount")
      .replace("Buyer reference", "Account number")
      .replace("Our SKU", "New reference"),
  }));
  assert.equal(
    compareDocuments({ ...changed, profiles: [p] }).profileVersions.length,
    0,
  );
});
test("explicit split deliveries compare total quantities without hiding later dates", () => {
  const r = compareDocuments(splitPair());
  assert.equal(r.questions.length, 0);
  assert.equal(
    r.findings.find((f) => f.title.startsWith("Quantity")).actual,
    "120 EA",
  );
  const dates = r.findings.filter((f) => f.title.startsWith("Delivery date"));
  assert.equal(dates.length, 2);
  assert.match(dates[0].explanation, /2 calendar days later/);
  assert.match(dates[1].explanation, /8 calendar days later/);
});
test("repeated part numbers without split evidence require a grouping confirmation", () => {
  const r = compareDocuments(splitPair({ explicit: false }));
  assert.equal(r.questions[0].id, "split:P1");
  assert.ok(!r.findings.some((f) => f.title.startsWith("Quantity")));
});
test("shipment and delivery dates remain incomparable", () => {
  const c = splitPair();
  c.extraction.documents[1].lines[0].dateKind = "shipment";
  const r = compareDocuments(c);
  assert.ok(
    r.findings.some(
      (f) =>
        f.status === "unresolved" && /shipment.*delivery/.test(f.explanation),
    ),
  );
});
test("wrong order references hold comparisons until the document relationship is confirmed", () => {
  const c = splitPair();
  c.extraction.documents[1].orderReference.value = "99999";
  const r = compareDocuments(c);
  assert.equal(r.questions[0].id, "document-pair");
  assert.equal(r.relationships.length, 0);
  assert.equal(r.findings.length, 1);
});
test("invalid clarification answers do not disappear or enable a false match", () => {
  const r = compareDocuments({
    ...casePair(),
    answers: { "match:A1": { value: "unknown-line" } },
  });
  assert.equal(r.questions[0].id, "match:A1");
  assert.equal(r.status, "partly_unresolved");
});
test("source quotations and anchor IDs are independently validated", () => {
  const c = casePair(),
    raw = structuredClone(c.extraction);
  raw.documents[0].lines[0].quantity.evidence[0].quote =
    "A made-up source value";
  assert.throws(() => validateExtraction(raw, c.sources), /not present/);
  raw.documents[0].lines[0].quantity.evidence[0].anchorId = "made-up-anchor";
  assert.throws(() => validateExtraction(raw, c.sources), /Unknown source/);
});
test("profile files reject unconfirmed rules and support safe roundtrips", () => {
  const c = casePair(),
    p = createProfile({ ...c, source: c.sources[1], id: "harbor-profile-001" });
  assert.deepEqual(importProfiles(JSON.stringify(p))[0], p);
  assert.throws(
    () =>
      validateProfile({ ...p, rules: [{ kind: "unit", status: "inferred" }] }),
    /Only confirmed/,
  );
});
test("decimal conversions preserve exact fractional prices", () => {
  const unit = divide(decimal("1"), decimal("3"));
  assert.equal(display(unit), "0.333333");
  assert.ok(equal(divide(decimal("9.60"), decimal("12")), decimal("0.8")));
});
test("a Net Each heading beside BOX does not silently establish a per-box pricing basis", () => {
  const c = casePair({ buyerReference: true }),
    ack = c.extraction.documents[1];
  ack.lines[0].priceBasisQuantity = emptyField();
  ack.lines[0].priceBasisUnit = emptyField();
  const answers = { "unit:GSK-8|BOX->EA": { value: "12" } };
  const pending = compareDocuments({ ...c, answers });
  assert.ok(pending.questions.some((q) => q.id === "price-basis:ack:A1"));
  assert.equal(
    pending.findings.find((f) => f.title.startsWith("Unit price")).status,
    "unresolved",
  );
  ack.lines[0].priceBasisUnit = structuredClone(ack.lines[0].unit);
  assert.ok(
    compareDocuments({ ...c, answers }).questions.some(
      (q) => q.id === "price-basis:ack:A1",
    ),
  );
  const resolved = compareDocuments({
    ...c,
    answers: { ...answers, "price-basis:ack:A1": { value: "1 BOX" } },
  });
  assert.equal(resolved.questions.length, 0);
  assert.equal(
    resolved.findings.find((f) => f.title.startsWith("Unit price")).actual,
    "0.8 USD/EA",
  );
  assert.ok(
    resolved.learnableRules
      .find((r) => r.kind === "price_basis")
      .key.includes("GSK-8|BOX"),
  );
});
test("an explicitly grouped schedule can supply a calculated total without asking for a nonexistent parent quantity", () => {
  const c = splitPair(),
    ack = c.extraction.documents[1],
    [one, two] = ack.lines;
  const parent = structuredClone(one);
  parent.quantity = emptyField();
  parent.extendedPrice = emptyField();
  parent.date = emptyField();
  parent.schedules = [one, two].map((l, i) => ({
    id: `S${i + 1}`,
    quantity: l.quantity,
    unit: l.unit,
    date: l.date,
    dateKind: "delivery",
  }));
  ack.lines = [parent];
  c.extraction.links = [];
  const result = compareDocuments(c);
  assert.equal(result.questions.length, 0);
  assert.equal(
    result.findings.find((f) => f.title.startsWith("Quantity")).actual,
    "120 EA",
  );
  assert.match(
    result.normalizations.find((n) => n.field === "quantity").basis,
    /not a printed parent/,
  );
  assert.equal(
    result.findings.filter((f) => f.title.startsWith("Delivery date")).length,
    2,
  );
  parent.quantity = structuredClone(one.quantity);
  assert.ok(
    compareDocuments(c).findings.some(
      (f) =>
        f.title.startsWith("Schedule quantity") && f.status === "difference",
    ),
  );
});
test("unfamiliar business roles require confirmation before number comparisons", () => {
  const c = splitPair();
  c.extraction.documents[1].type = "unknown";
  const result = compareDocuments(c);
  assert.equal(result.questions[0].id, "document-role:ack");
  assert.equal(result.relationships.length, 0);
  assert.equal(
    compareDocuments({
      ...c,
      answers: { "document-role:ack": { value: "confirm" } },
    }).questions.length,
    0,
  );
});
test("fractional unit conversions remain exact and reusable", () => {
  const c = casePair({
    buyerReference: true,
    poQuantity: "10",
    poUnit: "BOX",
    poPrice: "9",
    unit: "EA",
    ackQuantity: "120",
    ackPrice: "0.75",
  });
  const r = compareDocuments({
    ...c,
    answers: { "unit:GSK-8|EA->BOX": { value: "1/12" } },
  });
  assert.equal(r.questions.length, 0);
  assert.equal(
    r.findings.find((f) => f.title.startsWith("Quantity")).actual,
    "10 BOX",
  );
  assert.equal(
    r.findings.find((f) => f.title.startsWith("Unit price")).actual,
    "9 USD/BOX",
  );
  const p = createProfile({
    ...c,
    source: c.sources[1],
    confirmedRules: r.learnableRules,
    id: "fraction-profile",
  });
  assert.equal(compareDocuments({ ...c, profiles: [p] }).questions.length, 0);
});
test("identical packaging labels do not silently establish identical pack sizes", () => {
  const c = casePair({
    buyerReference: true,
    poQuantity: "20",
    poUnit: "BOX",
    poPrice: "9.6",
  });
  const first = compareDocuments(c);
  assert.equal(first.questions[0].id, "unit:GSK-8|BOX->BOX");
  const confirmed = compareDocuments({
    ...c,
    answers: { "unit:GSK-8|BOX->BOX": { value: "1" } },
  });
  assert.equal(confirmed.questions.length, 0);
  assert.equal(
    confirmed.findings.find((f) => f.title.startsWith("Quantity")).status,
    "match",
  );
});
test("a confirmed relationship resolves its targeted model concern without hiding unrelated uncertainty", () => {
  const c = casePair();
  c.extraction.uncertainties = [
    {
      message: "The supplier code is not cross-referenced.",
      kind: "relationship",
      poIds: ["P1"],
      ackIds: ["A1"],
    },
    {
      message: "A separate contractual condition is unclear.",
      kind: "other",
      poIds: [],
      ackIds: [],
    },
  ];
  const r = compareDocuments({
    ...c,
    answers: {
      "match:A1": { value: "P1" },
      "unit:GSK-8|BOX->EA": { value: "12" },
    },
  });
  assert.equal(r.resolvedUncertainties.length, 1);
  assert.equal(
    r.findings.filter((f) => f.title === "Unresolved document interpretation")
      .length,
    1,
  );
  assert.match(
    r.findings.find((f) => f.title === "Unresolved document interpretation")
      .actual,
    /contractual/,
  );
});
