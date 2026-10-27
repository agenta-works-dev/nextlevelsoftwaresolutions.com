import {
  canonicalText,
  decimal,
  positive,
  conversionFactor,
} from "./numbers.js";
import { DocumentError } from "./schema.js";
import { printedSpanPresent } from "./source-span.js";

export const PROFILE_VERSION = 1;
const clean = (value, max = 240) =>
  String(value ?? "")
    .trim()
    .slice(0, max);
export function businessScope(extraction) {
  const po = extraction.documents.find((d) => d.id === "po");
  const ack = extraction.documents.find((d) => d.id === "ack");
  const party = (key) => {
    const values = [po[key], ack[key]].filter((f) => f?.value);
    if (!values.length || values.some((f) => f.certainty !== "clear"))
      return "";
    const unique = [...new Set(values.map((f) => canonicalText(f.value)))];
    return unique.length === 1 ? unique[0] : "";
  };
  return { customer: party("customer"), supplier: party("supplier") };
}
export function sameScope(a, b) {
  return Boolean(
    a?.supplier &&
    a?.customer &&
    a.supplier === b?.supplier &&
    a.customer === b?.customer,
  );
}
function labelsMatch(profile, raw) {
  const present =
    typeof raw === "function" ? raw : (label) => raw.includes(label);
  const labels = [
    ...new Set(
      profile.mappings
        .map((m) => canonicalText(m.label))
        .filter((l) => l.length >= 3),
    ),
  ];
  const confirmed = profile.mappings
    .filter((m) => m.status === "confirmed")
    .map((m) => canonicalText(m.label));
  return (
    labels.length >= 3 &&
    confirmed.every(present) &&
    labels.filter(present).length / labels.length >= 0.8
  );
}
export function profileMatchesSource(profile, source) {
  if (!profile || profile.format !== source.format || !profile.mappings.length)
    return false;
  const raw = canonicalText(source.anchors.map((a) => a.text || "").join(" "));
  // A file with no text (a scan) cannot independently establish a familiar layout.
  // It can still be interpreted by AI, then explicitly confirmed by the visitor.
  return labelsMatch(profile, (label) =>
    source.anchors.some((a, i) => {
      if (printedSpanPresent(label, [a.text || ""])) return true;
      if (a.kind !== "text") return false;
      const nearby = source.anchors
        .slice(i, i + 3)
        .filter((other) => other.kind === "text" && other.page === a.page);
      return printedSpanPresent(
        label,
        nearby.map((other) => other.text),
      );
    }),
  );
}
export function scannedProfileCandidates(profiles, sources, extraction) {
  const scope = businessScope(extraction);
  return profiles.filter(
    (profile) =>
      sameScope(profile.scope, scope) &&
      profile.rules.length &&
      sources.some((source) => {
        if (
          source.id !== profile.role ||
          source.format !== profile.format ||
          !["image", "pdf"].includes(source.format) ||
          source.anchors.some((a) => a.text?.trim())
        )
          return false;
        const doc = extraction.documents.find((d) => d.id === source.id);
        return labelsMatch(
          profile,
          canonicalText(doc.mappings.map((m) => m.label).join(" ")),
        );
      }),
  );
}
export function reusableProfiles(
  profiles,
  sources,
  extraction,
  confirmedScanProfiles = [],
) {
  const scope = businessScope(extraction);
  const scanned = scannedProfileCandidates(profiles, sources, extraction);
  return profiles.filter(
    (profile) =>
      sameScope(profile.scope, scope) &&
      (sources.some(
        (source) =>
          profile.role === source.id && profileMatchesSource(profile, source),
      ) ||
        (confirmedScanProfiles.includes(`${profile.id}:${profile.revision}`) &&
          scanned.includes(profile))),
  );
}
export function profileHints(profiles, sources) {
  const raw = canonicalText(
    sources.flatMap((s) => s.anchors.map((a) => a.text || "")).join(" "),
  );
  return profiles
    .filter(
      (profile) =>
        raw.includes(profile.scope.customer) &&
        raw.includes(profile.scope.supplier) &&
        sources.some(
          (source) =>
            source.id === profile.role && profileMatchesSource(profile, source),
        ),
    )
    .map((profile) => ({
      id: profile.id,
      revision: profile.revision,
      role: profile.role,
      scope: profile.scope,
      mappings: profile.mappings.map(({ field, label, location, status }) => ({
        field,
        label,
        location,
        status,
      })),
    }));
}
export function validateProfile(input) {
  if (
    input?.schemaVersion !== PROFILE_VERSION ||
    !/^[\w-]{8,100}$/.test(input.id || "") ||
    !Number.isSafeInteger(input.revision) ||
    input.revision < 1 ||
    !["po", "ack"].includes(input.role) ||
    !["own_standard", "external"].includes(input.ownership) ||
    !["pdf", "image", "xlsx", "csv"].includes(input.format)
  )
    throw new DocumentError(
      "This is not a supported document profile.",
      "invalid_profile",
    );
  if (
    !input.scope?.supplier ||
    !input.scope?.customer ||
    String(input.scope.supplier).length > 240 ||
    String(input.scope.customer).length > 240
  )
    throw new DocumentError(
      "A profile needs a customer and supplier scope.",
      "invalid_profile",
    );
  if (
    !Array.isArray(input.mappings) ||
    input.mappings.length > 40 ||
    !Array.isArray(input.rules) ||
    input.rules.length > 100
  )
    throw new DocumentError(
      "Too many mappings or interpretation rules.",
      "invalid_profile",
    );
  const mappings = input.mappings.map((m) => {
    if (
      !["discovered", "confirmed"].includes(m.status) ||
      !m.field ||
      !m.label ||
      !m.location
    )
      throw new DocumentError("Invalid field mapping.", "invalid_profile");
    return {
      field: clean(m.field, 100),
      label: clean(m.label, 160),
      location: clean(m.location),
      status: m.status,
      confirmedAt: m.status === "confirmed" ? clean(m.confirmedAt, 40) : null,
    };
  });
  const rules = input.rules.map((r) => {
    if (
      ![
        "unit",
        "part",
        "date_kind",
        "date_format",
        "split",
        "price_basis",
      ].includes(r.kind) ||
      r.status !== "confirmed"
    )
      throw new DocumentError(
        "Only confirmed interpretation rules can be saved.",
        "invalid_profile",
      );
    const rule = {
      kind: r.kind,
      key: clean(r.key, 500),
      value: clean(r.value, 400),
      status: "confirmed",
      confirmedAt: clean(r.confirmedAt, 40),
      explanation: clean(r.explanation, 800),
    };
    if (
      !rule.key ||
      !rule.value ||
      (r.kind === "unit" && !positive(conversionFactor(rule.value)))
    )
      throw new DocumentError(
        "Invalid confirmed interpretation rule.",
        "invalid_profile",
      );
    if (
      r.kind === "date_kind" &&
      !["delivery", "shipment"].includes(rule.value)
    )
      throw new DocumentError(
        "Invalid date interpretation.",
        "invalid_profile",
      );
    if (r.kind === "date_format" && !["MDY", "DMY"].includes(rule.value))
      throw new DocumentError("Invalid date format.", "invalid_profile");
    if (r.kind === "split" && rule.value !== "combine")
      throw new DocumentError(
        "Invalid delivery grouping rule.",
        "invalid_profile",
      );
    if (r.kind === "price_basis") {
      const [quantity, unit] = rule.value.split("|");
      if (!positive(decimal(quantity)) || !unit || unit.length > 30)
        throw new DocumentError(
          "A pricing basis needs a positive quantity and explicit unit.",
          "invalid_profile",
        );
    }
    if (r.kind === "part") rule.value = canonicalText(rule.value);
    return rule;
  });
  return {
    schemaVersion: PROFILE_VERSION,
    id: input.id,
    revision: input.revision,
    name: clean(input.name, 100) || "Document profile",
    role: input.role,
    ownership: input.ownership,
    format: input.format,
    scope: {
      supplier: canonicalText(input.scope.supplier),
      customer: canonicalText(input.scope.customer),
    },
    mappings,
    rules,
    createdAt: clean(input.createdAt, 40),
    updatedAt: clean(input.updatedAt, 40),
    previousRevision: input.revision > 1 ? input.revision - 1 : null,
  };
}
export function createProfile({
  extraction,
  source,
  ownership = "external",
  previous = null,
  confirmedMappings = null,
  confirmedRules = [],
  now = new Date().toISOString(),
  id = crypto.randomUUID(),
}) {
  const doc = extraction.documents.find((d) => d.id === source.id);
  const scope = businessScope(extraction);
  if (
    previous &&
    (!sameScope(previous.scope, scope) ||
      previous.role !== source.id ||
      previous.format !== source.format)
  )
    throw new DocumentError(
      "A different business, document role, or file format needs a separate profile.",
      "profile_scope",
    );
  const mappings = doc.mappings.map((mapping) => {
    const confirmed = confirmedMappings
      ? confirmedMappings.includes(mapping.field)
      : mapping.status === "confirmed" ||
        previous?.mappings.some(
          (m) =>
            m.field === mapping.field &&
            m.label === mapping.label &&
            m.status === "confirmed",
        );
    return {
      field: mapping.field,
      label: mapping.label,
      location: mapping.location,
      status: confirmed ? "confirmed" : "discovered",
      confirmedAt: confirmed ? now : null,
    };
  });
  const byRule = new Map(
    (previous?.rules || []).map((r) => [`${r.kind}:${r.key}`, r]),
  );
  for (const r of confirmedRules)
    byRule.set(`${r.kind}:${r.key}`, {
      ...r,
      status: "confirmed",
      confirmedAt: now,
    });
  return validateProfile({
    schemaVersion: PROFILE_VERSION,
    id: previous?.id || id,
    revision: (previous?.revision || 0) + 1,
    name: `${source.id === "po" ? "Purchase order" : "Acknowledgement"} · ${scope.supplier}`,
    role: source.id,
    ownership,
    format: source.format,
    scope,
    mappings,
    rules: [...byRule.values()],
    createdAt: previous?.createdAt || now,
    updatedAt: now,
  });
}
export function importProfiles(text) {
  if (typeof text !== "string" || text.length > 2000000)
    throw new DocumentError(
      "Use a profile file up to 2 MB.",
      "invalid_profile",
    );
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new DocumentError(
      "This is not a JSON profile file.",
      "invalid_profile",
    );
  }
  const profiles = Array.isArray(data) ? data : [data];
  if (profiles.length > 50)
    throw new DocumentError(
      "Import at most 50 profile revisions.",
      "invalid_profile",
    );
  return profiles.map(validateProfile);
}
export function mergeProfiles(existing, incoming) {
  const next = existing.map(validateProfile);
  for (const raw of incoming) {
    const profile = validateProfile(raw),
      family = next.find((p) => p.id === profile.id);
    if (
      family &&
      (!sameScope(family.scope, profile.scope) ||
        family.role !== profile.role ||
        family.format !== profile.format)
    )
      throw new DocumentError(
        "A profile revision cannot change its business scope, document role, or file format.",
        "profile_scope",
      );
    const prior = next.find(
      (p) => p.id === profile.id && p.revision === profile.revision,
    );
    if (prior && JSON.stringify(prior) !== JSON.stringify(profile))
      throw new DocumentError(
        "This profile revision conflicts with saved learning. Create a new revision instead of overwriting history.",
        "invalid_profile",
      );
    if (!prior) next.push(profile);
  }
  if (next.length > 50)
    throw new DocumentError(
      "Keep up to 50 profile revisions. Export older learning before removing it.",
      "profile_limit",
    );
  return next;
}
export function profileRule(profiles, kind, key) {
  const matches = profiles.flatMap((p) =>
    p.rules
      .filter((r) => r.kind === kind && r.key === key)
      .map((r) => ({ ...r, profileId: p.id, profileRevision: p.revision })),
  );
  if (!matches.length || new Set(matches.map((r) => r.value)).size !== 1)
    return null;
  return matches[0];
}
export function learningSummary(extraction, profiles, unresolved = []) {
  return extraction.documents.map((doc) => ({
    role: doc.id,
    discovered: doc.mappings.map(
      (m) => `${m.label} → ${m.field} (${m.location})`,
    ),
    confirmed: profiles
      .filter((p) => p.role === doc.id)
      .flatMap((p) =>
        p.rules.map((r) => ({ ...r, profileRevision: p.revision })),
      ),
    uncertain: [
      ...doc.warnings,
      ...unresolved
        .filter((q) => q.role === doc.id || q.role === "both")
        .map((q) => q.prompt),
    ],
  }));
}
