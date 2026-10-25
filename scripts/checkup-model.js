export const SYSTEMS = Object.freeze({
  email: "Email",
  spreadsheet: "Spreadsheets",
  erp: "ERP / business system",
  crm: "CRM",
  documents: "Documents / PDFs",
  database: "Database",
  internal: "An internal application",
  other: "Other tools",
});
export const DEPARTMENTS = Object.freeze({
  operations: "Operations",
  finance: "Finance & accounting",
  sales: "Sales & customer service",
  purchasing: "Purchasing & supply chain",
  people: "People & administration",
  other: "Another part of the business",
});
export const GOALS = Object.freeze({
  entry: "Reduce repeated data entry",
  reporting: "Improve reporting & visibility",
  exceptions: "Spot discrepancies & exceptions",
  followup: "Keep work moving & follow up",
  application: "Replace a spreadsheet or aging tool",
});
const OPTIONS = {
  department: Object.keys(DEPARTMENTS),
  trigger: ["document", "record", "schedule", "request", "varies"],
  frequency: ["daily", "weekly", "monthly", "occasional"],
  inputShape: ["structured", "mixed", "unstructured"],
  predictability: ["consistent", "mixed", "judgement"],
  goal: Object.keys(GOALS),
  impact: ["low", "operational", "consequential", "critical"],
  dataSensitivity: ["business", "personal", "regulated", "unsure"],
};
const TEXT_LIMITS = {
  workflowName: [3, 120],
  description: [12, 1500],
  systemsDetails: [0, 160],
  reviewer: [2, 100],
  boundaries: [0, 700],
};
const LABELS = {
  workflowName: "Give the task a name (3–120 characters).",
  description:
    "Describe the steps in a little more detail (12–1,500 characters).",
  systemsDetails: "Keep tool names under 160 characters.",
  reviewer: "Name a person or role to review the work (2–100 characters).",
  boundaries: "Keep boundaries under 700 characters.",
};
const trim = (value) => (typeof value === "string" ? value.trim() : "");

export function validateAnswers(raw = {}) {
  const input =
    raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const answers = {};
  const errors = {};
  for (const [key, [minimum, maximum]] of Object.entries(TEXT_LIMITS)) {
    answers[key] = trim(input[key]);
    if (answers[key].length < minimum || answers[key].length > maximum)
      errors[key] = LABELS[key];
  }
  for (const [key, allowed] of Object.entries(OPTIONS)) {
    answers[key] = trim(input[key]);
    if (!allowed.includes(answers[key]))
      errors[key] = "Choose an option for this question.";
  }
  answers.systems = [
    ...new Set(
      Array.isArray(input.systems)
        ? input.systems.filter((value) => Object.hasOwn(SYSTEMS, value))
        : [],
    ),
  ];
  if (!answers.systems.length)
    errors.systems = "Choose at least one system or type of information.";
  for (const [key, maximum] of [
    ["repetitions", 10000],
    ["minutes", 10080],
  ]) {
    const value = input[key];
    answers[key] =
      typeof value === "number" || typeof value === "string"
        ? Number(value)
        : NaN;
    if (
      !Number.isFinite(answers[key]) ||
      !Number.isInteger(answers[key]) ||
      answers[key] < 1 ||
      answers[key] > maximum
    )
      errors[key] =
        `Enter a whole number from 1 to ${maximum.toLocaleString("en-US")}.`;
  }
  return { valid: !Object.keys(errors).length, errors, answers };
}

export const SAMPLE_ANSWERS = Object.freeze({
  workflowName: "Review supplier order acknowledgements",
  department: "purchasing",
  description:
    "A buyer reads each supplier acknowledgement, compares quantities, unit prices, and delivery dates with the purchase order, then follows up on differences.",
  trigger: "document",
  frequency: "weekly",
  repetitions: 30,
  minutes: 8,
  systems: Object.freeze(["email", "erp", "documents", "spreadsheet"]),
  systemsDetails:
    "Email, ERP purchase orders, supplier PDFs, and a tracking spreadsheet",
  inputShape: "mixed",
  predictability: "mixed",
  goal: "exceptions",
  impact: "consequential",
  dataSensitivity: "business",
  reviewer: "Purchasing lead",
  boundaries:
    "Never change or release a purchase order, accept a revised price, or contact a supplier without approval.",
});

function chooseApproach(a) {
  if (a.impact === "critical" || a.predictability === "judgement")
    return "decision";
  if (a.goal === "application") return "application";
  if (a.goal === "reporting") return "reporting";
  if (a.goal === "followup") return "workflow";
  if (a.inputShape !== "structured") return "ai-assist";
  if (a.goal === "entry" && a.systems.length > 1) return "integration";
  return "rules";
}

