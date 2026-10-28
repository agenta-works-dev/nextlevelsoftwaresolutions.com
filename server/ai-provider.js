import {
  compactSchema,
  expandInterpretation,
  interpreterInput,
  SYSTEM_PROMPT,
} from "./order-interpretation.js";
import { DocumentError } from "../scripts/documents/schema.js";

export const MODEL_PRICES = Object.freeze({
  "qwen3-vl-plus": {
    input: 0.2,
    output: 1.6,
    region: "Singapore",
    note: "USD per million tokens, up to 32K input; larger inputs use tiered rates.",
  },
  "gpt-6.1-terra": {
    input: 1,
    output: 5,
    region: "OpenAI standard endpoint",
    note: "USD per million tokens, standard short-context rates.",
  },
  "gpt-6.1-sol": {
    input: 2,
    output: 10,
    region: "OpenAI standard endpoint",
    note: "USD per million tokens, standard short-context rates.",
  },
  "gpt-5.4-mini-2026-03-17": {
    input: 0.75,
    output: 4.5,
    region: "OpenAI standard endpoint",
    note: "USD per million tokens, standard rates.",
  },
});
export function providerConfiguration(env) {
  const provider = env.AI_PROVIDER || "openai";
  if (!["qwen", "openai"].includes(provider))
    throw new DocumentError(
      "Choose Qwen or OpenAI in the private server settings.",
      "configuration",
    );
  const model =
    env.AI_MODEL || (provider === "qwen" ? "qwen3-vl-plus" : "gpt-6.1-terra");
  if (
    !MODEL_PRICES[model] ||
    (provider === "qwen") !== model.startsWith("qwen")
  )
    throw new DocumentError(
      "This model has not been configured for the demonstration.",
      "configuration",
    );
  const apiKey =
    provider === "qwen" ? env.DASHSCOPE_API_KEY : env.OPENAI_API_KEY;
  let url = "https://api.openai.com/v1/responses";
  if (provider === "qwen") {
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(env.QWEN_WORKSPACE_ID || ""))
      return { provider, model, configured: false, apiKey: null, url: null };
    const region = env.QWEN_REGION || "ap-southeast-1";
    if (!["ap-southeast-1", "us-east-1"].includes(region))
      throw new DocumentError(
        "Use an explicitly configured Singapore or Virginia Qwen workspace.",
        "configuration",
      );
    url = `https://${env.QWEN_WORKSPACE_ID}.${region}.maas.aliyuncs.com/compatible-mode/v1/chat/completions`;
  }
  return { provider, model, apiKey, url, configured: Boolean(apiKey) };
}
export function publicProviderStatus(env) {
  const config = providerConfiguration(env);
  return {
    configured: config.configured,
    provider: config.provider,
    model: config.model,
    prices: MODEL_PRICES[config.model],
    region:
      config.provider === "qwen"
        ? env.QWEN_REGION || "ap-southeast-1"
        : "OpenAI standard endpoint",
    privacy:
      config.provider === "openai"
        ? "Selected document text and rendered pages are transmitted to OpenAI. We request no stored response. OpenAI may retain content for abuse monitoring under its API policies."
        : "Selected document text and rendered pages are transmitted to Alibaba Cloud Model Studio in the configured region. Its data-processing and retention terms apply.",
    privacyURL:
      config.provider === "openai"
        ? "https://developers.openai.com/api/docs/guides/your-data"
        : "https://www.alibabacloud.com/help/en/model-studio/",
    maxOutputTokens: 16000,
  };
}
function requestBody(config, input) {
  const introduction = `Interpret the purchase order and acknowledgement below. Source IDs and scoped profile hints:\n${input.text}`;
  if (config.provider === "openai")
    return {
      model: config.model,
      store: false,
      max_output_tokens: 16000,
      reasoning: { effort: "low" },
      input: [
        { role: "developer", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "input_text", text: introduction },
            ...input.images.flatMap((image) => [
              {
                type: "input_text",
                text: `Source image: ${image.role}, page anchor ${image.pageId}`,
              },
              { type: "input_image", image_url: image.data, detail: "high" },
            ]),
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "order_interpretation",
          strict: true,
          schema: compactSchema,
        },
      },
    };
  return {
    model: config.model,
    max_tokens: 16000,
    temperature: 0,
    enable_thinking: false,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          SYSTEM_PROMPT + "\nJSON schema:\n" + JSON.stringify(compactSchema),
      },
      {
        role: "user",
        content: [
          { type: "text", text: introduction },
          ...input.images.flatMap((image) => [
            {
              type: "text",
              text: `Source image: ${image.role}, page anchor ${image.pageId}`,
            },
            { type: "image_url", image_url: { url: image.data } },
          ]),
        ],
      },
    ],
  };
}
export function estimateUsage(model, inputTokens, outputTokens) {
  const rates = MODEL_PRICES[model];
  if (!rates || !Number.isFinite(inputTokens) || !Number.isFinite(outputTokens))
    return null;
  const multiplier =
    model === "qwen3-vl-plus"
      ? inputTokens > 128000
        ? 3
        : inputTokens > 32000
          ? 1.5
          : 1
      : 1;
  return {
    inputTokens,
    outputTokens,
    estimatedUSD: Number(
      (
        ((inputTokens * rates.input + outputTokens * rates.output) *
          multiplier) /
        1000000
      ).toFixed(6),
    ),
    basis:
      "Estimate from provider-reported tokens and configured standard prices; not an invoice.",
  };
}
export async function interpretDocuments({
  sources,
  profileHints = [],
  env,
  signal,
  fetcher = fetch,
  onProviderResponse = null,
}) {
  const config = providerConfiguration(env);
  if (!config.configured)
    throw new DocumentError(
      "Live AI is not configured. Add the provider key to the private server settings; no document has been sent to a model.",
      "not_configured",
    );
  const input = interpreterInput(sources, profileHints);
  const request = requestBody(config, input);
  const timeout = AbortSignal.timeout(150000);
  let response;
  try {
    response = await fetcher(config.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      // Workers supports manual/follow, but throws for the standard error
      // mode before sending a request. Manual preserves the no-forwarding
      // boundary for the provider credential and document contents.
      redirect: "manual",
    });
  } catch {
    throw new DocumentError(
      "The AI service did not finish the request. No comparison was produced; please contact us before trying another paid interpretation.",
      "provider_unavailable",
    );
  }
  if (response.status >= 300 && response.status < 400)
    throw new DocumentError(
      "The AI endpoint returned an unexpected redirect. The request was not forwarded and no comparison was produced.",
      "provider_unavailable",
    );
  if (!response.ok)
    throw new DocumentError(
      response.status === 401 || response.status === 403
        ? "The AI service rejected the configured account credentials. No comparison was produced."
        : response.status === 429
          ? "The AI provider's usage limit was reached. No comparison was produced."
          : "The AI service returned an error. No comparison was produced.",
      "provider_unavailable",
    );
  const raw = await response.text();
  if (raw.length > 1500000)
    throw new DocumentError(
      "The AI response exceeded the demonstration limit.",
      "provider_output",
    );
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new DocumentError(
      "The AI service returned an unreadable response.",
      "provider_output",
    );
  }
  if (onProviderResponse) await onProviderResponse(data);
  let resultText, inputTokens, outputTokens;
  if (config.provider === "openai") {
    if (data.status !== "completed")
      throw new DocumentError(
        "The AI response was incomplete. Use a smaller redacted document pair; no partial result is presented as a completed comparison.",
        "provider_output",
      );
    const content = (data.output || []).flatMap((item) => item.content || []);
    if (content.some((item) => item.type === "refusal"))
      throw new DocumentError(
        "The AI service declined to process this document pair.",
        "provider_output",
      );
    resultText = content
      .filter((item) => item.type === "output_text")
      .map((item) => item.text)
      .join("");
    inputTokens = data.usage?.input_tokens;
    outputTokens = data.usage?.output_tokens;
  } else {
    if (data.choices?.[0]?.finish_reason !== "stop")
      throw new DocumentError(
        "The AI response was incomplete. No partial result is used.",
        "provider_output",
      );
    resultText = data.choices[0].message?.content;
    inputTokens = data.usage?.prompt_tokens;
    outputTokens = data.usage?.completion_tokens;
  }
  let wire;
  try {
    wire = JSON.parse(resultText);
  } catch {
    throw new DocumentError(
      "The AI did not produce the required structured interpretation. No guessed result is substituted.",
      "provider_output",
    );
  }
  const extraction = expandInterpretation(wire, sources);
  return {
    extraction,
    receipt: {
      provider: config.provider,
      model: data.model || config.model,
      requestId:
        response.headers.get("x-request-id") ||
        response.headers.get("x-dashscope-request-id") ||
        data.id ||
        null,
      generatedAt: new Date().toISOString(),
      schemaVersion: 1,
      usage: estimateUsage(config.model, inputTokens, outputTokens),
      sourceHashes: sources.map((s) => ({ role: s.id, hash: s.hash })),
      profileVersionsOffered: profileHints.map((p) => ({
        id: p.id,
        revision: p.revision,
      })),
    },
  };
}
