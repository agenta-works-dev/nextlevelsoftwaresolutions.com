import {
  COLUMNS,
  MAX_LINES,
  SAMPLE,
  InputError,
  parseSpreadsheet,
  compareRows,
  reportHTML,
  reportText,
  spreadsheetTemplate,
  SCOPE,
} from "./order-check-model.js?v=27b507b89e79";

const form = document.querySelector("#order-comparison");
const results = document.querySelector("[data-results]");
const resultSection = document.querySelector("#results");
const status = document.querySelector("[data-status]");
const errors = document.querySelector("[data-errors]");
const actions = document.querySelector("[data-report-actions]");
const message = document.querySelector("[data-export-message]");
const reference = document.querySelector("#order-reference");
const currency = document.querySelector("#order-currency");
const fallback = document.querySelector("[data-copy-fallback]");
const labels = {
  line: "Line ID",
  part: "Part number",
  quantity: "Quantity",
  unit_price: "Unit price",
  delivery_date: "Delivery date",
};
const sourceLabels = {
  order: "Purchase order",
  acknowledgement: "Acknowledgement",
};
let isSample = true;
let comparison = null;

function element(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}
function bodyFor(source) {
  return document.querySelector(`[data-rows="${source}"]`);
}
function rowsFor(source) {
  return [...bodyFor(source).rows].map((row) =>
    Object.fromEntries(
      [...row.querySelectorAll("input")].map((input) => [
        input.dataset.field,
        input.value,
      ]),
    ),
  );
}
function updateLabels(source) {
  const rows = [...bodyFor(source).rows];
  rows.forEach((row, index) => {
    for (const input of row.querySelectorAll("input"))
      input.setAttribute(
        "aria-label",
        `${sourceLabels[source]} row ${index + 1}: ${labels[input.dataset.field]}`,
      );
    row
      .querySelector("button")
      .setAttribute(
        "aria-label",
        `Remove ${sourceLabels[source].toLowerCase()} row ${index + 1}`,
      );
  });
  document.querySelector(`[data-count="${source}"]`).textContent =
    `${rows.length} ${rows.length === 1 ? "line" : "lines"}`;
  document.querySelector(`[data-add="${source}"]`).disabled =
    rows.length >= MAX_LINES;
}
function addRow(source, data = {}) {
  const row = document.createElement("tr");
  for (const field of COLUMNS) {
    const cell = document.createElement("td");
    const label = document.createElement("label");
    label.append(element("span", "", labels[field]));
    const input = document.createElement("input");
    input.type = "text";
    input.dataset.field = field;
    input.value = data[field] ?? "";
    input.maxLength = ["line", "part"].includes(field) ? 80 : 24;
    input.autocomplete = "off";
    input.spellcheck = false;
    input.required = true;
    if (["quantity", "unit_price"].includes(field)) input.inputMode = "decimal";
    if (field === "delivery_date") input.placeholder = "YYYY-MM-DD";
    label.append(input);
    cell.append(label);
    row.append(cell);
  }
  const removeCell = document.createElement("td");
  const remove = element("button", "remove-line", "×");
  remove.type = "button";
  remove.dataset.remove = source;
  removeCell.append(remove);
  row.append(removeCell);
  bodyFor(source).append(row);
  updateLabels(source);
  return row;
}
function fillRows(source, rows) {
  bodyFor(source).replaceChildren();
  rows.forEach((row) => addRow(source, row));
}
function dataLabel() {
  document.querySelector("[data-data-label]").textContent = isSample
    ? "Illustrative sample data"
    : "Your working copy · kept in this page";
}
function hideErrors() {
  errors.hidden = true;
  errors.replaceChildren();
}
function showErrors(error) {
  const issues =
    error instanceof InputError
      ? error.issues
      : ["The details could not be compared. Check the entries and try again."];
  errors.replaceChildren(element("h3", "", "A few details need attention."));
  const list = document.createElement("ul");
  issues.slice(0, 12).forEach((issue) => list.append(element("li", "", issue)));
  if (issues.length > 12)
    list.append(
      element(
        "li",
        "",
        `Plus ${issues.length - 12} more. Check each row before comparing again.`,
      ),
    );
  errors.append(list);
  errors.hidden = false;
  errors.focus();
}
function invalidate(
  text = "Details changed. Compare again to update the findings.",
) {
  comparison = null;
  actions.hidden = true;
  fallback.hidden = true;
  message.textContent = "";
  status.textContent = "Awaiting comparison";
  results.replaceChildren(element("p", "pending-comparison", text));
}
function markEdited() {
  isSample = false;
  dataLabel();
  hideErrors();
  invalidate();
}
function metadata() {
  return {
    reference: reference.value,
    currency: currency.value,
    sample: isSample,
  };
}
function renderComparison(result) {
  const totals = element(
    "div",
    `result-totals${result.changedLines ? " is-review" : ""}`,
  );
  for (const [number, label] of [
    [result.changedLines, "Lines to review"],
    [result.differenceCount, "Differences found"],
    [result.matchingLines, "Lines with checked fields matching"],
  ]) {
    const item = document.createElement("div");
    item.append(
      element("strong", "", String(number)),
      element("span", "", label),
    );
    totals.append(item);
  }
  const wrap = element("div", "findings-table-wrap");
  wrap.tabIndex = 0;
  wrap.setAttribute("role", "region");
  wrap.setAttribute("aria-label", "Comparison findings");
  const table = element("table", "findings-table");
  table.append(
    element(
      "caption",
      "sr-only",
      "Differences between purchase order and acknowledgement",
    ),
  );
  const head = document.createElement("thead");
  const header = document.createElement("tr");
  ["Line / part", "Finding", "Purchase order", "Acknowledged"].forEach(
    (label) => {
      const th = element("th", "", label);
      th.scope = "col";
      header.append(th);
    },
  );
  head.append(header);
  table.append(head);
  const body = document.createElement("tbody");
  for (const line of result.lines) {
    const changes = line.changes.length ? line.changes : [null];
    changes.forEach((change) => {
      const row = document.createElement("tr");
      const identity = document.createElement("td");
      identity.append(
        element("strong", "", line.line),
        element("small", "", line.part),
      );
      row.append(identity);
      if (change) {
        const label =
          change.field === "unit_price"
            ? `${change.label} (${currency.value})`
            : change.label;
        row.append(
          element("td", "finding-label", label),
          element("td", "", change.expected),
          element("td", "", change.actual),
        );
      } else {
        const match = element(
          "td",
          "finding-match",
          "Part, quantity, unit price, and delivery date match.",
        );
        match.colSpan = 3;
        row.append(match);
      }
      body.append(row);
    });
  }
  table.append(body);
  wrap.append(table);
  results.replaceChildren(totals, wrap, element("p", "results-scope", SCOPE));
  const name = reference.value.trim() || "Order comparison";
  status.textContent = `${name} · ${currency.value} · ${isSample ? "Sample data" : "Visitor-entered data"}`;
  actions.hidden = false;
}
function compare(focus = true) {
  hideErrors();
  invalidate("Complete the details above, then compare them.");
  try {
    const result = compareRows(rowsFor("order"), rowsFor("acknowledgement"));
    comparison = result;
    renderComparison(result);
    if (focus) resultSection.focus();
  } catch (error) {
    showErrors(error);
  }
}
function loadSample() {
  fillRows("order", SAMPLE.order);
  fillRows("acknowledgement", SAMPLE.acknowledgement);
  reference.value = "PO 8842";
  currency.value = "USD";
  document.querySelectorAll(".spreadsheet-import textarea").forEach((input) => {
    input.value = "";
  });
  isSample = true;
  dataLabel();
  compare(false);
}
function download(content, name, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  compare();
});
form.addEventListener("input", (event) => {
  if (event.target.matches(".order-input-table input")) markEdited();
});
for (const input of [reference, currency])
  input.addEventListener("input", () => {
    hideErrors();
    invalidate();
  });
