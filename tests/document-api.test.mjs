import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  handleOrderAPI,
  validateRequest,
  boundedJSON,
} from "../server/order-api.js";
import {
  interpretDocuments,
  providerConfiguration,
  estimateUsage,
} from "../server/ai-provider.js";
import { expandInterpretation } from "../server/order-interpretation.js";
import {
  fileLedger,
  startReviewServer,
  readPrivateSettings,
} from "../server/local-order-checker.mjs";
import {
  emptyLedger,
  reserveTrial,
  finishTrial,
  visitorIdentity,
} from "../server/trial-ledger.js";
import { casePair } from "./fixtures/document-pairs.mjs";
import { DOCUMENT_FIELDS, LINE_FIELDS } from "../scripts/documents/schema.js";
import { compareDocuments } from "../scripts/documents/compare.js";
import { readPair } from "../server/evaluate-samples.mjs";

// Model-shaped fixtures exercise the adapter contract, not model accuracy.
export function wireFromRich(extraction) {
  const fact = (f) => ({
    text: f.raw,
    sources: f.evidence.map(({ anchorId, bbox }) => ({ anchorId, bbox })),
  });
  return {
    documents: extraction.documents.map((d) => ({
      id: d.id,
      type: d.type,
      ...Object.fromEntries(DOCUMENT_FIELDS.map((k) => [k, fact(d[k])])),
      lines: d.lines.map((l) => ({
        id: l.id,
        ...Object.fromEntries(LINE_FIELDS.map((k) => [k, fact(l[k])])),
        dateKind: l.dateKind,
        schedules: l.schedules.map((s) => ({
          id: s.id,
          quantity: fact(s.quantity),
          unit: fact(s.unit),
          date: fact(s.date),
          dateKind: s.dateKind,
        })),
        notes: l.notes.map(fact),
      })),
      conditions: d.conditions.map(fact),
      mappings: d.mappings.map(({ field, label, location, evidence }) => ({
        field,
        label,
        location,
        sources: evidence.map(({ anchorId, bbox }) => ({ anchorId, bbox })),
      })),
      uncertain: [],
      warnings: [],
    })),
    links: extraction.links.map(({ evidence, ...l }) => ({
      ...l,
      sources: evidence.map(({ anchorId, bbox }) => ({ anchorId, bbox })),
    })),
    uncertainties: [],
  };
}
const secret = "test-only-signing-secret-long-enough-0001";
const env = {
  LOCAL_REVIEW: "1",
  TRIAL_SIGNING_SECRET: secret,
  AI_PROVIDER: "openai",
  AI_MODEL: "gpt-6.1-terra",
  OPENAI_API_KEY: "test-only-not-a-key",
};
const completed = (wire) =>
  new Response(
    JSON.stringify({
      id: "fixture-response",
      model: env.AI_MODEL,
      status: "completed",
      output: [
        { content: [{ type: "output_text", text: JSON.stringify(wire) }] },
      ],
      usage: { input_tokens: 10000, output_tokens: 5000 },
    }),
    {
      headers: {
        "Content-Type": "application/json",
        "x-request-id": "fixture-request",
      },
    },
  );
const request = (
  body,
  {
    cookie,
    origin = "http://localhost",
    pathname = "/api/order-checker/interpret",
    extraHeaders = {},
  } = {},
) =>
  new Request("http://localhost" + pathname, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
const payload = () => ({
  consent: true,
  sources: casePair().sources,
  profileHints: [],
});
async function tempLedger(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nlss-trial-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, ledger: await fileLedger(dir) };
}

