import { readDocument, sourceForAPI } from "./readers.js";
import { compareDocuments } from "./compare.js";
import { validateExtraction, DOCUMENT_FIELDS, LINE_FIELDS } from "./schema.js";
import {
  businessScope,
  sameScope,
  createProfile,
  validateProfile,
  importProfiles,
  mergeProfiles,
  profileHints,
  profileMatchesSource,
} from "./profiles.js";
import {
  comparisonText,
  comparisonHTML,
  sourceReference,
  freezeRun,
} from "./report.js";
import { SAMPLES } from "./samples.js";
import { loadRecordedSample } from "./recordings.js";
import { escapeHTML as e } from "../order-check-model.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const STORAGE_KEY = "nlss-order-profiles-v1";
const names = {
  documentNumber: "Document identifier",
  orderReference: "Order reference",
  customer: "Customer",
  supplier: "Supplier",
  currency: "Currency",
  buyerPart: "Customer part",
  supplierPart: "Supplier part",
  description: "Description",
  quantity: "Quantity",
  unit: "Quantity unit",
  unitPrice: "Quoted price",
  priceBasisQuantity: "Price covers quantity",
  priceBasisUnit: "Price covers unit",
  extendedPrice: "Extended value",
  date: "Fulfillment date",
};
const state = {
  sources: {},
  files: {},
  generations: { po: 0, ack: 0 },
  extraction: null,
  baseline: null,
  answers: {},
  receipt: null,
  result: null,
  corrections: [],
  history: [],
  profiles: [],
  service: null,
  busy: false,
  liveAbort: null,
  sample: null,
  firstQuestions: null,
  answered: new Set(),
  filter: "all",
  refs: [],
  fields: [],
  correction: null,
  captchaToken: "",
  operation: 0,
};
const sources = () => [state.sources.po, state.sources.ack].filter(Boolean);
const latestProfiles = () => [
  ...new Map(
    [...state.profiles]
      .sort((a, b) => a.revision - b.revision)
      .map((p) => [p.id, p]),
  ).values(),
];
function error(message) {
  const el = $("[data-error]");
  el.textContent = message;
  el.hidden = !message;
  if (message) {
    el.focus();
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}
function announce(text) {
  $("[data-analysis-note]").textContent = text;
}
function progress(step) {
  $$("[data-progress]").forEach((el) => {
    if (el.dataset.progress === step) el.setAttribute("aria-current", "step");
    else el.removeAttribute("aria-current");
  });
}
function busy(
  value,
  title = "Reading the documents…",
  description = "Selected files are being read locally. Nothing has been sent to a model.",
) {
  state.busy = value;
  $("[data-busy]").hidden = !value;
  $("[data-busy-title]").textContent = title;
  $("[data-busy-description]").textContent = description;
  $$(
    "[data-sample], [data-repeat], input[type=file], [data-import-profile], [data-hidden-choice] input",
  ).forEach((el) => (el.disabled = value));
  updateAdmission();
}
function updateAdmission() {
  maybeVerifyHuman();
  const service = state.service;
  $("[data-interpret]").disabled =
    state.busy ||
    sources().length !== 2 ||
    !$("#processing-consent").checked ||
    !service?.configured ||
    !service.publicEnabled ||
    service.trialUsed ||
    (service.captchaRequired && !state.captchaToken);
  if (!state.busy && service?.trialUsed)
    announce(
      "This browser’s live AI interpretation has been used. Clarifications, corrections, downloads, and recorded samples remain available.",
    );
}
function maybeVerifyHuman() {
  const status = state.service;
  if (
    !status?.captchaRequired ||
    !status.configured ||
    !status.publicEnabled ||
    status.trialUsed ||
    !status.captchaSiteKey ||
    !$("#processing-consent").checked ||
    sources().length !== 2 ||
    state.captchaWidget !== undefined
  )
    return;
  const render = () => {
    state.captchaWidget = window.turnstile.render(
      $("[data-human-verification]"),
      {
        sitekey: status.captchaSiteKey,
        action: "order-check",
        callback: (token) => {
          state.captchaToken = token;
          updateAdmission();
        },
        "expired-callback": () => {
          state.captchaToken = "";
          updateAdmission();
        },
        "error-callback": () => {
          state.captchaToken = "";
          updateAdmission();
        },
      },
    );
  };
  if (window.turnstile) {
    render();
    return;
  }
  if ($("script[data-turnstile]")) return;
  const script = document.createElement("script");
  script.dataset.turnstile = "true";
  script.src =
    "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  script.async = true;
  script.onload = () => {
    if ($("#processing-consent").checked && sources().length === 2) render();
  };
  script.onerror = () => {
    script.remove();
    error(
      "Human verification could not load. No document has been sent to an AI provider.",
    );
  };
  document.head.append(script);
}
async function health() {
  try {
    const response = await fetch("/api/order-checker/status", {
      credentials: "same-origin",
      cache: "no-store",
    });
    const status = await response.json();
    if (!response.ok)
      throw new Error(
        status.error || "The interpretation service is unavailable.",
      );
    state.service = status;
    const provider =
      status.provider === "qwen"
        ? "Qwen / Alibaba Cloud Model Studio"
        : "OpenAI";
    $("[data-provider-disclosure]").innerHTML =
      `Files are read locally first. Live interpretation sends their selected text and rendered pages to <strong>${e(provider)}</strong> (${e(status.model)}, ${e(status.region)}). ${e(status.privacy)} <a href="${e(status.privacyURL)}" target="_blank" rel="noreferrer">Provider processing policy ↗</a>`;
    const el = $("[data-service-status]");
    el.classList.toggle("is-ready", status.configured && status.publicEnabled);
    el.innerHTML = status.configured
      ? status.trialUsed
        ? "<strong>Your free AI interpretation has been used.</strong>Keep working with the current comparison, or explore the recorded samples below."
        : `<strong>${status.reviewMode ? "Private review service" : "Live interpretation"} ready · ${e(status.model)}</strong>One free document-pair interpretation per browser. Questions, corrections, and comparisons happen locally.`
      : "<strong>The learning demonstration is ready. Live AI needs private configuration.</strong>Try the sample documents below. Your own unfamiliar files can be read and inspected locally; AI interpretation becomes available after a provider key is configured on the private server.";
    if (!status.publicEnabled)
      el.innerHTML =
        "<strong>This revised application is awaiting deployment approval.</strong>The recorded sample demonstration is available. No live AI upload will be sent.";
  } catch {
    state.service = null;
    $("[data-service-status]").innerHTML =
      "<strong>Live AI is unavailable on this preview.</strong>The original-format sample files, source inspection, questions, and local comparison remain available. Your documents have not been sent to a model.";
  }
  updateAdmission();
}
function renderFile(role) {
  const s = state.sources[role],
    info = $(`[data-file-info="${role}"]`);
  info.hidden = !s;
  $(`[data-preview="${role}"]`).hidden = !s;
  $(`[data-file-state="${role}"]`).textContent = s
    ? "Read locally"
    : "Not selected";
  $(`[data-hidden-choice="${role}"]`).hidden = !s || s.format !== "xlsx";
  info.innerHTML = s
    ? `<strong>${e(s.name)}</strong><p>${e(s.format.toUpperCase())} · ${(s.bytes / 1024).toFixed(0)} KB · ${s.pages.length ? `${s.pages.length} page(s)` : `${s.sheets.length} worksheet(s)`} · not sent yet</p>${s.warnings.map((w) => `<p class="file-warning">${e(w)}</p>`).join("")}`
    : "";
}
function resetInterpretation() {
  closeSource();
  state.extraction = null;
  state.baseline = null;
  state.result = null;
  state.answers = {};
  state.receipt = null;
  state.corrections = [];
  state.sample = null;
  state.answered.clear();
  state.refs = [];
  state.fields = [];
  $("[data-sample-context]").hidden = true;
  $("[data-sample-context]").replaceChildren();
  for (const target of [
    "document-summaries",
    "extracted-fields",
    "questions",
    "findings",
    "comparison-counts",
    "receipt",
    "previous-list",
    "learning-documents",
    "source-content",
    "source-quote",
    "source-file",
    "source-location",
    "source-custody",
  ])
    $(`[data-${target}]`).replaceChildren();
  $("[data-copy-fallback]").value = "";
  $("[data-copy-fallback]").hidden = true;
  const correctionForm = $("[data-correction-form]");
  correctionForm.reset();
  correctionForm.elements.source.replaceChildren();
  ["interpretation", "comparison", "learning"].forEach(
    (name) => ($(`[data-${name}]`).hidden = true),
  );
  progress("upload");
}
async function chooseFile(role, file) {
  if (!file || state.busy) return;
  error("");
  state.operation++;
  const generation = ++state.generations[role];
  snapshot("Before replacing a document");
  resetInterpretation();
  delete state.sources[role];
  renderFile(role);
  state.files[role] = file;
  busy(true);
  try {
    const s = await readDocument(file, role, {
      includeHidden: $(`#hidden-${role}`).checked,
      onProgress: (title) => ($("[data-busy-title]").textContent = title),
    });
    if (generation !== state.generations[role]) return;
    state.sources[role] = s;
    renderFile(role);
    announce(
      "Files are read locally. Review the processing notice before using the live AI interpretation.",
    );
  } catch (err) {
    if (generation === state.generations[role]) error(err.message);
  } finally {
    if (generation === state.generations[role]) busy(false);
  }
}
function snapshot(reason) {
  if (!state.result) return;
  const run = freezeRun({
    result: state.result,
    receipt: state.receipt,
    sources: sources(),
    extraction: state.extraction,
    baselineExtraction: state.baseline,
    answers: state.answers,
    corrections: state.corrections,
    reason,
  });
  state.history.unshift(run);
  state.history.length = Math.min(state.history.length, 5);
}
function acceptInterpretation({ extraction, receipt }, sample = null) {
  snapshot("Before loading another document pair");
  state.baseline = freezeRun(extraction);
  state.extraction = structuredClone(extraction);
  state.receipt = receipt;
  state.answers = {};
  state.corrections = [];
  state.answered.clear();
  state.sample = sample;
  state.filter = "all";
  compare();
  $("[data-interpretation]").focus();
  $("[data-interpretation]").scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}
async function loadSample(key) {
  if (state.busy) return;
  const sample = SAMPLES[key];
  if (!sample) return;
  const operation = ++state.operation;
  error("");
  snapshot("Before loading another sample");
  resetInterpretation();
  busy(true, "Opening the original sample documents…");
  try {
    const manifest = await (
      await fetch("assets/order-samples/manifest.json", { cache: "no-store" })
    ).json();
    const fresh = [];
    for (let i = 0; i < sample.files.length; i++) {
      const name = sample.files[i],
        response = await fetch(`assets/order-samples/${name}`);
      if (!response.ok)
        throw new Error("A sample document could not be opened.");
      const file = new File([await response.blob()], name);
      const role = i ? "ack" : "po";
      const source = await readDocument(file, role, {
        onProgress: (title) => ($("[data-busy-title]").textContent = title),
      });
      if (operation !== state.operation) return;
      state.files[role] = file;
      state.sources[role] = source;
      state.generations[role]++;
      $(`#file-${role}`).value = "";
      $(`#hidden-${role}`).checked = false;
      $(`#own-${role}`).checked = role === "po";
      renderFile(role);
      fresh.push(source);
    }
    if (operation !== state.operation) return;
    const interpretation = await loadRecordedSample(key, fresh, manifest);
    if (operation !== state.operation) return;
    acceptInterpretation(interpretation, key);
    announce(
      "Recorded AI readings of these exact fictional files were replayed. No new model call was made, and your free interpretation was not consumed.",
    );
  } catch (err) {
    if (operation === state.operation) error(err.message);
  } finally {
    if (operation === state.operation) busy(false);
  }
}
async function interpret() {
  if ($("[data-interpret]").disabled) return;
  const operation = ++state.operation;
  const submitted = sources();
  const abort = new AbortController();
  state.liveAbort = abort;
  error("");
  busy(
    true,
    "Understanding the documents…",
    `Selected text and rendered pages are being processed by ${state.service.model}. This is the browser’s one free live interpretation; clarification and comparison will stay local.`,
  );
  try {
    const response = await fetch("/api/order-checker/interpret", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-Order-Verification": state.captchaToken,
      },
      body: JSON.stringify({
        consent: true,
        sources: submitted.map(sourceForAPI),
        profileHints: profileHints(latestProfiles(), submitted),
        captchaToken: state.captchaToken,
      }),
      signal: abort.signal,
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        data.error || "The interpretation could not be completed.",
      );
    if (operation !== state.operation) return;
    const extraction = validateExtraction(data.extraction, submitted);
    acceptInterpretation({ extraction, receipt: data.receipt });
    announce(
      "Live interpretation complete. Your answers, calculations, and profile changes now happen locally.",
    );
  } catch (err) {
    if (operation === state.operation)
      error(
        err.name === "AbortError"
          ? "The live request was cancelled. If the provider had already started processing, the free attempt may have been consumed. No partial interpretation is presented as complete."
          : err.message,
      );
  } finally {
    if (operation === state.operation) {
      state.liveAbort = null;
      busy(false);
      await health();
    }
  }
}
function sourceButton(ref, text = null) {
  const existing = state.refs.findIndex(
    (r) =>
      r.anchorId === ref.anchorId &&
      r.quote === ref.quote &&
      JSON.stringify(r.bbox) === JSON.stringify(ref.bbox),
  );
  const index = existing < 0 ? state.refs.push(ref) - 1 : existing;
  return `<button type="button" class="source-link" data-source-ref="${index}">${e(text || sourceReference(ref, sources()))} ↗</button>`;
}
function evidenceButtons(evidence, max = 4) {
  return [
    ...new Map(
      evidence.map((r) => [r.anchorId + JSON.stringify(r.bbox), r]),
    ).values(),
  ]
    .slice(0, max)
    .map((r) => sourceButton(r))
    .join(" ");
}
function valueHTML(field) {
  if (!field?.value && !field?.raw) return "<span>Not located</span>";
  return `${field.evidence?.length ? sourceButton(field.evidence[0], field.raw || field.value) : e(field.value)}<span class="reading-certainty">${field.certainty === "uncertain" ? "Needs clarification" : field.evidence?.some((r) => r.support === "image_reference") ? (state.receipt?.mode === "recorded" ? "Recorded AI image transcription · inspect source" : "AI image transcription · inspect source") : "Source text located"}</span>`;
}
function renderInterpretation() {
  const extraction = state.extraction;
  if (!extraction) return;
  const sampleContext = $("[data-sample-context]");
  sampleContext.hidden = !["units", "repeat"].includes(state.sample);
  sampleContext.innerHTML = sampleContext.hidden
    ? ""
    : `<strong>Your role in this fictional example</strong><p>You know that Harbor’s H-G8 is your GSK-8 gasket, that each BOX contains 12 gaskets, and that 9.60 prices one whole box. The forms leave out that working knowledge. Confirm those facts when asked; the application learns them from your answers.</p>`;
  $("[data-interpretation]").hidden = false;
  $("[data-interpretation-badge]").textContent =
    state.receipt?.mode === "recorded"
      ? "Recorded AI readings · no new model call"
      : `AI-assisted · ${state.receipt?.model || "model recorded below"}`;
  $("[data-interpretation-summary]").textContent =
    state.receipt?.mode === "recorded"
      ? "These exact fictional files were previously interpreted by OpenAI. You are replaying that real extraction, then supplying your own answers and saving your own learning. No new model call is made. Live uploads use a fresh interpretation of your documents."
      : "AI identified candidate fields and source locations. Inspect or correct a reading below. Source citations locate evidence; they do not authenticate the documents.";
  $("[data-document-summaries]").innerHTML = extraction.documents
    .map(
      (d) =>
        `<article class="interpreted-document"><p class="eyebrow">${d.id === "po" ? "THE ORDER" : "THE REPLY"}</p><h3>${e(d.documentNumber.value || "Identifier needs review")}</h3><dl>${[
          "customer",
          "supplier",
          "orderReference",
          "currency",
        ]
          .filter((k) => d[k].value)
          .map((k) => `<dt>${names[k]}</dt><dd>${valueHTML(d[k])}</dd>`)
          .join(
            "",
          )}<dt>Items located</dt><dd>${d.lines.length}${d.lines.some((l) => l.schedules.length) ? ` · ${d.lines.reduce((n, l) => n + l.schedules.length, 0)} schedule entries` : ""}</dd></dl><div class="sample-downloads">${state.sample ? `<a href="assets/order-samples/${e(state.sources[d.id].name)}" download>Download this original sample ↓</a>` : ""}<button class="source-link" type="button" data-preview="${d.id}">Inspect the whole document ↗</button></div></article>`,
    )
    .join("");
  state.fields = [];
  const row = (d, line, field, obj, schedule = null) => {
    const index =
      state.fields.push({
        role: d.id,
        lineId: line?.id || "document",
        field,
        scheduleId: schedule?.id || null,
      }) - 1;
    return `<tr><td>${e(names[field] || field)}${line ? `<span class="reading-certainty">${e(line.buyerPart.value || line.supplierPart.value || line.id)}${schedule ? " · schedule " + e(schedule.id) : ""}</span>` : ""}</td><td>${valueHTML(obj)}${field === "date" && obj.value ? `<span class="reading-certainty">${e(schedule?.dateKind || line?.dateKind || "unknown")} meaning</span>` : ""}</td><td><button class="small-action" type="button" data-correct="${index}">Correct</button></td></tr>`;
  };
  $("[data-extracted-fields]").innerHTML = extraction.documents
    .map(
      (d) =>
        `<section class="extracted-role"><h3>${d.id === "po" ? "Purchase order" : "Acknowledgement"}</h3><div class="extracted-table-wrap"><table class="extracted-table"><thead><tr><th>Meaning</th><th>Reading and evidence</th><th>Review</th></tr></thead><tbody>${DOCUMENT_FIELDS.map((k) => row(d, null, k, d[k])).join("")}${d.lines.map((l) => LINE_FIELDS.map((k) => row(d, l, k, l[k])).join("") + l.schedules.map((s) => ["quantity", "unit", "date"].map((k) => row(d, l, k, s[k], s)).join("")).join("")).join("")}</tbody></table></div></section>`,
    )
    .join("");
}
function renderQuestions() {
  const list = state.result.questions;
  $("[data-question-count]").textContent = `${list.length} open`;
  $("[data-question-heading]").textContent = list.length
    ? "Let’s resolve the important ambiguities."
    : "No open clarification questions remain.";
  $("[data-questions]").innerHTML = list.length
    ? list
        .map(
          (q, i) =>
            `<form class="clarification" data-question="${i}"><h4>${e(q.prompt)}</h4><p>${e(q.explanation)}</p><div class="question-source-links">${evidenceButtons(q.evidence)}</div><label for="answer-${i}">${q.kind === "choice" ? "Your interpretation" : q.kind === "ratio" ? "Conversion factor (number or fraction)" : q.kind === "number" ? "Confirmed number" : q.kind === "date" ? "Confirmed date (year-month-day)" : "Confirmed reading"}</label>${q.kind === "choice" ? `<select id="answer-${i}" name="answer" required><option value="">Choose an interpretation…</option>${q.options.map((o) => `<option value="${e(o.value)}">${e(o.label)}</option>`).join("")}</select>` : `<input id="answer-${i}" name="answer" type="${q.kind === "date" ? "date" : "text"}" ${q.kind === "number" ? 'inputmode="decimal"' : ""} required maxlength="240" ${q.id.startsWith("price-basis:") ? 'placeholder="For example: 100 EA"' : ""}>`}<button class="button button-primary" type="submit">Use this interpretation ↗</button><p class="fine-print" data-answer-error role="alert"></p></form>`,
        )
        .join("")
    : '<p class="questions-complete">The comparison below uses the available source readings and your confirmed rules. Review differences and source evidence before making a business decision.</p>';
  $("[data-skip-questions]").textContent = list.length
    ? "Keep unresolved items visible and review the comparison ↓"
    : "Review the comparison ↓";
}
function renderFindings() {
  const result = state.result;
  if (!result) return;
  $("[data-comparison]").hidden = false;
  $("[data-result-state]").textContent =
    result.status === "partly_unresolved"
      ? "Some interpretations remain unresolved"
      : result.status === "checked_fields_match"
        ? "Checked readings match"
        : "Differences or conditions need review";
  const counts = result.counts;
  $("[data-comparison-counts]").classList.toggle(
    "has-open",
    Boolean(counts.unresolved || result.questions.length),
  );
  $("[data-comparison-counts]").innerHTML = [
    [
      counts.difference + counts.missing + counts.extra,
      "Differences / missing / additional",
    ],
    [counts.match + counts.confirmed, "Matching or confirmed relationships"],
    [counts.unresolved, "Unresolved findings"],
    [counts.review, "Conditions to review"],
  ]
    .map(
      ([n, title]) => `<div><strong>${n}</strong><span>${title}</span></div>`,
    )
    .join("");
  const visible = result.findings.filter(
    (f) =>
      state.filter === "all" ||
      (state.filter === "review" &&
        !["match", "confirmed"].includes(f.status)) ||
      (state.filter === "match" && ["match", "confirmed"].includes(f.status)) ||
      (state.filter === "unresolved" && f.status === "unresolved"),
  );
  $("[data-findings]").innerHTML =
    visible
      .map(
        (f) =>
          `<article class="document-finding status-${f.status}"><div><span class="finding-status">${e(f.status === "confirmed" ? "Visitor confirmed" : f.status)}</span><h3>${e(f.title)}</h3><p>${e(f.explanation)}</p></div><div class="finding-values"><div><span class="finding-value-label">PURCHASE ORDER</span><strong>${e(f.expected)}</strong></div><div><span class="finding-value-label">ACKNOWLEDGEMENT</span><strong>${e(f.actual)}</strong></div></div><div class="finding-evidence">${evidenceButtons(f.evidence)}</div></article>`,
      )
      .join("") ||
    '<p class="document-session-empty">No findings in this filter.</p>';
  $$("[data-filter]").forEach((el) =>
    el.setAttribute("aria-pressed", String(el.dataset.filter === state.filter)),
  );
  const receipt = state.receipt;
  $("[data-receipt]").innerHTML =
    `<p>${receipt?.mode === "recorded" ? "Recorded AI sample extraction. No new model call or charge for this replay." : `AI provider: ${e(receipt?.provider)} · model: ${e(receipt?.model)} · request: ${e(receipt?.requestId || "not supplied by provider")}`}</p><p>Interpretation: ${e(receipt?.generatedAt)}. Local comparison: ${e(result.generatedAt)}. ${state.corrections.length} manual correction(s).</p>${receipt?.usage ? `<p>Provider-reported tokens: ${receipt.usage.inputTokens} input / ${receipt.usage.outputTokens} output. Estimated inference cost: USD ${receipt.usage.estimatedUSD}. This is an estimate, excluding hosting and any account-specific pricing.</p>` : ""}<p>Profiles applied: ${result.profileVersions.map((p) => `${e(p.name)} · revision ${p.revision}`).join("; ") || "None"}.</p>${sources()
      .map((s) => `<p>${e(s.name)} · SHA-256 ${e(s.hash)}</p>`)
      .join(
        "",
      )}<button type="button" class="small-action" data-download-record>Download interpretation and correction record ↓</button>`;
  if (result.normalizations.length) {
    const details = document.createElement("details");
    details.className = "normalization-details";
    details.innerHTML = `<summary>How quantities and pricing bases were normalized</summary>${result.normalizations.map((n) => `<p><strong>${n.role === "po" ? "Order" : "Reply"} · ${e(n.lineId)}</strong>: ${e(n.sourceValue)} → ${e(n.result)}. Basis: ${e(n.basis)}.</p><p>${evidenceButtons(n.evidence)}</p>`).join("")}`;
    $("[data-receipt]").append(details);
  }
  renderHistory();
}
function renderHistory() {
  $("[data-previous]").hidden = !state.history.length;
  $("[data-previous-list]").innerHTML = state.history
    .map(
      (s, i) =>
        `<button type="button" class="small-action" data-history="${i}">${e(s.reason)} · ${e(new Date(s.result.generatedAt).toLocaleTimeString())} · download unchanged report ↓</button>`,
    )
    .join("");
}
function renderLearning() {
  $("[data-learning]").hidden = false;
  const scope = businessScope(state.extraction);
  $("[data-learning-documents]").innerHTML = state.extraction.documents
    .map((d) => {
      const rules = [
        ...new Map(
          [
            ...state.result.usedRules.filter((r) =>
              latestProfiles().some(
                (p) => p.id === r.profileId && p.role === d.id,
              ),
            ),
            ...state.result.learnableRules.filter((r) => r.role === d.id),
          ].map((r) => [r.kind + ":" + r.key, r]),
        ).values(),
      ];
      const previous = latestProfiles().filter(
        (p) =>
          sameScope(p.scope, scope) &&
          p.role === d.id &&
          p.format === state.sources[d.id].format,
      );
      const uncertainty =
        state.result.learning.find((l) => l.role === d.id)?.uncertain || [];
      return `<article class="learning-card" data-learning-role="${d.id}"><h3>${d.id === "po" ? "Your order form" : "The supplier’s form"}</h3><p>${e(scope.customer || "Customer not established")} / ${e(scope.supplier || "Supplier not established")}</p><h4>Discovered layout and fields</h4><p>These are interpretations of printed labels. Select the mappings you have reviewed to mark them confirmed.</p>${d.mappings.map((m, i) => `<label><input type="checkbox" data-mapping="${i}" ${m.status === "confirmed" || previous.some((p) => p.mappings.some((old) => old.field === m.field && old.label === m.label && old.status === "confirmed")) ? "checked" : ""}><span>${e(m.label)} → ${e(names[m.field.replace(/^line\./, "")] || m.field)}<small>${e(m.location)} · ${m.status === "confirmed" ? "confirmed by you" : "automatically discovered"}</small></span></label>`).join("") || "<p>No stable printed field labels were established.</p>"}<h4>Confirmed interpretations and business rules</h4>${rules.map((r, i) => `<label><input type="checkbox" data-rule="${i}" checked><span>${e(r.explanation)}<small>${r.profileId ? `Reused from profile revision ${r.profileRevision}` : "Confirmed in this comparison"}</small></span></label>`).join("") || "<p>No user-confirmed business rules have been established for this document.</p>"}<h4>Still uncertain</h4>${uncertainty.length ? `<ul>${uncertainty.map((u) => `<li>${e(u)}</li>`).join("")}</ul>` : "<p>No open clarification questions for this form. This does not authenticate the document or resolve contractual conditions.</p>"}<label class="profile-revision-choice" for="profile-previous-${d.id}">Save as</label><select id="profile-previous-${d.id}" data-profile-previous><option value="">A new document profile</option>${previous.map((p) => `<option value="${e(p.id)}">${e(p.name)} · new revision after ${p.revision}</option>`).join("")}</select><button class="button button-secondary" type="button" data-save-profile="${d.id}" ${!scope.customer || !scope.supplier ? "disabled" : ""}>Save profile in this browser ↓</button><p class="learning-message" data-save-message role="status"></p></article>`;
    })
    .join("");
  $$("[data-learning-role]").forEach((card) => {
    const labels = $$("[data-mapping]", card).map((el) => el.closest("label"));
    if (!labels.length) return;
    const details = document.createElement("details"),
      summary = document.createElement("summary");
    details.className = "learning-mappings";
    summary.textContent = `Review ${labels.length} discovered field mappings`;
    details.append(summary);
    labels[0].before(details);
    labels.forEach((label) => details.append(label));
  });
  const repeat = ["units", "repeat"].includes(state.sample);
  $("[data-repeat-panel]").hidden = !repeat;
  const hasProfile = latestProfiles().some(
    (p) =>
      p.role === "ack" &&
      sameScope(p.scope, scope) &&
      p.rules.some((r) => r.kind === "unit") &&
      p.rules.some((r) => r.kind === "part"),
  );
  $("[data-repeat]").disabled = !hasProfile;
  $("[data-repeat-metric]").textContent =
    state.sample === "repeat"
      ? `${state.firstQuestions === null ? `${state.result.questions.length} open questions on this new order.` : `${state.firstQuestions} clarifications in the first comparison → ${state.result.questions.length} now.`} ${state.result.usedRules.length} confirmed rules reused. Fresh source values: 180 EA ordered, 15 BOX acknowledged.`
      : hasProfile
        ? "The supplier profile is saved. Try the next order to see which questions it removes."
        : "Confirm the part relationship and units, then save the supplier profile to try it on the next order.";
}
function compare() {
  if (!state.extraction) return;
  state.refs = [];
  state.result = compareDocuments({
    extraction: state.extraction,
    sources: sources(),
    profiles: latestProfiles(),
    answers: state.answers,
  });
  if (state.sample === "units")
    state.firstQuestions = state.answered.size + state.result.questions.length;
  renderInterpretation();
  renderQuestions();
  renderFindings();
  renderLearning();
  progress(state.result.questions.length ? "questions" : "results");
}
function profileRulesFor(role) {
  return [
    ...new Map(
      [
        ...state.result.usedRules.filter((r) =>
          latestProfiles().some((p) => p.id === r.profileId && p.role === role),
        ),
        ...state.result.learnableRules.filter((r) => r.role === role),
      ].map((r) => [r.kind + ":" + r.key, r]),
    ).values(),
  ];
}
function persistProfiles(next) {
  if (next.length > 50)
    throw new Error(
      "Keep up to 50 profile revisions in this browser. Export and remove an older profile before saving another.",
    );
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  state.profiles = next;
  renderProfileLibrary();
}
function saveProfile(role) {
  const card = $(`[data-learning-role="${role}"]`),
    message = $("[data-save-message]", card);
  try {
    const previous =
      latestProfiles().find(
        (p) => p.id === $("[data-profile-previous]", card).value,
      ) || null;
    const doc = state.extraction.documents.find((d) => d.id === role),
      rules = profileRulesFor(role);
    const selected = $$("[data-rule]:checked", card).map(
      (el) => rules[Number(el.dataset.rule)],
    );
    const profile = createProfile({
      extraction: state.extraction,
      source: state.sources[role],
      ownership: $(`#own-${role}`).checked ? "own_standard" : "external",
      previous: previous ? { ...previous, rules: [] } : null,
      confirmedMappings: $$("[data-mapping]:checked", card).map(
        (el) => doc.mappings[Number(el.dataset.mapping)].field,
      ),
      confirmedRules: selected,
    });
    persistProfiles([...state.profiles, profile]);
    message.textContent = `Saved revision ${profile.revision} in this browser. ${profile.mappings.filter((m) => m.status === "confirmed").length} confirmed mappings; ${profile.rules.length} confirmed rules. Earlier revisions stay unchanged.`;
    const hasReusable = latestProfiles().some(
      (p) =>
        p.role === "ack" &&
        sameScope(p.scope, profile.scope) &&
        p.rules.some((r) => r.kind === "unit") &&
        p.rules.some((r) => r.kind === "part"),
    );
    $("[data-repeat]").disabled = !hasReusable;
    if (hasReusable)
      $("[data-repeat-metric]").textContent =
        "Your confirmed supplier rules are saved. The next order can reuse them with fresh source values.";
  } catch (err) {
    message.textContent = err.message;
  }
}
function renderProfileLibrary() {
  const profiles = latestProfiles();
  $("[data-profile-count]").textContent =
    `(${profiles.length} profiles · ${state.profiles.length} versions)`;
  $("[data-profile-list]").innerHTML =
    profiles
      .map(
        (p, i) =>
          `<article class="profile-row"><div><strong>${e(p.name)}</strong><small>Revision ${p.revision} · ${e(p.format.toUpperCase())} · ${p.ownership === "own_standard" ? "Your own standard form" : "External form"} · ${p.rules.length} confirmed rules</small><small>${e(p.scope.customer)} / ${e(p.scope.supplier)}</small><details class="profile-editor"><summary>Review or correct this profile</summary><form data-edit-profile="${i}"><p class="fine-print">A correction saves a new revision. Prior profile versions and comparison snapshots stay unchanged. Rules apply only within this customer/supplier scope and a compatible document format.</p>${p.mappings.map((m, j) => `<label>Printed label for ${e(m.field)}<input name="mapping-${j}" value="${e(m.label)}" maxlength="160" required></label>`).join("")}${p.rules.map((r, j) => `<label><input type="checkbox" name="include-${j}" checked> ${e(r.explanation)}<input name="rule-${j}" value="${e(r.value)}" maxlength="400" required aria-label="${e(r.kind + " interpretation value")}"></label>`).join("")}<button class="small-action" type="submit">Save corrected profile as revision ${p.revision + 1} ↗</button><p data-profile-edit-status class="fine-print" role="status"></p></form></details></div><button type="button" class="small-action" data-export-profile="${i}">Export all versions ↓</button><button type="button" class="small-action" data-delete-profile="${i}">Forget profile</button></article>`,
      )
      .join("") ||
    '<p class="document-session-empty">No profiles saved. Learning remains in the current session until you choose to save it.</p>';
}
function download(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const currentRun = () => ({
  result: state.result,
  receipt: state.receipt,
  sources: sources(),
  corrections: state.corrections,
});
function report(run = currentRun()) {
  if (run.result)
    download(
      comparisonHTML(run),
      `order-comparison-${run.result.generatedAt.slice(0, 19).replaceAll(":", "-")}.html`,
      "text/html;charset=utf-8",
    );
}
function openSource(ref, role) {
  const source = role
    ? state.sources[role]
    : sources().find((s) => s.anchors.some((a) => a.id === ref.anchorId));
  if (!source) return;
  const anchor = ref ? source.anchors.find((a) => a.id === ref.anchorId) : null;
  state.sourceFocus = document.activeElement;
  const drawer = $("[data-source-drawer]");
  drawer.hidden = false;
  drawer.setAttribute("role", "dialog");
  drawer.setAttribute("aria-modal", "true");
  $("[data-source-backdrop]").hidden = false;
  $("main").inert = true;
  $(".site-header").inert = true;
  $(".document-footer").inert = true;
  document.body.style.overflow = "hidden";
  $("[data-source-file]").textContent = source.name;
  $("[data-source-location]").textContent =
    anchor?.label || "Original document as read in this browser";
  $("[data-source-quote]").hidden = !ref;
  $("[data-source-quote]").innerHTML = ref
    ? `<small>${ref.support === "image_reference" ? (state.receipt?.mode === "recorded" ? "Recorded AI image transcription · inspect this region" : "AI image transcription · inspect this region") : "Text located at this source; not an authenticity check"}</small>${e(ref.quote)}`
    : "";
  const content = $("[data-source-content]");
  content.replaceChildren();
  if (source.pages.length)
    for (const page of source.pages.filter(
      (p) => !anchor || !anchor.page || p.number === anchor.page,
    )) {
      const wrap = document.createElement("div");
      wrap.className = "source-image-page";
      const img = document.createElement("img");
      img.src = page.image;
      img.alt = `${source.name}, page ${page.number}`;
      wrap.append(img);
      const box = ref?.bbox || anchor?.bbox;
      if (box) {
        const highlight = document.createElement("span");
        highlight.className = "source-highlight";
        highlight.style.left = box[0] * 100 + "%";
        highlight.style.top = box[1] * 100 + "%";
        highlight.style.width = (box[2] - box[0]) * 100 + "%";
        highlight.style.height = (box[3] - box[1]) * 100 + "%";
        wrap.append(highlight);
        img.addEventListener(
          "load",
          () => {
            if (!drawer.hidden) highlight.scrollIntoView({ block: "center" });
          },
          { once: true },
        );
      }
      content.append(wrap);
    }
  for (const sheet of source.sheets.filter(
    (s) => !anchor?.sheet || s.name === anchor.sheet,
  )) {
    const title = document.createElement("h3");
    title.className = "source-sheet-title";
    title.textContent = `${sheet.name}${sheet.hidden ? " (hidden sheet included by you)" : ""}`;
    content.append(title);
    const wrap = document.createElement("div");
    wrap.className = "source-sheet";
    const maxColumn = Math.min(
      100,
      Math.max(0, ...sheet.rows.flat().map((c) => c.column)),
    );
    const colName = (n) => {
      let s = "";
      for (; n > 0; n = Math.floor((n - 1) / 26))
        s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
      return s;
    };
    wrap.innerHTML = `<table><caption class="sr-only">${e(sheet.name)} source cells</caption><thead><tr><th scope="col">Row</th>${Array.from({ length: maxColumn }, (_, i) => `<th scope="col">${colName(i + 1)}</th>`).join("")}</tr></thead><tbody>${sheet.rows
      .map((row) => {
        const n = row[0]?.row;
        if (!n) return "";
        const byCol = new Map(row.map((c) => [c.column, c]));
        return `<tr><th scope="row">${n}</th>${Array.from(
          { length: maxColumn },
          (_, i) => {
            const cell = byCol.get(i + 1);
            return `<td ${anchor?.cell === cell?.address ? 'class="is-highlighted"' : ""}>${e(cell?.text || "")}${cell?.formula ? "<small>Saved formula result</small>" : ""}</td>`;
          },
        ).join("")}</tr>`;
      })
      .join("")}</tbody></table>`;
    content.append(wrap);
    $(".is-highlighted", wrap)?.scrollIntoView({
      block: "center",
      inline: "center",
    });
  }
  $("[data-source-custody]").textContent =
    `SHA-256 ${source.hash}. Source locations preserve a path back to the uploaded bytes. They do not verify document authenticity.`;
  $("[data-close-source]").focus();
}
function closeSource() {
  if ($("[data-source-drawer]").hidden) return;
  $("[data-source-drawer]").hidden = true;
  $("[data-source-backdrop]").hidden = true;
  $("main").inert = false;
  $(".site-header").inert = false;
  $(".document-footer").inert = false;
  document.body.style.overflow = "";
  state.sourceFocus?.isConnected && state.sourceFocus.focus();
  state.sourceFocus = null;
}
function fieldTarget(item, extraction = state.extraction) {
  const doc = extraction.documents.find((d) => d.id === item.role),
    line = doc.lines.find((l) => l.id === item.lineId),
    schedule = line?.schedules.find((s) => s.id === item.scheduleId);
  return {
    doc,
    line,
    object: schedule || line || doc,
    field: (schedule || line || doc)[item.field],
  };
}
function openCorrection(index) {
  const item = state.fields[index];
  if (!item) return;
  state.correction = item;
  const { doc, line, object, field } = fieldTarget(item),
    form = $("[data-correction-form]");
  form.elements.value.value = field.raw || field.value || "";
  form.elements.source.innerHTML = state.sources[item.role].anchors
    .map(
      (a, i) =>
        `<option value="${i}" ${field.evidence.some((r) => r.anchorId === a.id) ? "selected" : ""}>${e(a.label)}${a.text ? " · " + e(a.text.slice(0, 90)) : " · image region"}</option>`,
    )
    .join("");
  form.elements.label.value =
    doc.mappings.find((m) => m.field === `${line ? "line." : ""}${item.field}`)
      ?.label || "";
  $("[data-date-correction]").hidden = item.field !== "date";
  form.elements.dateKind.value = object.dateKind || "unknown";
  $("[data-correction-error]").textContent = "";
  $("[data-correction-dialog]").showModal();
  form.elements.value.focus();
}
function applyCorrection(form) {
  const item = state.correction;
  if (!item) return;
  const { doc, line, object, field } = fieldTarget(item),
    value = form.elements.value.value.trim(),
    a = state.sources[item.role].anchors[Number(form.elements.source.value)],
    printedLabel = form.elements.label.value.trim();
  if (!value || !a) return;
  if (a.text && !a.text.normalize("NFKC").includes(value.normalize("NFKC"))) {
    $("[data-correction-error]").textContent =
      "The corrected reading must occur at the selected source location. Choose the matching source or enter the value as printed.";
    return;
  }
  if (
    printedLabel &&
    !state.sources[item.role].anchors.some((anchor) =>
      anchor.text.includes(printedLabel),
    ) &&
    !field.evidence.some((ref) => ref.support === "image_reference")
  ) {
    $("[data-correction-error]").textContent =
      "The printed label was not found in this document. Use the exact source label, or leave it empty.";
    return;
  }
  snapshot("Before correcting an extracted reading");
  const evidence = [
    {
      anchorId: a.id,
      quote: a.text || value,
      bbox: a.text
        ? null
        : field.evidence.find((r) => r.anchorId === a.id)?.bbox || [0, 0, 1, 1],
      support: a.text ? "exact_quote" : "image_reference",
    },
  ];
  object[item.field] = {
    raw: value,
    value,
    certainty: "clear",
    issue: null,
    evidence,
  };
  if (item.field === "date") object.dateKind = form.elements.dateKind.value;
  const answerField = item.scheduleId
    ? item.field === "date"
      ? `delivery-${item.scheduleId}-date`
      : `schedule-${item.scheduleId}-${item.field}`
    : item.field;
  delete state.answers[`field:${item.role}:${item.lineId}:${answerField}`];
  if (printedLabel) {
    const mapped = `${line ? "line." : ""}${item.field}`,
      old = doc.mappings.find((m) => m.field === mapped),
      labelAnchor = state.sources[item.role].anchors.find((anchor) =>
        anchor.text.includes(printedLabel),
      );
    const mapping = {
      field: mapped,
      label: printedLabel,
      location: labelAnchor?.label || a.label,
      evidence: labelAnchor
        ? [
            {
              anchorId: labelAnchor.id,
              quote: labelAnchor.text,
              bbox: null,
              support: "exact_quote",
            },
          ]
        : evidence,
      status: "confirmed",
    };
    if (old) Object.assign(old, mapping);
    else doc.mappings.push(mapping);
  }
  state.corrections.push({
    ...item,
    before: field.raw || field.value,
    after: value,
    source: evidence,
    label: printedLabel || null,
    dateKind: item.field === "date" ? object.dateKind : null,
    at: new Date().toISOString(),
  });
  $("[data-correction-dialog]").close();
  compare();
}
function clearSession() {
  state.operation++;
  state.generations.po++;
  state.generations.ack++;
  state.liveAbort?.abort();
  state.liveAbort = null;
  closeSource();
  $("[data-correction-dialog]").close();
  state.sources = {};
  state.files = {};
  state.history = [];
  state.correction = null;
  state.firstQuestions = null;
  resetInterpretation();
  ["po", "ack"].forEach((role) => {
    $(`#file-${role}`).value = "";
    $(`#hidden-${role}`).checked = false;
    $(`#own-${role}`).checked = false;
    renderFile(role);
  });
  $("#processing-consent").checked = false;
  state.captchaToken = "";
  if (state.captchaWidget !== undefined)
    window.turnstile?.remove(state.captchaWidget);
  delete state.captchaWidget;
  $("[data-copy-fallback]").hidden = true;
  $("[data-copy-fallback]").value = "";
  $("[data-source-content]").replaceChildren();
  error("");
  busy(false);
  announce(
    "Session documents, readings, answers, and comparison snapshots removed. Explicitly saved profiles remain available below; the free-use allowance is unchanged.",
  );
  health();
}

document.addEventListener("click", (event) => {
  const el = event.target.closest("button, [data-source-backdrop]");
  if (!el) return;
  if (el.hasAttribute("data-sample")) loadSample(el.dataset.sample);
  else if (el.hasAttribute("data-repeat")) loadSample("repeat");
  else if (el.hasAttribute("data-interpret")) interpret();
  else if (el.hasAttribute("data-preview"))
    openSource(null, el.dataset.preview);
  else if (el.hasAttribute("data-source-ref"))
    openSource(state.refs[Number(el.dataset.sourceRef)]);
  else if (
    el.hasAttribute("data-close-source") ||
    el.hasAttribute("data-source-backdrop")
  )
    closeSource();
  else if (el.hasAttribute("data-correct"))
    openCorrection(Number(el.dataset.correct));
  else if (el.hasAttribute("data-save-profile"))
    saveProfile(el.dataset.saveProfile);
  else if (el.hasAttribute("data-filter")) {
    state.filter = el.dataset.filter;
    renderFindings();
  } else if (el.hasAttribute("data-skip-questions")) {
    $("[data-comparison]").focus();
    $("[data-comparison]").scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  } else if (el.hasAttribute("data-clear-session")) clearSession();
  else if (el.hasAttribute("data-cancel")) {
    state.operation++;
    state.generations.po++;
    state.generations.ack++;
    state.liveAbort?.abort();
    state.liveAbort = null;
    busy(false);
    announce(
      "Processing cancelled. No partial interpretation will be used; an already admitted AI request may consume the free attempt.",
    );
    health();
  } else if (el.hasAttribute("data-download-report")) report();
  else if (el.hasAttribute("data-history"))
    report(state.history[Number(el.dataset.history)]);
  else if (el.hasAttribute("data-download-record"))
    download(
      JSON.stringify(
        {
          version: 1,
          ...currentRun(),
          sources: sources().map(({ id, name, hash, format }) => ({
            id,
            name,
            hash,
            format,
          })),
          originalInterpretation: state.baseline,
          currentInterpretation: state.extraction,
          answers: state.answers,
          disclaimer:
            "Interpretations and source references; not authenticated business records or transaction approval.",
        },
        null,
        2,
      ),
      "order-interpretation-record.json",
      "application/json",
    );
  else if (el.hasAttribute("data-export-profile")) {
    const p = latestProfiles()[Number(el.dataset.exportProfile)];
    download(
      JSON.stringify(
        state.profiles.filter((v) => v.id === p.id),
        null,
        2,
      ),
      `document-profile-${p.id}.json`,
      "application/json",
    );
  } else if (el.hasAttribute("data-delete-profile")) {
    const p = latestProfiles()[Number(el.dataset.deleteProfile)];
    try {
      persistProfiles(state.profiles.filter((v) => v.id !== p.id));
      $("[data-profile-message]").textContent =
        "Profile and all saved revisions removed from this browser. Previous comparison snapshots remain unchanged until session removal.";
    } catch (err) {
      $("[data-profile-message]").textContent = err.message;
    }
  } else if (el.hasAttribute("data-copy-summary")) {
    const text = comparisonText(currentRun());
    navigator.clipboard
      ?.writeText(text)
      .then(() => ($("[data-export-status]").textContent = "Summary copied."))
      .catch(() => {
        const area = $("[data-copy-fallback]");
        area.hidden = false;
        area.value = text;
        area.focus();
        area.select();
      });
    if (!navigator.clipboard) {
      const area = $("[data-copy-fallback]");
      area.hidden = false;
      area.value = text;
      area.focus();
      area.select();
    }
  }
});
document.addEventListener("submit", (event) => {
  const form = event.target;
  if (form.hasAttribute("data-question")) {
    event.preventDefault();
    const question = state.result.questions[Number(form.dataset.question)],
      value = form.elements.answer.value.trim();
    if (!question || !value) return;
    if (
      (question.id === "document-pair" ||
        question.id.startsWith("document-role:")) &&
      value === "replace"
    ) {
      $(question.role === "ack" ? "#file-ack" : "#file-po").focus();
      $(".upload-workspace").scrollIntoView({ behavior: "smooth" });
      return;
    }
    snapshot("Before confirming an interpretation");
    state.answers[question.id] = {
      value,
      confirmedAt: new Date().toISOString(),
    };
    state.answered.add(question.id);
    compare();
    const remaining = state.result.questions.find((q) => q.id === question.id);
    if (remaining) {
      const i = state.result.questions.indexOf(remaining);
      $(`[data-question="${i}"] [data-answer-error]`).textContent =
        "That value could not resolve the interpretation. Check the format and use a valid source value; the question remains open.";
    } else if (state.result.questions.length)
      $("[data-questions] input, [data-questions] select")?.focus();
    else {
      $("[data-comparison]").focus();
      $("[data-comparison]").scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
  } else if (form.hasAttribute("data-correction-form")) {
    event.preventDefault();
    applyCorrection(form);
  } else if (form.hasAttribute("data-edit-profile")) {
    event.preventDefault();
    const profile = latestProfiles()[Number(form.dataset.editProfile)];
    if (!profile) return;
    try {
      const now = new Date().toISOString(),
        next = validateProfile({
          ...profile,
          revision: profile.revision + 1,
          updatedAt: now,
          mappings: profile.mappings.map((m, i) => ({
            ...m,
            label: form.elements[`mapping-${i}`].value.trim(),
            status: "confirmed",
            confirmedAt: now,
          })),
          rules: profile.rules
            .filter((r, i) => form.elements[`include-${i}`].checked)
            .map((r) => {
              const i = profile.rules.indexOf(r);
              return {
                ...r,
                value: form.elements[`rule-${i}`].value.trim(),
                confirmedAt: now,
              };
            }),
        });
      persistProfiles([...state.profiles, next]);
      $("[data-profile-message]").textContent =
        `Saved corrected revision ${next.revision}. Previous results and revisions remain unchanged; the corrected profile applies to a future comparison.`;
    } catch (err) {
      $("[data-profile-edit-status]", form).textContent = err.message;
    }
  }
});
["po", "ack"].forEach((role) => {
  $(`#file-${role}`).addEventListener("change", (event) =>
    chooseFile(role, event.target.files[0]),
  );
  $(`#hidden-${role}`).addEventListener("change", () =>
    chooseFile(role, state.files[role]),
  );
  const drop = $(`[data-drop="${role}"]`);
  drop.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (!state.busy) drop.classList.add("is-dragging");
  });
  drop.addEventListener("dragleave", () =>
    drop.classList.remove("is-dragging"),
  );
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    drop.classList.remove("is-dragging");
    if (event.dataTransfer.files.length !== 1)
      error("Choose one document for this side of the comparison.");
    else chooseFile(role, event.dataTransfer.files[0]);
  });
});
$("#processing-consent").addEventListener("change", updateAdmission);
$("[data-import-profile]").addEventListener("change", async (event) => {
  try {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 2000000)
      throw new Error("Use a profile JSON file up to 2 MB.");
    const incoming = importProfiles(await file.text());
    const next = mergeProfiles(state.profiles, incoming);
    const count = next.length - state.profiles.length;
    persistProfiles(next);
    $("[data-profile-message]").textContent =
      `Imported ${count} profile revision(s). Saved profiles will be evaluated against the next document pair; existing results stay unchanged.`;
  } catch (err) {
    $("[data-profile-message]").textContent = err.message;
  } finally {
    event.target.value = "";
  }
});
document.addEventListener("keydown", (event) => {
  if ($("[data-source-drawer]").hidden) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeSource();
  } else if (event.key === "Tab") {
    const buttons = $$(
      'button, a[href], [tabindex="0"]',
      $("[data-source-drawer]"),
    ).filter((el) => !el.disabled);
    const first = buttons[0],
      last = buttons.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});
try {
  const raw = localStorage.getItem(STORAGE_KEY);
  state.profiles = raw ? mergeProfiles([], JSON.parse(raw)) : [];
  if (state.profiles.length > 50) throw new Error("too many profiles");
} catch {
  state.profiles = [];
  $("[data-profile-message]").textContent =
    "Saved profiles could not be read in this browser. Existing storage was not overwritten. You can import a valid exported profile.";
}
renderProfileLibrary();
health();
