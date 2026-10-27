import { escapeHTML } from "../order-check-model.js";
const e = escapeHTML;
const interpretationLabel = (receipt) =>
  receipt?.mode === "prepared"
    ? "Prepared sample readings; no live AI call"
    : receipt?.mode === "recorded"
      ? `Recorded AI extraction · ${receipt.provider} / ${receipt.model}; no new model call for this replay`
      : `${receipt?.provider || "AI"} / ${receipt?.model || "model not recorded"}`;
export function sourceReference(ref, sources) {
  const source = sources.find((s) =>
    s.anchors.some((a) => a.id === ref.anchorId),
  );
  const anchor = source?.anchors.find((a) => a.id === ref.anchorId);
  return `${source?.name || "Source document"} · ${anchor?.label || ref.anchorId}`;
}
export function comparisonText({ result, receipt, sources, corrections = [] }) {
  return [
    "NEXT LEVEL SOFTWARE SOLUTIONS | INTELLIGENT ORDER CHECKER",
    `Generated: ${result.generatedAt}`,
    `Interpretation: ${interpretationLabel(receipt)}`,
    `Status: ${result.status.replaceAll("_", " ")}`,
    "",
    ...result.findings.flatMap((f) => [
      `[${f.status.toUpperCase()}] ${f.title}`,
      `Ordered: ${f.expected}`,
      `Acknowledged: ${f.actual}`,
      f.explanation,
      ...f.evidence.map(
        (ref) =>
          `Source: ${sourceReference(ref, sources)} | ${ref.support === "image_reference" ? "AI image reading" : "Source text"}: ${ref.quote}`,
      ),
      "",
    ]),
    "NORMALIZATIONS",
    ...result.normalizations.map(
      (n) =>
        `${n.role}/${n.lineId}: ${n.sourceValue} → ${n.result}. Basis: ${n.basis}.`,
    ),
    "",
    "UNRESOLVED QUESTIONS",
    ...result.questions.map((q) => q.prompt),
    "",
    "PROFILE VERSIONS USED",
    ...result.profileVersions.map(
      (p) => `${p.name}: ${p.id}, revision ${p.revision}`,
    ),
    "",
    "USER CORRECTIONS",
    ...corrections.map(
      (c) =>
        `${c.role}/${c.lineId}/${c.field}: ${c.before ?? "not determined"} → ${c.after} (${c.at})`,
    ),
    "",
    "SOURCE FILES",
    ...sources.map((s) => `${s.name} | SHA-256 ${s.hash}`),
    "",
    "Findings compare interpreted information. They do not verify authenticity, establish legal equivalence, approve an order, or transmit a business transaction.",
    "https://nextlevelsoftwaresolutions.com/",
  ].join("\n");
}
export function comparisonHTML({ result, receipt, sources, corrections = [] }) {
  const citation = (ref) =>
    `<li>${e(sourceReference(ref, sources))}<br><small>${ref.support === "image_reference" ? "AI image reading; check the original region" : "Source text located"}${ref.bbox ? ` · region ${e(ref.bbox.map((n) => Number(n).toFixed(3)).join(", "))}` : ""}</small><blockquote>${e(ref.quote)}</blockquote></li>`;
  const title =
    result.status === "checked_fields_match"
      ? "Checked fields match"
      : result.status === "partly_unresolved"
        ? "Some interpretations need clarification"
        : "Differences and conditions need review";
  const calculations = `<h2>How values were normalized</h2><ul>${result.normalizations.map((n) => `<li>${e(n.role)}/${e(n.lineId)}: ${e(n.sourceValue)} → ${e(n.result)}<br><small>Basis: ${e(n.basis)}</small></li>`).join("") || "<li>No completed normalizations.</li>"}</ul>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'"><title>Order comparison | Next Level Software Solutions</title><style>body{font:14px/1.65 system-ui,sans-serif;color:#142e3d;max-width:1020px;margin:40px auto;padding:0 24px}h1{font-size:36px;line-height:1.1}h2{font-size:24px;margin-top:32px}h3{font-size:18px}.brand{font-size:10px;letter-spacing:.13em;color:#2154c5}.summary{padding:24px;background:#edf0e4}article{border-top:1px solid #d7deda;padding:20px 0;break-inside:avoid}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{padding:10px;border-bottom:1px solid #d7deda;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{font-size:11px}small{color:#526671}li{margin:10px 0;overflow-wrap:anywhere}blockquote{font-size:12px;margin:5px 0;color:#526671}.status{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em}.difference,.missing,.extra{color:#8c4328}.match,.confirmed{color:#3b6636}.unresolved,.review{color:#826315}.footer{border-top:1px solid #d7deda;padding-top:20px;margin-top:32px;font-size:11px}@media print{body{font-size:10px;margin:0;padding:0}h1{font-size:26px}article{break-inside:auto}h2,h3{break-after:avoid}thead{display:table-header-group}tr{break-inside:avoid}@page{margin:16mm}}</style></head><body><p class="brand">NEXT LEVEL SOFTWARE SOLUTIONS / INTELLIGENT ORDER CHECKER</p><h1>${e(title)}</h1><p><small>${e(result.generatedAt)} · ${e(interpretationLabel(receipt))}</small></p><div class="summary"><strong>${result.counts.difference + result.counts.missing + result.counts.extra} differences / missing / additional findings</strong><br>${result.counts.match} matching readings · ${result.counts.unresolved} unresolved findings · ${result.questions.length} open questions</div>${result.findings.map((f) => `<article><p class="status ${e(f.status)}">${e(f.status)}</p><h3>${e(f.title)}</h3><table><thead><tr><th>Purchase order</th><th>Acknowledgement</th></tr></thead><tbody><tr><td>${e(f.expected)}</td><td>${e(f.actual)}</td></tr></tbody></table><p>${e(f.explanation)}</p><details><summary>Source references</summary><ul>${f.evidence.map(citation).join("")}</ul></details></article>`).join("")}<h2>Unresolved interpretations</h2>${result.questions.length ? `<ul>${result.questions.map((q) => `<li>${e(q.prompt)}<br><small>${e(q.explanation)}</small></li>`).join("")}</ul>` : "<p>No open clarification questions remain in this comparison.</p>"}${calculations}<h2>What was learned</h2>${result.learning.map((l) => `<h3>${l.role === "po" ? "Purchase order" : "Acknowledgement"}</h3><p><strong>Discovered field mappings</strong></p><ul>${l.discovered.map((m) => `<li>${e(m)}</li>`).join("")}</ul><p><strong>Confirmed rules reused</strong></p><ul>${l.confirmed.map((r) => `<li>${e(r.explanation)} (profile revision ${r.profileRevision})</li>`).join("")}</ul>`).join("")}<h2>User-confirmed interpretations in this run</h2><ul>${result.learnableRules.map((r) => `<li>${e(r.explanation)}</li>`).join("")}</ul><h2>Profile versions used</h2><ul>${result.profileVersions.map((p) => `<li>${e(p.name)} · ${e(p.id)} · revision ${p.revision}</li>`).join("") || "<li>No saved profile was applied.</li>"}</ul><h2>Corrections</h2><ul>${corrections.map((c) => `<li>${e(c.role)}/${e(c.lineId)}/${e(c.field)}: ${e(c.before ?? "not determined")} → ${e(c.after)} · ${e(c.at)}</li>`).join("") || "<li>No manual value corrections were recorded.</li>"}</ul><h2>Source custody</h2><ul>${sources.map((s) => `<li>${e(s.name)}<br><small>SHA-256 ${e(s.hash)}</small>${s.warnings?.length ? `<ul>${s.warnings.map((w) => `<li>${e(w)}</li>`).join("")}</ul>` : ""}</li>`).join("")}</ul><details><summary>Interpretation receipt</summary><p>${e(receipt?.requestId || (receipt?.mode === "prepared" ? "Prepared sample interpretation" : "Request identifier not recorded"))}</p>${receipt?.usage ? `<p>Provider-reported input tokens: ${e(receipt.usage.inputTokens)}. Output tokens: ${e(receipt.usage.outputTokens)}. Estimated inference cost: USD ${e(receipt.usage.estimatedUSD)}.</p>` : ""}</details><p class="footer">These findings compare interpreted information. AI-read image values and inferred relationships are not independently verified business facts. Conditions, authenticity, and unresolved meanings still need review. This report does not approve an order or transmit a business transaction.<br><strong>Next Level Software Solutions LLC</strong> · <a href="https://nextlevelsoftwaresolutions.com/">nextlevelsoftwaresolutions.com</a></p></body></html>`;
}
export function freezeRun(value) {
  const snapshot = structuredClone(value);
  function freeze(obj) {
    if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
      Object.values(obj).forEach(freeze);
      Object.freeze(obj);
    }
    return obj;
  }
  return freeze(snapshot);
}
