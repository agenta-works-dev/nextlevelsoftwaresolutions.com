export const MAX_LINES = 100;
export const COLUMNS = [
  "line",
  "part",
  "quantity",
  "unit_price",
  "delivery_date",
];
export const SAMPLE = Object.freeze({
  order: Object.freeze([
    Object.freeze({
      line: "01",
      part: "AL-204",
      quantity: "120",
      unit_price: "24.00",
      delivery_date: "2026-11-18",
    }),
    Object.freeze({
      line: "02",
      part: "BR-110",
      quantity: "40",
      unit_price: "8.50",
      delivery_date: "2026-11-18",
    }),
    Object.freeze({
      line: "03",
      part: "SE-008",
      quantity: "200",
      unit_price: "0.75",
      delivery_date: "2026-11-20",
    }),
  ]),
  acknowledgement: Object.freeze([
    Object.freeze({
      line: "01",
      part: "AL-204",
      quantity: "100",
      unit_price: "24.00",
      delivery_date: "2026-11-24",
    }),
    Object.freeze({
      line: "02",
      part: "BR-110",
      quantity: "40",
      unit_price: "9.00",
      delivery_date: "2026-11-18",
    }),
    Object.freeze({
      line: "03",
      part: "SE-008",
      quantity: "200",
      unit_price: "0.75",
      delivery_date: "2026-11-20",
    }),
  ]),
});

export class InputError extends Error {
  constructor(issues) {
    super(issues.join("\n"));
    this.name = "InputError";
    this.issues = issues;
  }
}

export function formatScaled(value, precision, minimum = 0) {
  const sign = value < 0 ? "−" : "";
  const digits = String(Math.abs(value)).padStart(precision + 1, "0");
  const whole = digits.slice(0, -precision);
  const fraction = digits
    .slice(-precision)
    .replace(/0+$/, "")
    .padEnd(minimum, "0");
  return `${sign}${whole}${fraction ? `.${fraction}` : ""}`;
}

function decimal(value, precision, allowZero) {
  if (!new RegExp(`^\\d{1,7}(?:\\.\\d{1,${precision}})?$`).test(value))
    return null;
  const [whole, fraction = ""] = value.split(".");
  const scaled =
    Number(whole) * 10 ** precision + Number(fraction.padEnd(precision, "0"));
  if (scaled > 1000000 * 10 ** precision || (!allowZero && scaled === 0))
    return null;
  return scaled;
}

function validDate(value) {
  if (!/^(?:19|20|21)\d{2}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

export function validateRows(rows, source = "Purchase order") {
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_LINES) {
    throw new InputError([
      `${source}: enter between 1 and ${MAX_LINES} lines.`,
    ]);
  }
  const issues = [];
  const seen = new Set();
  const normalized = rows.map((row, index) => {
    const values = Object.fromEntries(
      COLUMNS.map((key) => [key, String(row?.[key] ?? "").trim()]),
    );
    const label = `${source}, row ${index + 1}`;
    for (const key of ["line", "part"]) {
      if (
        !values[key] ||
        values[key].length > 80 ||
        /[\u0000-\u001f\u007f]/.test(values[key])
      ) {
        issues.push(
          `${label}: ${key === "line" ? "line ID" : "part number"} must be 1–80 characters on one line.`,
        );
      }
    }
    if (seen.has(values.line))
      issues.push(
        `${label}: line ID “${values.line}” is duplicated. Use a unique ID for each scheduled line.`,
      );
    seen.add(values.line);
    const quantityMilli = decimal(
      values.quantity,
      3,
      source !== "Purchase order",
    );
    const priceTenThousandths = decimal(values.unit_price, 4, true);
    if (quantityMilli === null)
      issues.push(
        `${label}: quantity must be ${source === "Purchase order" ? "greater than 0" : "0 or greater"}, at most 1,000,000, with up to 3 decimal places.`,
      );
    if (priceTenThousandths === null)
      issues.push(
        `${label}: unit price must be 0–1,000,000, with up to 4 decimal places and no currency symbol.`,
      );
    if (!validDate(values.delivery_date))
      issues.push(
        `${label}: use a real delivery date in YYYY-MM-DD format (1900–2199).`,
      );
    return { ...values, quantityMilli, priceTenThousandths };
  });
  if (issues.length) throw new InputError(issues);
  return normalized;
}

// Strict quoted CSV/TSV parsing: never silently discard a malformed row.
export function parseSpreadsheet(text, source = "Spreadsheet") {
  if (typeof text !== "string" || text.length > 150000)
    throw new InputError([`${source}: paste at most 150,000 characters.`]);
  const input = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!input)
    throw new InputError([
      `${source}: paste the header and at least one data row.`,
    ]);
  const delimiter = input
    .slice(0, input.indexOf("\n") < 0 ? input.length : input.indexOf("\n"))
    .includes("\t")
    ? "\t"
    : ",";
  const records = [];
  let fields = [],
    field = "",
    quoted = false,
    closed = false;
  const pushField = () => {
    fields.push(field);
    field = "";
    closed = false;
  };
  const pushRow = () => {
    pushField();
    records.push(fields);
    fields = [];
  };
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
        closed = true;
      } else field += char;
    } else if (char === delimiter) pushField();
    else if (char === "\n") pushRow();
    else if (char === '"' && field === "" && !closed) quoted = true;
    else if (char === '"' || closed)
      throw new InputError([
        `${source}: a quote is misplaced. Use standard CSV quotes around a whole cell.`,
      ]);
    else field += char;
    if (records.length > MAX_LINES + 1)
      throw new InputError([`${source}: use at most ${MAX_LINES} data lines.`]);
  }
  if (quoted) throw new InputError([`${source}: a quoted cell is not closed.`]);
  pushRow();
  const header = records.shift().map((value) => value.trim().toLowerCase());
  if (
    header.length !== COLUMNS.length ||
    new Set(header).size !== COLUMNS.length ||
    !COLUMNS.every((key) => header.includes(key))
  ) {
    throw new InputError([
      `${source}: keep these five column headers: ${COLUMNS.join(", ")}.`,
    ]);
  }
  const rows = records.map((values, index) => {
    if (values.length !== COLUMNS.length)
      throw new InputError([
        `${source}, row ${index + 1}: expected five cells; found ${values.length}.`,
      ]);
    return Object.fromEntries(header.map((key, cell) => [key, values[cell]]));
  });
  return validateRows(rows, source);
}

