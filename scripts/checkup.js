import {
  SAMPLE_ANSWERS,
  validateAnswers,
  createBrief,
  renderBriefContent,
  briefAsText,
  standaloneBriefHTML,
} from "./checkup-model.js";

const form = document.querySelector("#checkup-form");
const steps = [...form.querySelectorAll("[data-step]")];
const progress = [...document.querySelectorAll(".checkup-progress li")];
const formShell = document.querySelector("[data-form-shell]");
const results = document.querySelector("[data-results]");
const intro = document.querySelector("[data-checkup-intro]");
const errorBox = document.querySelector("[data-form-error]");
const documentArea = document.querySelector("[data-brief-document]");
const draftKey = "nextlevel-workflow-checkup-v1";
const textFields = [
  "workflowName",
  "description",
  "systemsDetails",
  "reviewer",
  "boundaries",
  "department",
  "trigger",
  "frequency",
  "repetitions",
  "minutes",
  "goal",
  "impact",
  "dataSensitivity",
];
const radioFields = ["inputShape", "predictability"];
const headings = [
  ["Start with one task.", "Choose something concrete your team does today."],
  [
    "Find the time and the connections.",
    "A rough baseline helps make the opportunity concrete.",
  ],
  [
    "Understand the pattern.",
    "The right approach depends on the inputs and the judgement involved.",
  ],
  [
    "Keep the right people in the loop.",
    "Make the review points and boundaries explicit from the start.",
  ],
];
let currentStep = 0;
let currentBrief = null;
let isSample = false;
let storageAvailable = true;

function readForm() {
  const answers = Object.fromEntries(
    textFields.map((key) => [key, form.elements.namedItem(key).value]),
  );
  for (const key of radioFields)
    answers[key] =
      form.querySelector(`input[name="${key}"]:checked`)?.value || "";
  answers.systems = [
    ...form.querySelectorAll('input[name="systems"]:checked'),
  ].map((input) => input.value);
  return answers;
}
function fillForm(answers = {}) {
  form.reset();
  for (const key of textFields)
    if (typeof answers[key] === "string" || typeof answers[key] === "number")
      form.elements.namedItem(key).value = String(answers[key]);
  for (const key of radioFields)
    form.querySelectorAll(`input[name="${key}"]`).forEach((input) => {
      input.checked = answers[key] === input.value;
    });
  form.querySelectorAll('input[name="systems"]').forEach((input) => {
    input.checked =
      Array.isArray(answers.systems) && answers.systems.includes(input.value);
  });
  updatePeriod();
}
function updatePeriod() {
  document.querySelector("[data-period-label]").textContent =
    {
      daily: "each working day",
      weekly: "each week",
      monthly: "each month",
      occasional: "per batch",
    }[form.elements.namedItem("frequency").value] || "in that period";
}
function readDraft() {
  try {
    const stored = sessionStorage.getItem(draftKey);
    if (!stored || stored.length > 12000) return null;
    const draft = JSON.parse(stored);
    if (
      draft.version !== 1 ||
      !draft.answers ||
      typeof draft.answers !== "object" ||
      Array.isArray(draft.answers)
    )
      return null;
    return draft.answers;
  } catch {
    storageAvailable = false;
    return null;
  }
}
function saveDraft() {
  if (isSample) return;
  try {
    sessionStorage.setItem(
      draftKey,
      JSON.stringify({ version: 1, answers: readForm() }),
    );
  } catch {
    storageAvailable = false;
    document.querySelector("[data-storage-status]").textContent =
      "Tab storage is unavailable. Keep this page open to retain answers.";
  }
}
function setStep(index, { focus = true } = {}) {
  currentStep = index;
  steps.forEach((step, i) => {
    step.hidden = i !== index;
  });
  progress.forEach((item, i) => {
    if (i === index) item.setAttribute("aria-current", "step");
    else item.removeAttribute("aria-current");
    item.classList.toggle("is-complete", i < index);
  });
  document.querySelector("[data-step-count]").textContent =
    `Step ${index + 1} of 4`;
  document.querySelector("[data-step-title]").textContent = headings[index][0];
  document.querySelector("[data-step-description]").textContent =
    headings[index][1];
  document.querySelector("[data-previous]").hidden = index === 0;
  const next = document.querySelector("[data-next]");
  next.replaceChildren(
    document.createTextNode(index === 3 ? "Create my brief " : "Continue "),
  );
  const arrow = document.createElement("span");
  arrow.setAttribute("aria-hidden", "true");
  arrow.textContent = "→";
  next.append(arrow);
  errorBox.hidden = true;
  if (focus) document.querySelector("[data-step-title]").focus();
}
function showError(message, control) {
  errorBox.textContent = message;
  errorBox.hidden = false;
  if (control) control.focus();
}
function validateCurrentStep() {
  for (const control of steps[currentStep].querySelectorAll(
    "input, select, textarea",
  )) {
    if (!control.checkValidity()) {
      control.reportValidity();
      return false;
    }
  }
  const { errors } = validateAnswers(readForm());
  const names = new Set(
    [...steps[currentStep].querySelectorAll("[name]")].map(
      (element) => element.name,
    ),
  );
  const failed = Object.entries(errors).find(([key]) => names.has(key));
  if (failed) {
    const control =
      failed[0] === "systems"
        ? form.querySelector('[name="systems"]')
        : form.querySelector(`[name="${failed[0]}"]`);
    showError(failed[1], control);
    return false;
  }
  return true;
}
function clearExampleURL() {
  if (location.search) history.replaceState(null, "", location.pathname);
}
function showForm({ own = false } = {}) {
  if (own && isSample) {
    isSample = false;
    fillForm(readDraft() || {});
  }
  clearExampleURL();
  results.hidden = true;
  formShell.hidden = false;
  intro.hidden = false;
  document.body.classList.remove("brief-mode");
  setStep(0);
}
function showBrief({ sample = false, focus = true } = {}) {
  currentBrief = createBrief(readForm(), { sample });
  documentArea.innerHTML = renderBriefContent(currentBrief);
  formShell.hidden = true;
  intro.hidden = true;
  results.hidden = false;
  document.body.classList.add("brief-mode");
  document.querySelector("[data-sample-caption]").textContent = sample
    ? "This example uses illustrative inputs. Create a brief for your own work."
    : "Want to explore another task? Clear your answers to start fresh.";
  document.querySelector("[data-own-checkup]").textContent = sample
    ? "Start my own checkup ↗"
    : "Start a new checkup ↗";
  const body = `Hi Michael,\n\nI’d like to discuss this workflow: ${currentBrief.title}\nSuggested starting point: ${currentBrief.approach}\nCurrent effort entered: ${currentBrief.baseline}\n\nI can share the opportunity brief and some context.\n\n`;
  document.querySelector("[data-discuss]").href =
    `mailto:michael@nextlevelsoftwaresolutions.com?subject=${encodeURIComponent(`Project conversation: ${currentBrief.title}`)}&body=${encodeURIComponent(body)}`;
  document.querySelector("[data-copy-status]").textContent = "";
  document.querySelector("[data-copy-fallback]").hidden = true;
  if (focus) {
    documentArea.focus();
    documentArea.scrollIntoView({ block: "start", behavior: "instant" });
  }
}

