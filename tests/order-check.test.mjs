import test from "node:test";
import assert from "node:assert/strict";
import {
  SAMPLE,
  InputError,
  MAX_LINES,
  compareRows,
  validateRows,
  parseSpreadsheet,
  spreadsheetTemplate,
  reportHTML,
  reportText,
  formatScaled,
} from "../scripts/order-check-model.js";

const row = (changes = {}) => ({ ...SAMPLE.order[0], ...changes });
const check = (changes) => compareRows([row()], [row(changes)]);

test("sample yields three findings across two lines, with one matching line", () => {
  const result = compareRows(SAMPLE.order, SAMPLE.acknowledgement);
  assert.equal(result.changedLines, 2);
  assert.equal(result.differenceCount, 3);
  assert.equal(result.matchingLines, 1);
  assert.deepEqual(
    result.lines[0].changes.map((change) => change.label),
    ["20 fewer units", "6 days later"],
  );
  assert.equal(result.lines[1].changes[0].label, "0.50 higher per unit");
});
test("reordering acknowledgement rows preserves line matches", () => {
  const result = compareRows(SAMPLE.order, [...SAMPLE.order].reverse());
  assert.equal(result.changedLines, 0);
  assert.equal(result.matchingLines, 3);
});
test("flags missing and extra line IDs rather than matching by part", () => {
  const result = check({ line: "04" });
  assert.equal(result.changedLines, 2);
  assert.equal(result.lines[0].actual, null);
  assert.equal(result.lines[1].expected, null);
  assert.match(result.lines[0].changes[0].label, /Missing/);
  assert.match(result.lines[1].changes[0].label, /Extra/);
});
test("line IDs preserve leading zeros and case", () => {
  assert.equal(check({ line: "1" }).changedLines, 2);
  assert.equal(
    compareRows([row({ line: "A" })], [row({ line: "a" })]).changedLines,
    2,
  );
});
test("part differences are visible, including changes in case", () => {
  assert.equal(check({ part: "al-204" }).lines[0].changes[0].field, "part");
});
test("quantities and prices compare numerically at supported precision", () => {
  assert.equal(
    compareRows(
      [row({ quantity: "1.010", unit_price: "0.1000" })],
      [row({ quantity: "01.01", unit_price: "0.1" })],
    ).changedLines,
    0,
  );
  assert.equal(
    compareRows(
      [row({ unit_price: "0.1001" })],
      [row({ unit_price: "0.1002" })],
    ).lines[0].changes[0].label,
    "0.0001 higher per unit",
  );
  assert.equal(
    compareRows([row({ quantity: "0.101" })], [row({ quantity: "0.102" })])
      .lines[0].changes[0].label,
    "0.001 additional units",
  );
});
test("accepts zero quantity in acknowledgement but requires a positive PO quantity", () => {
  assert.equal(
    check({ quantity: "0" }).lines[0].changes[0].label,
    "120 fewer units",
  );
  assert.throws(
    () => compareRows([row({ quantity: "0" })], [row()]),
    /greater than 0/,
  );
});
test("every field difference is retained on a single line", () => {
  const result = check({
    part: "OTHER",
    quantity: "121",
    unit_price: "23.9",
    delivery_date: "2026-11-17",
  });
  assert.equal(result.changedLines, 1);
  assert.equal(result.differenceCount, 4);
  assert.deepEqual(
    result.lines[0].changes.map((item) => item.label),
    [
      "Part number differs",
      "1 additional unit",
      "0.10 lower per unit",
      "1 day earlier",
    ],
  );
});
test("delivery offsets handle leap days and daylight saving boundaries", () => {
  assert.equal(
    compareRows(
      [row({ delivery_date: "2028-02-28" })],
      [row({ delivery_date: "2028-03-01" })],
    ).lines[0].changes[0].label,
    "2 days later",
  );
  assert.equal(
    compareRows(
      [row({ delivery_date: "2026-11-01" })],
      [row({ delivery_date: "2026-11-02" })],
    ).lines[0].changes[0].label,
    "1 day later",
  );
});
test("rejects impossible dates and ambiguous date formats", () => {
  for (const date of [
    "2026-02-29",
    "2026-02-30",
    "2026-13-01",
    "11/18/2026",
    "2026-1-01",
    "2200-01-01",
    "2026-11-18T00:00:00Z",
  ])
    assert.throws(() => check({ delivery_date: date }), InputError, date);
});
test("rejects missing fields, duplicate IDs, controls and overlong identifiers", () => {
  for (const values of [
    { part: "" },
    { line: "" },
    { part: "a\nb" },
    { line: "x".repeat(81) },
    { quantity: "" },
    { unit_price: "" },
  ])
    assert.throws(() => check(values), InputError);
  assert.throws(() => compareRows([row(), row()], [row()]), /duplicated/);
});
test("rejects negative, ambiguous, excessive, nonfinite or overprecise numbers", () => {
  for (const value of [
    "-1",
    "+1",
    "1,000",
    "1e2",
    "$24",
    "NaN",
    "Infinity",
    "1000000.001",
    "1.0001",
    " ",
  ])
    assert.throws(() => check({ quantity: value }), InputError, value);
  for (const value of ["-0.1", "0.00001", "1000001", "24,00", "$24.00"])
    assert.throws(() => check({ unit_price: value }), InputError, value);
});
test("bounds line counts and allows the documented numerical limits", () => {
  const rows = Array.from({ length: MAX_LINES }, (_, index) =>
    row({ line: String(index) }),
  );
  assert.equal(compareRows(rows, rows).matchingLines, MAX_LINES);
  assert.throws(
    () => compareRows([...rows, row({ line: "extra" })], rows),
    /between 1 and 100/,
  );
  assert.throws(() => validateRows([]), InputError);
  assert.equal(
    check({ quantity: "1000000", unit_price: "1000000" }).differenceCount,
    2,
  );
});
test("CSV template roundtrips with exact part and line identifiers", () => {
  const parsed = parseSpreadsheet(spreadsheetTemplate(), "Purchase order");
  assert.equal(compareRows(parsed, SAMPLE.order).matchingLines, 3);
  assert.equal(parsed[0].line, "01");
});
test("imports reordered headers, quoted commas/quotes, BOM, CRLF and trailing newline", () => {
  const parsed = parseSpreadsheet(
    '\uFEFFpart,quantity,line,delivery_date,unit_price\r\n"A, B ""special""",2,01,2026-11-18,1.2500\r\n',
    "Purchase order",
  );
  assert.equal(parsed[0].part, 'A, B "special"');
  assert.equal(parsed[0].priceTenThousandths, 12500);
});
test("imports spreadsheet tab-separated data", () => {
  const text =
    "line\tpart\tquantity\tunit_price\tdelivery_date\n01\tAL-204\t120\t24.00\t2026-11-18";
  assert.equal(parseSpreadsheet(text)[0].quantityMilli, 120000);
});
test("rejects malformed quoting and wrong or missing columns", () => {
  const header = "line,part,quantity,unit_price,delivery_date\n";
  for (const text of [
    header + '01,"open,120,24,2026-11-18',
    header + '01,A"B,120,24,2026-11-18',
    header + '01,"closed"junk,120,24,2026-11-18',
    header + "01,AL-204,120,24",
    header + "01,AL-204,120,24,2026-11-18,extra",
    "part,part,quantity,unit_price,delivery_date\nA,A,1,1,2026-11-18",
    "line,part,quantity,unit_price,unexpected\n1,A,1,1,2026-11-18",
    header,
  ])
    assert.throws(() => parseSpreadsheet(text), InputError);
});
test("invalid CSV cannot silently skip rows or duplicate IDs", () => {
  const csv = spreadsheetTemplate();
  assert.throws(
    () => parseSpreadsheet(csv + "\n01,DUPLICATE,1,1,2026-11-18"),
    /duplicated/,
  );
  assert.throws(
    () => parseSpreadsheet(csv + "\n\n" + "04,A,1,1,2026-11-18"),
    /five cells/,
  );
  assert.throws(() => parseSpreadsheet("x".repeat(150001)), /150,000/);
});
test("HTML report escapes untrusted content and includes both source snapshots", () => {
  const result = compareRows(
    [row({ part: '<script>alert("x")</script>' })],
    [row({ part: '<img src=x onerror="alert(1)">' })],
  );
  const html = reportHTML(result, {
    reference: '</title><script>alert("ref")</script>',
    currency: "USD",
  });
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script"));
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes("<link"));
  assert.match(html, /Purchase order details/);
  assert.match(html, /Acknowledgement details/);
  assert.match(html, /do not approve an order/);
  assert.match(html, /source accuracy not verified/);
});
test("exports label samples, use allowed currency only, and report exact values", () => {
  const result = compareRows(SAMPLE.order, SAMPLE.acknowledgement);
  const text = reportText(result, {
    reference: "PO 8842",
    sample: true,
    currency: "EUR",
  });
  assert.match(text, /Illustrative sample data/);
  assert.match(text, /Unit prices in EUR/);
  assert.match(text, /2 lines to review; 3 differences; 1 line matches/);
  assert.match(text, /PO 120 \/ acknowledgement 100/);
  const html = reportHTML(result, { currency: "<img src=x>" });
  assert.match(html, /Unit price \(USD\)/);
  assert.ok(!html.includes("<img"));
});
test("compares without mutating either input and formats precise deltas", () => {
  const before = JSON.stringify(SAMPLE);
  compareRows(SAMPLE.order, SAMPLE.acknowledgement);
  assert.equal(JSON.stringify(SAMPLE), before);
  assert.equal(formatScaled(1, 4, 2), "0.0001");
  assert.equal(formatScaled(5000, 4, 2), "0.50");
});
