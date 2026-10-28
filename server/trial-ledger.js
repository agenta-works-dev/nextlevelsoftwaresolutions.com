import { DocumentError } from "../scripts/documents/schema.js";

export const BROWSER_TRIAL_LIMIT = 5;

// Existing one-attempt records count as one; changing the allowance does not
// erase usage or invalidate a visitor's signed identity.
export function visitorAttempts(record) {
  return record ? Math.max(1, Number(record.count) || 1) : 0;
}

export function emptyLedger() {
  return { version: 1, visitors: {}, ips: {}, months: {} };
}
export function reserveTrial(
  state,
  { visitor, ip, now = new Date(), monthlyLimit = 100, dailyIPLimit = 5 },
) {
  const day = now.toISOString().slice(0, 10),
    month = day.slice(0, 7),
    ipKey = `${day}:${ip}`;
  const used = visitorAttempts(state.visitors[visitor]);
  if (used >= BROWSER_TRIAL_LIMIT)
    throw new DocumentError(
      "This browser has used all five free document interpretations. You can still answer questions, correct the current interpretation, export results, and explore the sample learning demonstration.",
      "trial_used",
    );
  if ((state.ips[ipKey] || 0) >= dailyIPLimit)
    throw new DocumentError(
      "This network's daily demonstration limit has been reached. Please contact us if several people are reviewing the tool together.",
      "network_limit",
    );
  if ((state.months[month] || 0) >= monthlyLimit)
    throw new DocumentError(
      "The free demonstration's processing allowance is currently used up. The sample learning demonstration is still available.",
      "monthly_limit",
    );
  const next = structuredClone(state);
  next.visitors[visitor] = {
    count: used + 1,
    status: "started",
    at: now.toISOString(),
  };
  next.ips[ipKey] = (next.ips[ipKey] || 0) + 1;
  next.months[month] = (next.months[month] || 0) + 1;
  for (const key of Object.keys(next.ips))
    if (
      key.slice(0, 10) <
      new Date(now.getTime() - 3 * 86400000).toISOString().slice(0, 10)
    )
      delete next.ips[key];
  for (const key of Object.keys(next.visitors))
    if (
      new Date(next.visitors[key].at).getTime() <
      now.getTime() - 366 * 86400000
    )
      delete next.visitors[key];
  for (const key of Object.keys(next.months))
    if (
      key < new Date(now.getTime() - 370 * 86400000).toISOString().slice(0, 7)
    )
      delete next.months[key];
  return next;
}
export function finishTrial(state, visitor, status) {
  const next = structuredClone(state);
  if (next.visitors[visitor]) next.visitors[visitor].status = status;
  return next;
}
export async function hmac(secret, text) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return [
    ...new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)),
    ),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
export async function visitorIdentity(request, secret, now = Date.now()) {
  const raw = request.headers
    .get("Cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("nlss_order_trial="))
    ?.slice("nlss_order_trial=".length);
  let value = raw,
    setCookie = null;
  const parts = raw?.split(".");
  const verify = async () => {
    if (!/^[a-f0-9]{64}$/.test(parts[2] || "")) return false;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify(
      "HMAC",
      key,
      Uint8Array.from(parts[2].match(/../g), (hex) => parseInt(hex, 16)),
      new TextEncoder().encode(parts[0] + "." + parts[1]),
    );
  };
  if (
    !parts ||
    parts.length !== 3 ||
    !/^[a-f0-9-]{36}$/.test(parts[0]) ||
    !/^\d{13}$/.test(parts[1]) ||
    Number(parts[1]) <= now ||
    !(await verify())
  ) {
    const id = crypto.randomUUID(),
      expires = now + 365 * 86400000,
      base = id + "." + expires;
    value = base + "." + (await hmac(secret, base));
    setCookie = `nlss_order_trial=${value}; Path=/api/order-checker; HttpOnly; SameSite=Strict; Max-Age=31536000${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
  }
  return { key: await hmac(secret, "visitor:" + value), setCookie };
}