form.addEventListener("click", (event) => {
  const add = event.target.closest("[data-add]");
  if (add) {
    const source = add.dataset.add;
    if (bodyFor(source).rows.length >= MAX_LINES) return;
    const row = addRow(source);
    markEdited();
    row.querySelector("input").focus();
  }
  const remove = event.target.closest("[data-remove]");
  if (remove) {
    const source = remove.dataset.remove;
    remove.closest("tr").remove();
    if (!bodyFor(source).rows.length) addRow(source);
    updateLabels(source);
    markEdited();
    document.querySelector(`[data-add="${source}"]`).focus();
  }
  const importButton = event.target.closest("[data-import]");
  if (importButton) {
    const source = importButton.dataset.import;
    invalidate("Apply valid spreadsheet rows, then compare the details above.");
    hideErrors();
    try {
      const rows = parseSpreadsheet(
        document.querySelector(`#import-${source}`).value,
        sourceLabels[source],
      );
      fillRows(source, rows);
      markEdited();
      status.textContent = `${rows.length} ${sourceLabels[source].toLowerCase()} lines imported. Compare to see the findings.`;
      bodyFor(source).querySelector("input").focus();
    } catch (error) {
      showErrors(error);
    }
  }
});
document
  .querySelector("[data-load-sample]")
  .addEventListener("click", loadSample);
document.querySelector("[data-clear-orders]").addEventListener("click", () => {
  fillRows("order", [{}]);
  fillRows("acknowledgement", [{}]);
  reference.value = "";
  document.querySelectorAll(".spreadsheet-import textarea").forEach((input) => {
    input.value = "";
  });
  markEdited();
  bodyFor("order").querySelector("input").focus();
});
document.querySelector("[data-template]").addEventListener("click", (event) => {
  event.preventDefault();
  download(
    spreadsheetTemplate(),
    "next-level-order-template.csv",
    "text/csv;charset=utf-8",
  );
});
document
  .querySelector("[data-download-report]")
  .addEventListener("click", () => {
    if (!comparison) return;
    download(
      reportHTML(comparison, metadata()),
      "next-level-order-comparison.html",
      "text/html;charset=utf-8",
    );
    message.textContent =
      "Report downloaded. Open it in a browser to print or save as PDF.";
  });
document
  .querySelector("[data-copy-report]")
  .addEventListener("click", async () => {
    if (!comparison) return;
    const snapshot = comparison;
    const text = reportText(comparison, metadata());
    try {
      await navigator.clipboard.writeText(text);
      if (comparison === snapshot) message.textContent = "Summary copied.";
    } catch {
      if (comparison !== snapshot) return;
      const textarea = fallback.querySelector("textarea");
      textarea.value = text;
      fallback.hidden = false;
      textarea.focus();
      textarea.select();
      message.textContent = "Select and copy the summary below.";
    }
  });
document.querySelector("[data-print-report]").addEventListener("click", () => {
  if (comparison) window.print();
});
loadSample();
