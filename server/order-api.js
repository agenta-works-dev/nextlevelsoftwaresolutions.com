import { LIMITS, DocumentError } from "../scripts/documents/schema.js";
import { publicProviderStatus, interpretDocuments } from "./ai-provider.js";
import {
  hmac,
  visitorIdentity,
  visitorAttempts,
  BROWSER_TRIAL_LIMIT,
} from "./trial-ledger.js";

const MAX_REQUEST_BYTES = 12 * 1024 * 1024;
const responseHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
function jpegSize(dataURL) {
  const bytes = Uint8Array.from(atob(dataURL.slice(23)), (c) =>
      c.charCodeAt(0),
    ),
    view = new DataView(bytes.buffer);
  if (bytes[0] !== 255 || bytes[1] !== 216) return null;
  for (let at = 2; at + 9 < bytes.length;) {
    if (bytes[at] !== 255) break;
    const marker = bytes[at + 1];
    if (marker === 255) {
      at++;
      continue;
    }
    const length = view.getUint16(at + 2);
    if (length < 2 || at + length + 2 > bytes.length) break;
    if (
      [
        192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
      ].includes(marker)
    )
      return [view.getUint16(at + 7), view.getUint16(at + 5)];
    at += length + 2;
  }
  return null;
}
function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...responseHeaders, ...headers },
  });
}
export async function boundedJSON(request) {
  if (!request.headers.get("Content-Type")?.startsWith("application/json"))
    throw new DocumentError(
      "Send a JSON document interpretation request.",
      "request_format",
    );
  if (Number(request.headers.get("Content-Length") || 0) > MAX_REQUEST_BYTES)
    throw new DocumentError(
      "The prepared document pair is too large. Use fewer pages or a smaller redacted excerpt.",
      "document_limit",
    );
  const reader = request.body?.getReader();
  if (!reader)
    throw new DocumentError("The document request is empty.", "request_format");
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new DocumentError(
          "The prepared document pair exceeds the processing limit.",
          "document_limit",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new DocumentError(
      "The document request could not be read.",
      "request_format",
    );
  }
}
export function validateRequest(body) {
  if (
    body?.consent !== true ||
    !Array.isArray(body.sources) ||
    body.sources.length !== 2
  )
    throw new DocumentError(
      "Confirm that the redacted document content may be sent to the stated AI provider.",
      "consent_required",
    );
  const roles = new Set();
  const sources = body.sources.map((source) => {
    if (
      !["po", "ack"].includes(source?.id) ||
      roles.has(source.id) ||
      !/^[a-f0-9]{64}$/.test(source.hash || "") ||
      !["pdf", "image", "xlsx", "csv"].includes(source.format) ||
      typeof source.name !== "string" ||
      source.name.length > 150
    )
      throw new DocumentError(
        "The document identity is invalid.",
        "request_format",
      );
    roles.add(source.id);
    if (
      !Array.isArray(source.anchors) ||
      source.anchors.length < 1 ||
      source.anchors.length > LIMITS.anchors ||
      !Array.isArray(source.pages) ||
      source.pages.length > LIMITS.pages ||
      !Array.isArray(source.warnings) ||
      source.warnings.length > 20
    )
      throw new DocumentError(
        "The document exceeds the processing limits.",
        "document_limit",
      );
    const ids = new Set();
    let characters = 0;
    const anchors = source.anchors.map((a) => {
      if (
        typeof a?.id !== "string" ||
        !a.id.startsWith(source.id + ":" + source.hash.slice(0, 16) + ":") ||
        a.id.length > 160 ||
        ids.has(a.id) ||
        !["cell", "text", "page"].includes(a.kind) ||
        typeof a.text !== "string" ||
        a.text.length > 6000 ||
        (characters += a.text.length) > LIMITS.characters ||
        typeof a.label !== "string" ||
        a.label.length > 240
      )
        throw new DocumentError(
          "A document source location is invalid or too large.",
          "request_format",
        );
      ids.add(a.id);
      if (
        a.kind === "cell" &&
        (typeof a.cell !== "string" ||
          !/^[A-Z]{1,3}[1-9]\d{0,5}$/.test(a.cell) ||
          typeof a.sheet !== "string" ||
          a.sheet.length > 100)
      )
        throw new DocumentError(
          "A spreadsheet source address is invalid.",
          "request_format",
        );
      return {
        id: a.id,
        kind: a.kind,
        text: a.text,
        label: a.label,
        ...(a.page ? { page: a.page } : {}),
        ...(a.bbox ? { bbox: a.bbox } : {}),
        ...(a.kind === "cell"
          ? {
              cell: a.cell,
              sheet: a.sheet,
              formula: a.formula === true,
              valueType: a.valueType || "text",
            }
          : {}),
      };
    });
    const pageIds = new Set();
    const pages = source.pages.map((p) => {
      if (
        !ids.has(p?.id) ||
        pageIds.has(p.id) ||
        !Number.isSafeInteger(p.width) ||
        !Number.isSafeInteger(p.height) ||
        p.width < 1 ||
        p.height < 1 ||
        p.width > LIMITS.imageSide ||
        p.height > LIMITS.imageSide ||
        typeof p.image !== "string" ||
        p.image.length > 2 * 1024 * 1024 ||
        !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(p.image)
      )
        throw new DocumentError(
          "A prepared document page is invalid or too large.",
          "document_limit",
        );
      const size = jpegSize(p.image),
        anchor = anchors.find((a) => a.id === p.id);
      if (
        !size ||
        size[0] !== p.width ||
        size[1] !== p.height ||
        !Number.isSafeInteger(p.number) ||
        p.number < 1 ||
        p.number > LIMITS.pages ||
        anchor.kind !== "page" ||
        anchor.page !== p.number
      )
        throw new DocumentError(
          "The document page dimensions or source reference are invalid.",
          "document_limit",
        );
      pageIds.add(p.id);
      return {
        id: p.id,
        number: p.number,
        width: p.width,
        height: p.height,
        image: p.image,
      };
    });
    const warnings = source.warnings.map((w) => {
      if (typeof w !== "string" || w.length > 1000)
        throw new DocumentError("Invalid document warning.", "request_format");
      return w;
    });
    return {
      id: source.id,
      name: source.name,
      hash: source.hash,
      format: source.format,
      anchors,
      pages,
      warnings,
    };
  });
  if (
    !Array.isArray(body.profileHints || []) ||
    (body.profileHints || []).length > 4 ||
    JSON.stringify(body.profileHints || []).length > 60000
  )
    throw new DocumentError(
      "Too many document profile hints.",
      "document_limit",
    );
  // Hints contain no executable provider settings. They are untrusted model context.
  const hints = (body.profileHints || []).map((p) => ({
    id: String(p.id || "").slice(0, 100),
    revision: Number(p.revision) || 0,
    role: p.role,
    scope: p.scope,
    mappings: p.mappings,
  }));
  return {
    sources,
    profileHints: hints,
    captchaToken:
      typeof body.captchaToken === "string"
        ? body.captchaToken.slice(0, 3000)
        : "",
  };
}
export async function handleOrderAPI(
  request,
  env,
  ledger,
  { fetcher = fetch } = {},
) {
  let identity;
  try {
    const url = new URL(request.url),
      local = env.LOCAL_REVIEW === "1";
    const expectedOrigin = local
      ? url.origin
      : env.ALLOWED_ORIGIN || "https://nextlevelsoftwaresolutions.com";
    if (
      request.headers.get("Origin") &&
      request.headers.get("Origin") !== expectedOrigin
    )
      return json(
        {
          error: "This request must come from the order checker.",
          code: "origin",
        },
        403,
      );
    if (request.headers.get("Sec-Fetch-Site") === "cross-site")
      return json(
        { error: "Cross-site requests are not accepted.", code: "origin" },
        403,
      );
    if (
      typeof env.TRIAL_SIGNING_SECRET !== "string" ||
      env.TRIAL_SIGNING_SECRET.length < 32
    )
      return json(
        {
          error: "The private trial signing secret is not configured.",
          code: "not_configured",
        },
        503,
      );
    identity = await visitorIdentity(request, env.TRIAL_SIGNING_SECRET);
    const headers = identity.setCookie
      ? { "Set-Cookie": identity.setCookie }
      : {};
    if (
      url.pathname === "/api/order-checker/status" &&
      request.method === "GET"
    ) {
      const state = await ledger.read();
      const used = visitorAttempts(state.visitors[identity.key]);
      return json(
        {
          ...publicProviderStatus(env),
          reviewMode: local,
          trialUsed: used >= BROWSER_TRIAL_LIMIT,
          trialsUsed: used,
          trialLimit: BROWSER_TRIAL_LIMIT,
          trialsRemaining: Math.max(0, BROWSER_TRIAL_LIMIT - used),
          publicEnabled: local || env.PUBLIC_ENABLED === "true",
          captchaRequired: !local,
          captchaSiteKey: !local ? env.TURNSTILE_SITE_KEY || null : null,
          limit:
            "Five AI interpretations per browser; anonymous network and global limits also apply. Clarifications and recalculations are local and do not consume another interpretation.",
        },
        200,
        headers,
      );
    }
    if (
      url.pathname !== "/api/order-checker/interpret" ||
      request.method !== "POST"
    )
      return json({ error: "Not found.", code: "not_found" }, 404, headers);
    if (!local && env.PUBLIC_ENABLED !== "true")
      return json(
        {
          error:
            "Live AI processing is temporarily unavailable. The recorded examples remain available. No document has been sent to an AI service.",
          code: "review_only",
        },
        503,
        headers,
      );
    if (request.headers.get("Origin") !== expectedOrigin)
      return json(
        { error: "A same-origin request is required.", code: "origin" },
        403,
        headers,
      );
    const config = publicProviderStatus(env);
    if (!config.configured)
      return json(
        {
          error:
            "Live AI is not configured. The private server settings need a provider key; no document has been sent to a model.",
          code: "not_configured",
        },
        503,
        headers,
      );
    if (
      visitorAttempts((await ledger.read()).visitors[identity.key]) >=
      BROWSER_TRIAL_LIMIT
    )
      throw new DocumentError(
        "This browser has used all five free AI interpretations. Clarifications, local corrections, exports, and recorded samples remain available.",
        "trial_used",
      );
    const ip =
      request.headers.get("CF-Connecting-IP") || (local ? "loopback" : null);
    if (!ip)
      return json(
        { error: "The public request could not be admitted.", code: "network" },
        403,
        headers,
      );
    if (!local) {
      const captchaToken = request.headers.get("X-Order-Verification") || "";
      if (
        !env.TURNSTILE_SECRET_KEY ||
        !env.TURNSTILE_SITE_KEY ||
        !captchaToken ||
        captchaToken.length > 3000
      )
        return json(
          {
            error: "Human verification is required before AI processing.",
            code: "human_verification",
          },
          403,
          headers,
        );
      const verification = await fetcher(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        {
          method: "POST",
          body: new URLSearchParams({
            secret: env.TURNSTILE_SECRET_KEY,
            response: captchaToken,
            remoteip: ip,
          }),
          signal: AbortSignal.timeout(10000),
        },
      );
      const result = await verification.json();
      if (
        !result.success ||
        result.hostname !== new URL(expectedOrigin).hostname ||
        result.action !== "order-check"
      )
        return json(
          {
            error:
              "Human verification did not complete. No AI request was made.",
            code: "human_verification",
          },
          403,
          headers,
        );
    }
    const input = validateRequest(await boundedJSON(request));
    await ledger.reserve({
      visitor: identity.key,
      ip: await hmac(env.TRIAL_SIGNING_SECRET, "ip:" + ip),
      monthlyLimit: Math.max(
        1,
        Math.min(500, Number(env.MONTHLY_TRIAL_LIMIT) || 100),
      ),
      dailyIPLimit: Math.max(1, Math.min(50, Number(env.DAILY_IP_LIMIT) || 5)),
    });
    try {
      const result = await interpretDocuments({
        ...input,
        env,
        signal: request.signal,
        fetcher,
      });
      await ledger.finish(identity.key, "complete");
      return json(result, 200, headers);
    } catch (error) {
      await ledger.finish(identity.key, "failed");
      throw error;
    }
  } catch (error) {
    const known = error instanceof DocumentError;
    const code = known ? error.code : "processing_error";
    const status = ["trial_used", "network_limit", "monthly_limit"].includes(
      code,
    )
      ? 429
      : ["provider_output", "provider_unavailable"].includes(code)
        ? 502
        : code === "not_configured"
          ? 503
          : 400;
    return json(
      {
        error: known
          ? error.message
          : "The document request could not be completed. No comparison has been approved or transmitted.",
        code,
      },
      status,
      identity?.setCookie ? { "Set-Cookie": identity.setCookie } : {},
    );
  }
}