test("adapters send image/text evidence, forbid tools, and request no stored OpenAI response", async () => {
  const pair = casePair();
  let sent;
  const output = await interpretDocuments({
    ...pair,
    env,
    fetcher: async (url, options) => {
      sent = { url, ...options, body: JSON.parse(options.body) };
      return completed(wireFromRich(pair.extraction));
    },
  });
  assert.equal(sent.url, "https://api.openai.com/v1/responses");
  assert.equal(sent.body.store, false);
  assert.equal(sent.body.text.format.strict, true);
  assert.equal(sent.body.tools, undefined);
  assert.equal(sent.redirect, "error");
  assert.ok(sent.body.input[0].content.includes("untrusted evidence"));
  assert.equal(output.extraction.documents[0].lines[0].quantity.raw, "240");
  assert.equal(output.receipt.usage.estimatedUSD, 0.035);
});
test("Qwen uses the private regional workspace and rejects provider/model mismatches", async () => {
  const pair = casePair();
  let body;
  const qwen = {
    AI_PROVIDER: "qwen",
    AI_MODEL: "qwen3-vl-plus",
    QWEN_WORKSPACE_ID: "demo-workspace",
    QWEN_REGION: "ap-southeast-1",
    DASHSCOPE_API_KEY: "test-only",
  };
  assert.match(
    providerConfiguration(qwen).url,
    /^https:\/\/demo-workspace\.ap-southeast-1\.maas\.aliyuncs\.com\//,
  );
  assert.throws(
    () => providerConfiguration({ ...qwen, AI_MODEL: "gpt-6.1-terra" }),
    /not been configured/,
  );
  const out = await interpretDocuments({
    ...pair,
    env: qwen,
    fetcher: async (url, options) => {
      body = JSON.parse(options.body);
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify(wireFromRich(pair.extraction)),
              },
            },
          ],
          usage: { prompt_tokens: 10000, completion_tokens: 5000 },
        }),
      );
    },
  });
  assert.equal(body.response_format.type, "json_object");
  assert.equal(body.enable_thinking, false);
  assert.equal(out.receipt.usage.estimatedUSD, 0.01);
  assert.equal(estimateUsage("qwen3-vl-plus", 40000, 5000).estimatedUSD, 0.024);
});
test("provider refusals, truncation and bad JSON produce no substituted comparison", async () => {
  const pair = casePair();
  for (const body of [
    { status: "incomplete", output: [] },
    { status: "completed", output: [{ content: [{ type: "refusal" }] }] },
    {
      status: "completed",
      output: [{ content: [{ type: "output_text", text: "not JSON" }] }],
    },
  ])
    await assert.rejects(
      interpretDocuments({
        ...pair,
        env,
        fetcher: async () => Response.json(body),
      }),
      (err) => err.code === "provider_output",
    );
  const wire = wireFromRich(pair.extraction);
  wire.documents[1].lines[0].quantity.sources[0].anchorId = "invented-source";
  assert.throws(() => expandInterpretation(wire, pair.sources), /not present/);
});
test("ambiguous currency symbols remain uncertain, even in structured model output", () => {
  const pair = casePair(),
    wire = wireFromRich(pair.extraction);
  const anchor = pair.sources[0].anchors.find((a) => a.cell === "B4");
  anchor.text = "$";
  wire.documents[0].currency.text = "$";
  const result = expandInterpretation(wire, pair.sources);
  assert.equal(result.documents[0].currency.certainty, "uncertain");
});
test("uncertain unit meaning does not make a clearly printed quantity unreadable", () => {
  const pair = casePair({ buyerReference: true }),
    wire = wireFromRich(pair.extraction);
  wire.documents[1].uncertain = [
    {
      path: "lines/A1/quantity",
      explanation: "Pieces per box are not specified.",
      kind: "unit_conversion",
    },
  ];
  const extraction = expandInterpretation(wire, pair.sources);
  assert.equal(extraction.documents[1].lines[0].quantity.certainty, "clear");
  const r = compareDocuments({
    extraction,
    sources: pair.sources,
    answers: { "unit:GSK-8|BOX->EA": { value: "12" } },
  });
  assert.equal(r.questions.length, 0);
  wire.documents[1].uncertain[0].kind = "reading";
  const unclear = expandInterpretation(wire, pair.sources);
  assert.equal(unclear.documents[1].lines[0].quantity.certainty, "uncertain");
});
test("no key means no paid request or reserved trial", async (t) => {
  const { ledger } = await tempLedger(t);
  let calls = 0;
  const response = await handleOrderAPI(
    request(payload()),
    { ...env, OPENAI_API_KEY: "" },
    ledger,
    {
      fetcher: async () => {
        calls++;
        throw new Error();
      },
    },
  );
  assert.equal(response.status, 503);
  assert.equal(calls, 0);
  assert.deepEqual(await ledger.read(), emptyLedger());
});
test("consent and origin admission happen before any provider request", async (t) => {
  const { ledger } = await tempLedger(t);
  let calls = 0;
  const fetcher = async () => {
    calls++;
    throw new Error();
  };
  assert.equal(
    (
      await handleOrderAPI(
        request(payload(), { origin: "https://evil.example" }),
        env,
        ledger,
        { fetcher },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await handleOrderAPI(
        request({ ...payload(), consent: false }),
        env,
        ledger,
        { fetcher },
      )
    ).status,
    400,
  );
  assert.equal(calls, 0);
  assert.deepEqual(await ledger.read(), emptyLedger());
});
test("one browser can admit exactly one request, including concurrent submissions", async (t) => {
  const { ledger } = await tempLedger(t);
  const initial = await handleOrderAPI(
    new Request("http://localhost/api/order-checker/status"),
    env,
    ledger,
  );
  const cookie = initial.headers.get("set-cookie").split(";")[0];
  let calls = 0;
  const pair = casePair(),
    fetcher = async () => {
      calls++;
      return completed(wireFromRich(pair.extraction));
    };
  const responses = await Promise.all([
    handleOrderAPI(request(payload(), { cookie }), env, ledger, { fetcher }),
    handleOrderAPI(request(payload(), { cookie }), env, ledger, { fetcher }),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 429]);
  assert.equal(calls, 1);
  const after = await handleOrderAPI(
    new Request("http://localhost/api/order-checker/status", {
      headers: { Cookie: cookie },
    }),
    env,
    ledger,
  );
  assert.equal((await after.json()).trialUsed, true);
});
test("a failed paid request stays consumed and the ledger retains no document content", async (t) => {
  const { dir, ledger } = await tempLedger(t);
  const first = await handleOrderAPI(
      new Request("http://localhost/api/order-checker/status"),
      env,
      ledger,
    ),
    cookie = first.headers.get("set-cookie").split(";")[0];
  assert.equal(
    (
      await handleOrderAPI(request(payload(), { cookie }), env, ledger, {
        fetcher: async () => new Response("provider failure", { status: 500 }),
      })
    ).status,
    502,
  );
  const response = await handleOrderAPI(
    request(payload(), { cookie }),
    env,
    ledger,
    {
      fetcher: async () => {
        throw new Error("must not run");
      },
    },
  );
  assert.equal(response.status, 429);
  const stored = await readFile(path.join(dir, "trial-usage.json"), "utf8");
  assert.ok(stored.includes('"failed"'));
  assert.doesNotMatch(stored, /Harbor|Northstar|240|csv|quantity|test-only/);
});
test("network and monthly limits hold across distinct browser identifiers", () => {
  const now = new Date("2026-10-26T00:00:00Z"),
    first = reserveTrial(emptyLedger(), {
      visitor: "one",
      ip: "network",
      monthlyLimit: 2,
      dailyIPLimit: 1,
      now,
    });
  assert.throws(
    () =>
      reserveTrial(first, {
        visitor: "two",
        ip: "network",
        dailyIPLimit: 1,
        now,
      }),
    (e) => e.code === "network_limit",
  );
  const second = reserveTrial(first, {
    visitor: "two",
    ip: "other",
    monthlyLimit: 2,
    now,
  });
  assert.throws(
    () =>
      reserveTrial(second, {
        visitor: "three",
        ip: "third",
        monthlyLimit: 2,
        now,
      }),
    (e) => e.code === "monthly_limit",
  );
  assert.equal(emptyLedger().months["2026-10"], undefined);
  assert.equal(
    finishTrial(first, "one", "failed").visitors.one.status,
    "failed",
  );
});
test("signed trial cookies survive ordinary requests but cannot be forged", async () => {
  const first = await visitorIdentity(
    new Request(
      "https://nextlevelsoftwaresolutions.com/api/order-checker/status",
    ),
    secret,
  );
  assert.match(
    first.setCookie,
    /HttpOnly; SameSite=Strict; Max-Age=31536000; Secure/,
  );
  const cookie = first.setCookie.split(";")[0],
    second = await visitorIdentity(
      new Request(
        "https://nextlevelsoftwaresolutions.com/api/order-checker/status",
        { headers: { Cookie: cookie } },
      ),
      secret,
    );
  assert.equal(first.key, second.key);
  assert.equal(second.setCookie, null);
  const forged = await visitorIdentity(
    new Request(
      "https://nextlevelsoftwaresolutions.com/api/order-checker/status",
      {
        headers: {
          Cookie: cookie.slice(0, -1) + (cookie.endsWith("0") ? "1" : "0"),
        },
      },
    ),
    secret,
  );
  assert.notEqual(first.key, forged.key);
});
test("public mode stays disabled until explicitly configured and requires human verification", async (t) => {
  const { ledger } = await tempLedger(t),
    pub = {
      ...env,
      LOCAL_REVIEW: undefined,
      ALLOWED_ORIGIN: "http://localhost",
    };
  assert.equal(
    (await handleOrderAPI(request(payload()), pub, ledger)).status,
    503,
  );
  const enabled = {
    ...pub,
    PUBLIC_ENABLED: "true",
    TURNSTILE_SECRET_KEY: "test-secret",
    TURNSTILE_SITE_KEY: "test-site",
  };
  assert.equal(
    (
      await handleOrderAPI(
        request(payload(), {
          extraHeaders: { "CF-Connecting-IP": "192.0.2.1" },
        }),
        enabled,
        ledger,
      )
    ).status,
    403,
  );
  assert.deepEqual(await ledger.read(), emptyLedger());
});
test("oversized or malformed prepared documents fail before interpretation", async () => {
  const body = payload();
  body.sources[0].hash = "not-a-hash";
  assert.throws(() => validateRequest(body), /identity/);
  const tooLarge = request(payload(), {
    extraHeaders: { "Content-Length": String(13 * 1024 * 1024) },
  });
  await assert.rejects(boundedJSON(tooLarge), /too large/);
  assert.throws(
    () =>
      readPrivateSettings(
        "OPENAI_API_KEY=$(dangerous command)\nPUBLIC_ENABLED=true",
      ),
    /unsupported setting/,
  );
  assert.equal(
    readPrivateSettings("OPENAI_API_KEY=$(not executed)").OPENAI_API_KEY,
    "$(not executed)",
  );
});
test("real PDF and scanned-image payloads satisfy the public page and JPEG bounds", async () => {
  for (const key of ["units", "split"]) {
    const sources = await readPair(key);
    assert.ok(
      sources.every((s) =>
        s.pages.every((p) => p.width <= 1800 && p.height <= 1800),
      ),
    );
    assert.equal(validateRequest({ consent: true, sources }).sources.length, 2);
    const bad = structuredClone(sources);
    bad[0].pages[0].width -= 1;
    assert.throws(
      () => validateRequest({ consent: true, sources: bad }),
      /dimensions/,
    );
  }
});
test("the local review server serves the built page and denies private/server paths", async (t) => {
  const { dir } = await tempLedger(t),
    app = await startReviewServer({
      port: 0,
      privateDirectory: dir,
      env: { ...env, OPENAI_API_KEY: "" },
    });
  t.after(() => app.close());
  const html = await fetch(app.url + "/order-check-next.html");
  assert.equal(html.status, 200);
  assert.match(await html.text(), /Different documents/);
  assert.match(
    html.headers.get("content-security-policy"),
    /object-src 'none'/,
  );
  for (const target of [
    "/server/private-settings.example",
    "/node_modules/pdfjs-dist/package.json",
    "/.env",
    "/package.json",
  ])
    assert.equal((await fetch(app.url + target)).status, 404);
  assert.equal(
    (await fetch(app.url + "/api/order-checker/status")).status,
    200,
  );
  const localhost = new URL(app.url); localhost.hostname = "localhost";
  const aliasRequest = await fetch(localhost.origin + "/api/order-checker/interpret", { method: "POST", headers: { "Content-Type": "application/json", Origin: localhost.origin }, body: JSON.stringify(payload()) });
  assert.equal(aliasRequest.status, 503);
  assert.equal((await aliasRequest.json()).code, "not_configured");
  assert.ok(
    !(await readdir(dir)).some((f) => /document|profile|upload/.test(f)),
  );
});
