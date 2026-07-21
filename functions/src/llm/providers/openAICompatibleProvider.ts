/**
 * OpenAICompatibleProvider — implements LLMProvider against any OpenAI-compatible
 * Chat Completions API (base URL + Bearer key + model). Used for the KAIRLLM
 * "auto" gateway today, and reusable for Qwen / DeepSeek / GPT / a user's custom
 * provider later — they all speak the same wire format.
 *
 * Supports: text generation, JSON output (response_format: json_object hint with
 * a one-shot bare retry for models that reject it + prompt-embedded schema +
 * parse), and multimodal images (OpenAI vision content parts). Google-Search
 * grounding is Gemini-only, so useGoogleSearch is ignored here.
 */

import { LLMProvider, LLMRequest, LLMResult } from "../LLMProvider";
import { safeHttpsRequest } from "../../utils/safeHttpsTransport";

function extractJson(str: string): unknown {
  const match = str.match(/```json\s*([\s\S]*?)\s*```/);
  let jsonStr = (match?.[1] ?? str).trim();
  const b = jsonStr.indexOf("{");
  const a = jsonStr.indexOf("[");
  const start = b === -1 ? a : a === -1 ? b : Math.min(a, b);
  if (start === -1) throw new Error("No JSON object or array found in the AI response.");
  jsonStr = jsonStr.substring(start);
  try {
    return JSON.parse(jsonStr);
  } catch {
    try {
      return JSON.parse(jsonStr.replace(/,(\s*[\]}])/g, "$1"));
    } catch {
      throw new Error("The AI returned a response that could not be parsed as JSON.");
    }
  }
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly name: string;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly useSafeCustomTransport: boolean;

  constructor(opts: { name?: string; baseUrl: string; apiKey: string; model: string }) {
    this.name = opts.name ?? "openai-compatible";
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    // resolveProvider uses this reserved name only for the business-owned BYOA
    // config. Platform-managed providers retain their existing fetch path.
    this.useSafeCustomTransport = opts.name === "custom";
  }

  async generate(req: LLMRequest): Promise<LLMResult> {
    // Build the user message content — multimodal if image parts are present.
    let userContent: unknown;
    const images = (req.parts ?? []).filter((p) => p.inlineData);
    if (images.length > 0) {
      userContent = [
        { type: "text", text: req.prompt },
        ...images.map((p) => ({
          type: "image_url",
          image_url: { url: `data:${p.inlineData!.mimeType};base64,${p.inlineData!.data}` },
        })),
      ];
    } else if (req.responseSchema) {
      // Embed the ACTUAL schema in the prompt. Gemini enforces responseSchema
      // natively, but OpenAI-compatible gateways (KairLLM auto-router etc.) do
      // not — a bare "respond with JSON" nudge let models invent their own
      // property names (live audit 2026-06-10: formattedText came back as
      // resume_localization, compatibilityScore as compatibility_score — every
      // structured tool returned 200 yet the UI couldn't parse it).
      userContent =
        `${req.prompt}\n\nIMPORTANT: Respond with ONLY a single valid JSON value that conforms EXACTLY to the ` +
        `following JSON Schema. Use EXACTLY these property names (same spelling and casing), the same nesting, ` +
        `no extra keys, no missing required keys, no prose, no markdown fences:\n` +
        `${JSON.stringify(req.responseSchema)}`;
    } else {
      userContent = req.prompt;
    }

    const messages: Array<Record<string, unknown>> = [];
    if (req.system) messages.push({ role: "system", content: req.system });
    messages.push({ role: "user", content: userContent });

    const body: Record<string, unknown> = { model: this.model, messages };
    if (req.responseSchema) body.response_format = { type: "json_object" };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.maxOutputTokens !== undefined) body.max_tokens = req.maxOutputTokens;

    const post = (payload: Record<string, unknown>) => {
      const url = `${this.baseUrl}/chat/completions`;
      const headers = {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      };
      const serializedBody = JSON.stringify(payload);
      const timeoutMs = normalizeTimeoutMs(req.timeoutMs, 150_000);
      if (this.useSafeCustomTransport) {
        return safeHttpsRequest(url, {
          method: "POST",
          headers,
          body: serializedBody,
          timeoutMs,
        });
      }
      return fetch(url, {
        method: "POST",
        headers,
        body: serializedBody,
        // Direct/quality routes retain the historical generous ceiling. A
        // latency-priority routing pool injects a much smaller timeoutMs so a
        // dead candidate cannot block every fallback for 150 seconds.
        signal: AbortSignal.timeout(timeoutMs),
      });
    };

    let resp = await post(body);

    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      // Some gateways/models reject `response_format: json_object` (e.g. Novita
      // via OpenRouter: "Model 'x' does not support 'json_object' response
      // format. Supported formats: json_schema."). The format flag is only a
      // belt-and-suspenders hint here — the exact schema is already embedded in
      // the prompt above and extractJson() parses fenced/prefixed output — so
      // retry ONCE without it instead of failing the tool run.
      const formatRejected =
        resp.status === 400 &&
        "response_format" in body &&
        /response_format|json_object/i.test(detail);
      if (formatRejected) {
        const { response_format: _dropped, ...bare } = body;
        resp = await post(bare);
        if (!resp.ok) {
          const retryDetail = await resp.text().catch(() => "");
          throw new Error(`LLM provider error ${resp.status}: ${retryDetail.slice(0, 500)}`);
        }
      } else {
        throw new Error(`LLM provider error ${resp.status}: ${detail.slice(0, 500)}`);
      }
    }

    const json: any = await resp.json();
    const text: string = json?.choices?.[0]?.message?.content ?? "";
    if (!text) throw new Error("The AI returned an empty response.");

    const raw = req.responseSchema ? extractJson(text) : undefined;

    return {
      text,
      raw,
      model: json?.model ?? this.model,
      provider: this.name,
      usage: {
        inputTokens: json?.usage?.prompt_tokens,
        outputTokens: json?.usage?.completion_tokens,
      },
    };
  }
}

function normalizeTimeoutMs(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || (value ?? 0) < 1_000) return fallback;
  return Math.min(180_000, Math.floor(value!));
}