const APPROACHES = {
  decision: {
    name: "Support the decision-maker",
    type: "Human-led decision support",
    reason:
      "This work depends on judgement or has serious consequences. Start by organizing the evidence and preparing a review, while a qualified person makes the decision.",
    project:
      "Build a review workspace that gathers the relevant information, shows its sources, and helps the reviewer record a decision. Begin without automated decisions or external changes.",
    success:
      "The reviewer can trace the supporting information and record a decision without losing responsibility for it.",
  },
  application: {
    name: "Build a focused internal tool",
    type: "Custom business application",
    reason:
      "A small application can give this work a clearer home: one place for inputs, ownership, status, and the next step.",
    project:
      "Replace one bounded part of the existing tool with a simple working application. Include the main task, its exceptions, and an export or handoff your team can use.",
    success:
      "A team member can complete the chosen task and its common exceptions in the new tool.",
  },
  reporting: {
    name: "Make the report reusable",
    type: "Reporting & data integration",
    reason:
      "Repeated reporting often benefits first from agreed definitions and reliable source data. AI may help with exploration, but the numbers need a dependable calculation.",
    project:
      "Take one recurring business question, agree on its definitions, and produce a reusable report from approved data. Document where each number comes from.",
    success:
      "The report agrees with a reviewed source sample, and its definitions can be reused next time.",
  },
  workflow: {
    name: "Coordinate the follow-through",
    type: "Workflow automation",
    reason:
      "A clear owner, visible status, and an agreed trigger can remove the need to repeatedly check what should happen next.",
    project:
      "Track one type of request from arrival to completion. Prepare the next task or follow-up for review, with clear ownership and a way to handle exceptions.",
    success:
      "Each test request has a visible owner, status, and next step; exceptions are easy to find.",
  },
  "ai-assist": {
    name: "Assist with intake and checks",
    type: "AI-assisted intake + explicit checks",
    reason:
      "Documents and mixed inputs can make manual intake expensive. AI could help prepare structured information; explicit checks and a person should handle uncertainty and exceptions.",
    project:
      "Use a representative set of sample inputs to prepare key fields, compare them against the agreed source, and present exceptions for review. Keep the first version read-only.",
    success:
      "The team can verify extracted fields against their sources, and ambiguous or missing information is routed for review.",
  },
  integration: {
    name: "Connect the systems",
    type: "System integration",
    reason:
      "When the information is structured and the steps follow clear rules, connecting the systems may remove repeated entry without needing an AI model.",
    project:
      "Map one set of records between two approved systems. Validate the mapping with a read-only preview before enabling any writes, with duplicate handling and visible errors.",
    success:
      "The reviewed sample maps correctly, duplicate input does not create duplicate work, and failures are visible.",
  },
  rules: {
    name: "Automate the repeatable checks",
    type: "Rules-based automation",
    reason:
      "Structured information and repeatable rules are a good starting point for straightforward validation and comparison. An AI model may not be necessary.",
    project:
      "Choose one recurring check. Define the expected inputs, the comparison rules, and the exceptions, then produce a reviewable result alongside the current process.",
    success:
      "Agreed examples produce the expected findings, and missing or conflicting information is clearly flagged.",
  },
};

