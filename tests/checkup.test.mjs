import test from "node:test";
import assert from "node:assert/strict";
import {
  SAMPLE_ANSWERS,
  validateAnswers,
  createBrief,
  renderBriefContent,
  standaloneBriefHTML,
  briefAsText,
} from "../scripts/checkup-model.js";
import {
  purchaseOrder,
  acknowledgementExamples,
  compareOrder,
} from "../scripts/order-example.js";
const answers = (changes) => ({
  ...SAMPLE_ANSWERS,
  systems: [...SAMPLE_ANSWERS.systems],
  ...changes,
});

test("the illustrative workflow produces a complete, clearly labeled brief", () => {
  const brief = createBrief(answers(), { sample: true });
  assert.equal(brief.sample, true);
  assert.equal(brief.opportunities.length, 3);
  assert.equal(brief.plan.length, 3);
  assert.match(renderBriefContent(brief), /Illustrative example/);
  assert.match(brief.review, /Purchasing lead/);
});
test("an incomplete or malformed input cannot create a brief", () => {
  for (const raw of [null, [], {}, "not answers"]) {
    assert.equal(validateAnswers(raw).valid, false);
    assert.throws(() => createBrief(raw));
  }
});
test("unknown choices and missing systems must be corrected", () => {
  const validation = validateAnswers(
    answers({ impact: "automatic", systems: ["unrecognized"] }),
  );
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.impact);
  assert.ok(validation.errors.systems);
});
test("system inputs are deduplicated and constrained to known tools", () => {
  const validation = validateAnswers(
    answers({ systems: ["email", "email", "bad", null, {}, "erp"] }),
  );
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.answers.systems, ["email", "erp"]);
});
test("invalid, fractional, non-finite, and excessive effort values are refused", () => {
  for (const value of ["", -1, 0, 1.5, Infinity, NaN, null, {}, 1000000]) {
    assert.equal(
      validateAnswers(answers({ repetitions: value })).valid,
      false,
      String(value),
    );
    assert.equal(
      validateAnswers(answers({ minutes: value })).valid,
      false,
      String(value),
    );
  }
});
test("text bounds prevent oversized or empty descriptions entering exports", () => {
  assert.equal(validateAnswers(answers({ description: "short" })).valid, false);
  assert.equal(
    validateAnswers(answers({ description: "x".repeat(1501) })).valid,
    false,
  );
  assert.equal(validateAnswers(answers({ reviewer: "" })).valid, false);
});
test("a clear structured transfer can recommend integration without AI", () => {
  const brief = createBrief(
    answers({
      inputShape: "structured",
      predictability: "consistent",
      goal: "entry",
      impact: "low",
    }),
  );
  assert.equal(brief.approach, "System integration");
  assert.match(brief.firstProject, /read-only preview/);
  assert.match(brief.opportunities[0].detail, /without needing an AI model/);
});
test("structured discrepancy checking can recommend ordinary rules", () => {
  const brief = createBrief(
    answers({
      inputShape: "structured",
      predictability: "consistent",
      goal: "exceptions",
    }),
  );
  assert.equal(brief.approach, "Rules-based automation");
  assert.match(brief.opportunities[0].detail, /AI model may not be necessary/);
});
test("mixed document inputs recommend assisted intake with visible uncertainty", () => {
  const brief = createBrief(answers());
  assert.equal(brief.approach, "AI-assisted intake + explicit checks");
  assert.match(brief.firstProject, /read-only/);
  assert.match(brief.success[0], /ambiguous or missing/);
});
test("reporting recommendations preserve definitions and source calculations", () => {
  const brief = createBrief(answers({ goal: "reporting" }));
  assert.equal(brief.approach, "Reporting & data integration");
  assert.match(brief.firstProject, /definitions/);
  assert.match(brief.success[0], /reviewed source/);
});
test("judgement-heavy and critical work always retain human decision ownership", () => {
  for (const goal of [
    "entry",
    "reporting",
    "exceptions",
    "followup",
    "application",
  ]) {
    for (const inputShape of ["structured", "mixed", "unstructured"]) {
      for (const sensitive of [
        { predictability: "judgement" },
        { impact: "critical" },
      ]) {
        const brief = createBrief(answers({ goal, inputShape, ...sensitive }));
        assert.equal(brief.approach, "Human-led decision support");
        assert.match(
          brief.firstProject,
          /without automated decisions or external changes/,
        );
      }
    }
  }
});
test("consequential work starts read-only and requires approval for external effects", () => {
  const brief = createBrief(answers({ impact: "consequential" }));
  assert.match(brief.guardrails[0], /read-only/);
  assert.match(
    brief.review,
    /external communications, financial changes, and system writes/,
  );
});
test("sensitive or unknown data requires clarification before provider selection", () => {
  for (const dataSensitivity of ["personal", "regulated", "unsure"]) {
    const brief = createBrief(answers({ dataSensitivity }));
    assert.ok(
      brief.guardrails.some((item) =>
        /provider access before choosing services/.test(item),
      ),
    );
  }
});
test("baseline preserves the entered period and does not claim savings", () => {
  for (const [frequency, expected] of [
    ["daily", "working day"],
    ["weekly", "week"],
    ["monthly", "month"],
    ["occasional", "batch"],
  ]) {
    const brief = createBrief(answers({ frequency }));
    assert.equal(brief.baseline, `4 hours per ${expected}`);
    assert.match(brief.baselineDetail, /not predicted savings/);
  }
  assert.equal(
    createBrief(answers({ repetitions: 1, minutes: 1 })).baseline,
    "0.02 hours per week",
  );
  assert.equal(
    createBrief(answers({ repetitions: 1, minutes: 60 })).baseline,
    "1 hour per week",
  );
});
test("stated boundaries stay in the reviewable brief", () => {
  const brief = createBrief(
    answers({ boundaries: "Do not email suppliers or change an order." }),
  );
  assert.ok(
    brief.guardrails.includes(
      "Your boundary: Do not email suppliers or change an order.",
    ),
  );
  assert.match(briefAsText(brief), /Do not email suppliers or change an order/);
});
test("user-supplied HTML is inert in rendered and downloaded briefs", () => {
  const attack = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
  const brief = createBrief(
    answers({
      workflowName: attack,
      description: attack,
      systemsDetails: attack,
      reviewer: attack,
      boundaries: attack,
    }),
  );
  for (const html of [renderBriefContent(brief), standaloneBriefHTML(brief)]) {
    assert.doesNotMatch(html, /<(script|img)\b/i);
    assert.match(html, /&lt;img/);
    assert.match(html, /&lt;script/);
  }
});
test("downloaded brief is a standalone document with company contact information", () => {
  const html = standaloneBriefHTML(createBrief(answers()));
  assert.match(html, /^<!doctype html>/);
  assert.doesNotMatch(html, /<(script|link|iframe|img)\b/i);
  assert.match(html, /michael@nextlevelsoftwaresolutions.com/);
  assert.match(html, /@media print/);
});
test("text export preserves unicode and the complete delivery plan", () => {
  const text = briefAsText(
    createBrief(answers({ workflowName: "Réviser les commandes — 日本語" })),
  );
  assert.match(text, /Réviser les commandes — 日本語/);
  assert.match(text, /VALIDATE|Validate alongside today’s process/);
  assert.match(text, /ACCEPTANCE CRITERIA/);
});
test("order example finds quantity and delivery differences, not a price change", () => {
  assert.deepEqual(
    compareOrder(purchaseOrder, acknowledgementExamples.differences),
    [
      { field: "quantity", label: "20 fewer units" },
      { field: "delivery", label: "6 days later" },
    ],
  );
});
test("matching example makes no finding beyond the three compared fields", () => {
  assert.deepEqual(
    compareOrder(purchaseOrder, acknowledgementExamples.matching),
    [],
  );
});
test("comparison handles increased quantity, price changes, and earlier delivery", () => {
  assert.deepEqual(
    compareOrder(purchaseOrder, {
      quantity: 130,
      unitPrice: 25.25,
      delivery: "2026-11-15",
    }),
    [
      { field: "quantity", label: "10 additional units" },
      { field: "unitPrice", label: "$1.25 higher per unit" },
      { field: "delivery", label: "3 days earlier" },
    ],
  );
});