export function compareRows(orderRows, acknowledgementRows) {
  const order = validateRows(orderRows, "Purchase order");
  const acknowledgement = validateRows(acknowledgementRows, "Acknowledgement");
  const acknowledgementMap = new Map(
    acknowledgement.map((row) => [row.line, row]),
  );
  const orderIds = new Set(order.map((row) => row.line));
  const lines = order.map((expected) => {
    const actual = acknowledgementMap.get(expected.line);
    const changes = [];
    if (!actual)
      changes.push({
        field: "line",
        label: "Missing from acknowledgement",
        expected: expected.part,
        actual: "Not present",
      });
    else {
      if (expected.part !== actual.part)
        changes.push({
          field: "part",
          label: "Part number differs",
          expected: expected.part,
          actual: actual.part,
        });
      if (expected.quantityMilli !== actual.quantityMilli) {
        const delta = actual.quantityMilli - expected.quantityMilli;
        changes.push({
          field: "quantity",
          label: `${formatScaled(Math.abs(delta), 3)} ${delta < 0 ? "fewer" : "additional"} ${Math.abs(delta) === 1000 ? "unit" : "units"}`,
          expected: formatScaled(expected.quantityMilli, 3),
          actual: formatScaled(actual.quantityMilli, 3),
        });
      }
      if (expected.priceTenThousandths !== actual.priceTenThousandths) {
        const delta = actual.priceTenThousandths - expected.priceTenThousandths;
        changes.push({
          field: "unit_price",
          label: `${formatScaled(Math.abs(delta), 4, 2)} ${delta < 0 ? "lower" : "higher"} per unit`,
          expected: formatScaled(expected.priceTenThousandths, 4, 2),
          actual: formatScaled(actual.priceTenThousandths, 4, 2),
        });
      }
      if (expected.delivery_date !== actual.delivery_date) {
        const days = Math.round(
          (Date.parse(`${actual.delivery_date}T00:00:00Z`) -
            Date.parse(`${expected.delivery_date}T00:00:00Z`)) /
            86400000,
        );
        changes.push({
          field: "delivery_date",
          label: `${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} ${days < 0 ? "earlier" : "later"}`,
          expected: expected.delivery_date,
          actual: actual.delivery_date,
        });
      }
    }
    return {
      line: expected.line,
      part: expected.part,
      expected,
      actual: actual ?? null,
      changes,
    };
  });
  for (const actual of acknowledgement) {
    if (!orderIds.has(actual.line))
      lines.push({
        line: actual.line,
        part: actual.part,
        expected: null,
        actual,
        changes: [
          {
            field: "line",
            label: "Extra line in acknowledgement",
            expected: "Not present",
            actual: actual.part,
          },
        ],
      });
  }
  return {
    order,
    acknowledgement,
    lines,
    changedLines: lines.filter((line) => line.changes.length).length,
    matchingLines: lines.filter((line) => !line.changes.length).length,
    differenceCount: lines.reduce(
      (total, line) => total + line.changes.length,
      0,
    ),
  };
}

export const SCOPE =
  "Lines are matched by the exact line ID. Checks part number, quantity, unit price, and delivery date. Prices must use the same currency and unit basis. Taxes, freight, unit conversions, other terms, and document authenticity are outside this check. Findings support review; they do not approve an order.";

export function escapeHTML(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
}

function safeMetadata(meta = {}) {
  return {
    reference:
      String(meta.reference ?? "Order comparison")
        .trim()
        .slice(0, 100) || "Order comparison",
    currency: ["USD", "CAD", "EUR", "GBP", "AUD"].includes(meta.currency)
      ? meta.currency
      : "USD",
    sample: meta.sample === true,
    generatedAt: new Date().toISOString(),
  };
}