export function createBrief(raw, { sample = false } = {}) {
  const validation = validateAnswers(raw);
  if (!validation.valid) {
    const error = new Error("Complete the checkup before creating a brief.");
    error.fields = validation.errors;
    throw error;
  }
  const a = validation.answers;
  const key = chooseApproach(a);
  const systemNames = new Intl.ListFormat("en-US", {
    style: "long",
    type: "conjunction",
  }).format(a.systems.map((system) => SYSTEMS[system]));
  const approach = APPROACHES[key];
  const hours = (a.repetitions * a.minutes) / 60;
  const hoursLabel = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: hours < 0.1 ? 2 : 1,
  }).format(hours);
  const period = {
    daily: "working day",
    weekly: "week",
    monthly: "month",
    occasional: "batch",
  }[a.frequency];
  const heightened =
    a.impact === "consequential" ||
    a.impact === "critical" ||
    a.dataSensitivity === "regulated";
  const opportunities = [{ title: approach.name, detail: approach.reason }];
  if (key !== "integration" && a.systems.length > 1)
    opportunities.push({
      title: "Capture information once",
      detail: `Check how ${systemNames} exchange information today. Identify an approved source and remove one unnecessary re-entry step.`,
    });
  else
    opportunities.push({
      title: "Make exceptions visible",
      detail:
        "Give missing, conflicting, or unexpected information a visible place to go, with a named person responsible for resolving it.",
    });
  if (key !== "reporting")
    opportunities.push({
      title: "Keep a useful operational record",
      detail:
        "Record what was received, what was checked, who reviewed it, and what happened next. Use that record to find recurring delays or errors.",
    });
  else
    opportunities.push({
      title: "Give the report an owner",
      detail:
        "Assign responsibility for definitions, access, refresh timing, and changes so the report stays useful after its first delivery.",
    });
  const guardrails = [
    heightened
      ? "Begin with read-only information and draft outputs. A responsible person approves consequential actions."
      : "Agree which operations may happen automatically and which exceptions must return to a person.",
    "Use only approved data and access. Confirm the permitted operation before connecting or changing a system.",
    "Keep a record of the source, checks, review, and outcome. Provide a visible stop and recovery path when something is missing or fails.",
  ];
  if (
    a.dataSensitivity === "personal" ||
    a.dataSensitivity === "regulated" ||
    a.dataSensitivity === "unsure"
  )
    guardrails.push(
      "Confirm data sensitivity, permitted storage, and any provider access before choosing services or using real records.",
    );
  if (a.boundaries) guardrails.push(`Your boundary: ${a.boundaries}`);
  const preparation = [
    "A representative set of sample inputs, including normal cases, missing information, and exceptions.",
    `Agreement on the source of truth across ${systemNames}${a.systemsDetails ? ` (${a.systemsDetails})` : ""}.`,
    `A review session with ${a.reviewer} to agree the rules and what a good result looks like.`,
  ];
  if (a.trigger === "varies")
    preparation.push(
      "A clear definition of when this work should start, including events that should not trigger it.",
    );
  return {
    version: 1,
    sample: Boolean(sample),
    answers: a,
    approachKey: key,
    approach: approach.type,
    title: a.workflowName,
    department: DEPARTMENTS[a.department],
    goal: GOALS[a.goal],
    baseline: `${hoursLabel} ${hours === 1 ? "hour" : "hours"} per ${period}`,
    baselineDetail: `${a.repetitions.toLocaleString("en-US")} occurrences × ${a.minutes.toLocaleString("en-US")} minutes, as entered. This is current effort, not predicted savings.`,
    firstProject: approach.project,
    opportunities,
    preparation,
    guardrails,
    review: `${a.reviewer} should review exceptions and approve decisions within their actual authority.${heightened ? " Keep external communications, financial changes, and system writes behind an explicit approval." : " Agree on a clear exception and escalation path before a live rollout."}`,
    plan: [
      {
        title: "Define one useful result",
        detail:
          "Walk through the current process and examples. Agree the inputs, rules, boundaries, and acceptance criteria.",
      },
      {
        title: "Build a bounded prototype",
        detail:
          "Use sample data to show the proposed workflow, including failure and exception cases. Review the result with the people doing the work.",
      },
      {
        title: "Validate alongside today’s process",
        detail:
          "Compare results, measure review effort and errors, and decide whether the evidence supports a limited live rollout.",
      },
    ],
    success: [
      approach.success,
      "Missing information and failed checks produce visible exceptions rather than silent progress.",
      "Measure the complete process, including review and correction time, before claiming savings.",
    ],
  };
}

export function escapeHTML(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
}
const list = (values) =>
  `<ul>${values.map((value) => `<li>${escapeHTML(value)}</li>`).join("")}</ul>`;

export function renderBriefContent(brief) {
  const e = escapeHTML;
  return `<div class="brief-overview"><span class="eyebrow">${brief.sample ? "Illustrative example · sample inputs" : "Your automation opportunity brief"}</span><h1>${e(brief.title)}</h1><p>${e(brief.department)} <span aria-hidden="true">/</span> ${e(brief.goal)}</p></div>
  <div class="brief-facts"><div><span>Suggested starting point</span><strong>${e(brief.approach)}</strong></div><div><span>Current effort you entered</span><strong>${e(brief.baseline)}</strong><small>${e(brief.baselineDetail)}</small></div></div>
  <section class="brief-section"><h2>The work today</h2><p>${e(brief.answers.description)}</p></section>
  <section class="brief-section"><h2>Three opportunities to explore</h2><ol class="opportunity-list">${brief.opportunities.map((item) => `<li><div><h3>${e(item.title)}</h3><p>${e(item.detail)}</p></div></li>`).join("")}</ol></section>
  <section class="brief-section first-project"><span class="eyebrow">A sensible first project</span><h2>Keep the first step useful and bounded.</h2><p>${e(brief.firstProject)}</p></section>
  <div class="brief-columns"><section class="brief-section"><h2>What needs to be ready</h2>${list(brief.preparation)}</section><section class="brief-section"><h2>Who reviews the work</h2><p>${e(brief.review)}</p></section></div>
  <section class="brief-section"><h2>Boundaries to agree before implementation</h2>${list(brief.guardrails)}</section>
  <section class="brief-section"><h2>From idea to a working result</h2><ol class="brief-plan">${brief.plan.map((item) => `<li><h3>${e(item.title)}</h3><p>${e(item.detail)}</p></li>`).join("")}</ol></section>
  <section class="brief-section"><h2>How to judge the first version</h2>${list(brief.success)}</section>
  <p class="brief-note">This is a starting point based on the answers supplied, using a structured checklist. It is not a validated system design or a guarantee of savings.${brief.sample ? " The sample figures and workflow are illustrative." : ""}</p>`;
}

