import test from "node:test";
import assert from "node:assert/strict";
import {
  comparisonHTML,
  comparisonText,
  freezeRun,
} from "../scripts/documents/report.js";
import { compareDocuments } from "../scripts/documents/compare.js";
import {
  createProfile,
  profileHints,
  mergeProfiles,
} from "../scripts/documents/profiles.js";
import { casePair } from "./fixtures/document-pairs.mjs";

const confirmed = {
  "match:A1": { value: "P1" },
  "unit:GSK-8|BOX->EA": { value: "12" },
};
test("downloadable reports contain explanations, source custody and unresolved meanings", () => {
  const pair = casePair(),
    result = compareDocuments(pair),
    receipt = { mode: "prepared" };
  const html = comparisonHTML({ ...pair, result, receipt });
  assert.match(html, /Prepared sample readings; no live AI call/);
  assert.match(html, /Source references/);
  assert.match(html, /SHA-256/);
  assert.match(html, /Unresolved interpretations/);
  assert.match(html, /default-src 'none'/);
  const text = comparisonText({ ...pair, result, receipt });
  assert.match(text, /Which ordered item/);
  assert.match(text, /not verify authenticity/);
});
test("untrusted source and document strings cannot introduce executable report markup", () => {
  const pair = casePair(),
    result = compareDocuments({ ...pair, answers: confirmed });
  result.findings[0].explanation =
    '<img src=x onerror="alert(1)"><script>attack()</script>';
  pair.sources[0].name = '<iframe src="https://evil.example">';
  const html = comparisonHTML({
    ...pair,
    result,
    receipt: { mode: "prepared" },
  });
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<iframe"));
  assert.ok(!html.includes("<img src=x"));
});
test("a frozen comparison keeps its original interpretation after later corrections", () => {
  const pair = casePair(),
    result = compareDocuments({ ...pair, answers: confirmed }),
    run = freezeRun({ ...pair, result, receipt: { mode: "prepared" } });
  const before = comparisonHTML(run);
  pair.extraction.documents[0].lines[0].quantity.value = "999";
  result.findings[0].actual = "changed";
  assert.equal(comparisonHTML(run), before);
  assert.throws(() => {
    run.result.findings[0].actual = "overwrite";
  }, TypeError);
});
test("saved hints are not offered to a different business that uses the same headings", () => {
  const pair = casePair(),
    result = compareDocuments({ ...pair, answers: confirmed }),
    profile = createProfile({
      ...pair,
      source: pair.sources[1],
      confirmedRules: result.learnableRules,
      id: "scope-test-profile",
    });
  assert.equal(profileHints([profile], pair.sources).length, 1);
  const other = structuredClone(pair.sources);
  other.forEach((s) =>
    s.anchors.forEach((a) => {
      a.text = a.text.replaceAll(
        "Northstar Demo Manufacturing",
        "Another Organization",
      );
    }),
  );
  assert.equal(profileHints([profile], other).length, 0);
});
test("scanned forms reuse saved rules only after explicit form confirmation", () => {
  const pair = casePair(),
    result = compareDocuments({ ...pair, answers: confirmed });
  pair.sources[1].format = "image";
  const p = createProfile({
    ...pair,
    source: pair.sources[1],
    confirmedRules: result.learnableRules,
    id: "scan-test-profile",
  });
  pair.sources[1].anchors = [
    { id: "ack:scan:p1", kind: "page", text: "", label: "Image 1", page: 1 },
  ];
  const first = compareDocuments({ ...pair, profiles: [p] });
  assert.equal(first.questions.length, 1);
  assert.match(first.questions[0].id, /^profile:/);
  assert.equal(first.usedRules.length, 0);
  const next = compareDocuments({
    ...pair,
    profiles: [p],
    answers: { [`profile:${p.id}:1`]: { value: "use" } },
  });
  assert.equal(next.questions.length, 0);
  assert.equal(next.usedRules.length, 2);
  const declined = compareDocuments({
    ...pair,
    profiles: [p],
    answers: { [`profile:${p.id}:1`]: { value: "skip" } },
  });
  assert.equal(declined.questions[0].id, "match:A1");
});
test("a changed confirmed label declines reuse even when most headings remain familiar", () => {
  const pair = casePair(),
    p = createProfile({
      ...pair,
      source: pair.sources[1],
      id: "confirmed-label-profile",
      confirmedMappings: ["line.quantity"],
    });
  const changed = structuredClone(pair);
  changed.sources[1].anchors.forEach((a) => {
    if (a.text === "Confirmed") a.text = "Scheduled";
  });
  assert.equal(
    compareDocuments({ ...changed, profiles: [p] }).profileVersions.length,
    0,
  );
});
test("currency symbols cannot enable a false same-currency price comparison", () => {
  const pair = casePair({
    buyerReference: true,
    unit: "EA",
    ackPrice: "0.75",
    ackQuantity: "240",
  });
  for (const d of pair.extraction.documents) {
    d.currency.raw = d.currency.value = "$";
    d.lines[0].currency.raw = d.lines[0].currency.value = "$";
  }
  const result = compareDocuments(pair);
  assert.ok(result.questions.some((q) => q.id.endsWith(":currency")));
  assert.equal(
    result.findings.find((f) => f.title.startsWith("Unit price")).status,
    "unresolved",
  );
});
test("party-name conflicts prevent scoped profile creation and stay visible", () => {
  const pair = casePair();
  pair.extraction.documents[1].customer.value = "Another Customer";
  const result = compareDocuments(pair);
  assert.ok(
    result.findings.some(
      (f) => f.title === "Customer name" && f.status === "difference",
    ),
  );
  assert.throws(
    () =>
      createProfile({
        ...pair,
        source: pair.sources[1],
        id: "bad-party-profile",
      }),
    /customer and supplier scope/,
  );
});
test("importing a later revision cannot change a profile's business identity or overwrite a prior revision", () => {
  const c = casePair(),
    p = createProfile({
      ...c,
      source: c.sources[1],
      id: "lineage-test-profile",
    });
  assert.equal(mergeProfiles([p], [p]).length, 1);
  assert.throws(
    () =>
      mergeProfiles(
        [p],
        [
          {
            ...p,
            revision: 2,
            scope: { ...p.scope, supplier: "OTHER SUPPLIER" },
          },
        ],
      ),
    /cannot change/,
  );
  assert.throws(
    () => mergeProfiles([p], [{ ...p, name: "Changed original revision" }]),
    /conflicts/,
  );
  const v2 = { ...p, revision: 2, name: "Corrected profile" };
  assert.equal(mergeProfiles([p], [v2]).length, 2);
  assert.equal(p.revision, 1);
});