export function reportText(result, metadata) {
  const meta = safeMetadata(metadata);
  return [
    "NEXT LEVEL SOFTWARE SOLUTIONS | ORDER COMPARISON",
    meta.reference,
    meta.sample
      ? "Illustrative sample data"
      : "Visitor-entered data; source accuracy not verified",
    `Generated ${meta.generatedAt} | Unit prices in ${meta.currency}`,
    `${result.changedLines} lines to review; ${result.differenceCount} differences; ${result.matchingLines} ${result.matchingLines === 1 ? "line matches" : "lines match"} the checked fields.`,
    "",
    ...result.lines.flatMap((line) => [
      `Line ${line.line} | ${line.part}`,
      ...(line.changes.length
        ? line.changes.map(
            (change) =>
              `- ${change.label}: PO ${change.expected} / acknowledgement ${change.actual}`,
          )
        : ["- Checked fields match"]),
      "",
    ]),
    SCOPE,
    "",
    "Built by Next Level Software Solutions LLC",
    "https://nextlevelsoftwaresolutions.com/",
    "",
  ].join("\n");
}

export function reportHTML(result, metadata) {
  const meta = safeMetadata(metadata);
  const e = escapeHTML;
  const sourceTable = (rows, heading) =>
    `<h2>${heading}</h2><table><thead><tr><th>Line</th><th>Part</th><th>Quantity</th><th>Unit price (${meta.currency})</th><th>Delivery</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${e(row.line)}</td><td>${e(row.part)}</td><td>${formatScaled(row.quantityMilli, 3)}</td><td>${formatScaled(row.priceTenThousandths, 4, 2)}</td><td>${row.delivery_date}</td></tr>`).join("")}</tbody></table>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${e(meta.reference)} | Order comparison</title><style>body{font:15px/1.6 system-ui,sans-serif;color:#142e3d;max-width:1000px;margin:40px auto;padding:0 24px}h1{font-size:38px;line-height:1.1}h2{margin-top:32px;font-size:22px}p{max-width:800px}.eyebrow{font-size:11px;letter-spacing:.13em;font-weight:700;color:#2154c5}.summary{padding:20px;background:#eaf0e9}table{border-collapse:collapse;width:100%;font-size:12px;margin:18px 0;overflow-wrap:anywhere}th,td{border-bottom:1px solid #d7deda;text-align:left;vertical-align:top;padding:10px 7px}th{background:#f5f6f2}small{color:#526671}.scope{border-top:1px solid #d7deda;margin-top:32px;padding-top:20px;font-size:12px}@media print{body{margin:0;padding:0;font-size:11px}h1{font-size:28px}h2{break-after:avoid}tr{break-inside:avoid}thead{display:table-header-group}a{color:inherit;text-decoration:none}@page{margin:16mm}}</style></head><body><p class="eyebrow">NEXT LEVEL SOFTWARE SOLUTIONS / WORKING EXAMPLE</p><h1>Supplier acknowledgement check</h1><p><strong>${e(meta.reference)}</strong><br><small>${meta.sample ? "Illustrative sample data" : "Visitor-entered data; source accuracy not verified"} · Generated ${meta.generatedAt} · ${meta.currency}</small></p><p class="summary"><strong>${result.changedLines} ${result.changedLines === 1 ? "line" : "lines"} to review</strong> · ${result.differenceCount} ${result.differenceCount === 1 ? "difference" : "differences"} · ${result.matchingLines} ${result.matchingLines === 1 ? "line matches" : "lines match"} the checked fields</p><h2>Findings</h2><table><thead><tr><th>Line / part</th><th>Finding</th><th>Purchase order</th><th>Acknowledgement</th></tr></thead><tbody>${result.lines.map((line) => (line.changes.length ? line.changes.map((change) => `<tr><td>${e(line.line)} / ${e(line.part)}</td><td>${e(change.label)}</td><td>${e(change.expected)}</td><td>${e(change.actual)}</td></tr>`).join("") : `<tr><td>${e(line.line)} / ${e(line.part)}</td><td colspan="3">Checked fields match</td></tr>`)).join("")}</tbody></table>${sourceTable(result.order, "Purchase order details")}${sourceTable(result.acknowledgement, "Acknowledgement details")}<p class="scope">${SCOPE}</p><p><strong>Next Level Software Solutions LLC</strong><br><a href="https://nextlevelsoftwaresolutions.com/">nextlevelsoftwaresolutions.com</a><br><small>Custom software, connected systems, and practical automation.</small></p></body></html>`;
}

export function spreadsheetTemplate(rows = SAMPLE.order) {
  return [
    COLUMNS.join(","),
    ...rows.map((row) =>
      COLUMNS.map((key) => `"${String(row[key]).replace(/"/g, '""')}"`).join(
        ",",
      ),
    ),
  ].join("\n");
}