form.addEventListener("input", () => {
  isSample = false;
  errorBox.hidden = true;
  saveDraft();
});
form.addEventListener("change", () => {
  isSample = false;
  errorBox.hidden = true;
  updatePeriod();
  saveDraft();
});
form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!validateCurrentStep()) return;
  if (currentStep < 3) {
    saveDraft();
    setStep(currentStep + 1);
    return;
  }
  const validation = validateAnswers(readForm());
  if (!validation.valid) {
    const firstName = Object.keys(validation.errors)[0];
    const invalidStep = steps.findIndex((step) =>
      step.querySelector(`[name="${firstName}"]`),
    );
    setStep(invalidStep < 0 ? 0 : invalidStep);
    showError(validation.errors[firstName]);
    return;
  }
  saveDraft();
  showBrief({ sample: isSample });
});
document.querySelector("[data-previous]").addEventListener("click", () => {
  if (currentStep > 0) setStep(currentStep - 1);
});
document.querySelector("[data-clear]").addEventListener("click", () => {
  try {
    sessionStorage.removeItem(draftKey);
  } catch {
    /* Clearing the visible form still works if storage is blocked. */
  }
  isSample = false;
  fillForm();
  clearExampleURL();
  setStep(0);
});
document.querySelector("[data-edit]").addEventListener("click", (event) => {
  event.preventDefault();
  showForm();
});
document.querySelector("[data-own-checkup]").addEventListener("click", () => {
  if (isSample) showForm({ own: true });
  else {
    try {
      sessionStorage.removeItem(draftKey);
    } catch {
      /* A new checkup also works without storage. */
    }
    fillForm();
    showForm();
  }
});
document.querySelector("[data-download]").addEventListener("click", () => {
  if (!currentBrief) return;
  const blob = new Blob([standaloneBriefHTML(currentBrief)], {
    type: "text/html;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const name =
    currentBrief.title
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase()
      .slice(0, 70) || "workflow";
  link.href = url;
  link.download = `next-level-${name}-brief.html`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
document.querySelector("[data-print]").addEventListener("click", () => {
  if (currentBrief) window.print();
});
document.querySelector("[data-copy]").addEventListener("click", async () => {
  if (!currentBrief) return;
  const status = document.querySelector("[data-copy-status]");
  const fallback = document.querySelector("[data-copy-fallback]");
  try {
    await navigator.clipboard.writeText(briefAsText(currentBrief));
    fallback.hidden = true;
    status.textContent =
      "Brief copied. You can paste it into a message or document.";
  } catch {
    fallback.value = briefAsText(currentBrief);
    fallback.hidden = false;
    fallback.focus();
    fallback.select();
    status.textContent = "Select and copy the brief text below.";
  }
});

const draft = readDraft();
if (draft) fillForm(draft);
if (!storageAvailable)
  document.querySelector("[data-storage-status]").textContent =
    "Tab storage is unavailable. Keep this page open to retain answers.";
setStep(0, { focus: false });
if (
  new URLSearchParams(location.search).get("example") ===
  "order-acknowledgement"
) {
  isSample = true;
  fillForm(SAMPLE_ANSWERS);
  showBrief({ sample: true, focus: false });
}