export function briefAsText(brief) {
  return [
    "NEXT LEVEL SOFTWARE SOLUTIONS",
    brief.sample
      ? "ILLUSTRATIVE EXAMPLE — SAMPLE INPUTS"
      : "YOUR AUTOMATION OPPORTUNITY BRIEF",
    brief.title,
    "",
    `Team: ${brief.department}`,
    `Goal: ${brief.goal}`,
    `Suggested approach: ${brief.approach}`,
    `Current effort: ${brief.baseline}`,
    brief.baselineDetail,
    "",
    "THE WORK TODAY",
    brief.answers.description,
    "",
    "OPPORTUNITIES TO EXPLORE",
    ...brief.opportunities.map(
      (item, index) => `${index + 1}. ${item.title}\n${item.detail}`,
    ),
    "",
    "A SENSIBLE FIRST PROJECT",
    brief.firstProject,
    "",
    "WHAT NEEDS TO BE READY",
    ...brief.preparation.map((item) => `• ${item}`),
    "",
    "REVIEW",
    brief.review,
    "",
    "BOUNDARIES",
    ...brief.guardrails.map((item) => `• ${item}`),
    "",
    "DELIVERY PLAN",
    ...brief.plan.map(
      (item, index) => `${index + 1}. ${item.title}\n${item.detail}`,
    ),
    "",
    "ACCEPTANCE CRITERIA",
    ...brief.success.map((item) => `• ${item}`),
    "",
    "A starting point based on supplied answers and a structured checklist. Not a validated design or guarantee of savings.",
    "",
    "Discuss your project with Michael Jackson",
    "michael@nextlevelsoftwaresolutions.com | (661) 755-6602",
    "https://nextlevelsoftwaresolutions.com/",
  ].join("\n");
}

export function standaloneBriefHTML(brief) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escapeHTML(brief.title)} — Automation opportunity brief</title><style>
  *{box-sizing:border-box}body{margin:0;background:#eef2ee;color:#172d3b;font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:900px;margin:40px auto;background:#fff;padding:56px}a{color:#194fc0;overflow-wrap:anywhere}header,footer{border-bottom:1px solid #ccd6d8;padding-bottom:22px;margin-bottom:36px}footer{border:0;border-top:1px solid #ccd6d8;padding-top:24px;margin-top:32px}h1{font-size:36px;line-height:1.15;margin:12px 0}h2{font-size:22px;line-height:1.3}h3{font-size:17px;margin:0}.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.12em}p{margin:10px 0 18px}.brief-facts,.brief-columns{display:grid;grid-template-columns:1fr 1fr;gap:30px}.brief-facts{padding:25px;background:#eef4ef;margin:25px 0}.brief-facts span,.brief-facts strong,.brief-facts small{display:block}.brief-facts strong{font-size:21px;margin-top:8px}.brief-section{margin-top:30px}.first-project{background:#eef4ef;padding:24px}li{padding:4px 0}li p{margin-top:5px}.brief-note{font-size:13px;color:#4a606c;border-top:1px solid #ccd6d8;padding-top:20px}.brief-plan{padding-left:22px}@media(max-width:600px){main{padding:24px;margin:0}.brief-facts,.brief-columns{grid-template-columns:1fr}h1{font-size:29px}}@media print{body{background:#fff;font-size:9pt;line-height:1.55}main{margin:0;max-width:none;padding:0}h1{font-size:23pt}h2{font-size:13pt}h3{font-size:11pt}li,.brief-facts,.brief-columns,.first-project{break-inside:avoid}h2,h3{break-after:avoid}.brief-section{margin-top:16px}.brief-facts{padding:16px;margin:18px 0}.brief-facts strong{font-size:14pt}.brief-facts small{font-size:8pt}.first-project{padding:18px}.brief-note{font-size:8pt}.brief-section p{margin-bottom:10px}header{margin-bottom:22px}footer{margin-top:22px}@page{margin:18mm}}
  </style></head><body><main><header><strong>Next Level Software Solutions LLC</strong><br>Software · Systems · Practical AI</header>${renderBriefContent(brief)}<footer><strong>Let’s make the next step concrete.</strong><p>Discuss your project with Michael Jackson.<br><a href="mailto:michael@nextlevelsoftwaresolutions.com">michael@nextlevelsoftwaresolutions.com</a> · <a href="tel:+16617556602">(661) 755-6602</a><br><a href="https://nextlevelsoftwaresolutions.com/">nextlevelsoftwaresolutions.com</a></p></footer></main></body></html>`;
}
