import { config } from "./config.js";

export class MetaNotConfigured extends Error {
  constructor() {
    super("META_MODEL_API_KEY is not set on the server");
  }
}

/** Upstream Meta Model API failure. `status` is the upstream HTTP status (502 when the API was unreachable). */
export class MetaApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** True when the server can call Meta models. Routes fall back to the offline coach when false. */
export const isAiConfigured = (): boolean => Boolean(process.env.META_MODEL_API_KEY);

export type JsonSchema = Record<string, unknown>;
export type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
export type Message =
  | { role: "system" | "user"; content: string | ContentPart[] }
  | { role: "assistant"; content: string; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
export interface Tool {
  type: "function";
  function: { name: string; description?: string; parameters: JsonSchema; strict?: boolean };
}
export type Effort = "minimal" | "low" | "medium" | "high";

interface ChatResponse {
  model?: string;
  usage?: unknown;
  choices: { finish_reason?: string; message: { content?: string | null; tool_calls?: ToolCall[] } }[];
}

const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504]);

/** Server-wide daily ceiling on Meta calls, so a public demo URL can't run up the bill. Routes fall back offline past it. */
const DAILY_CALL_CAP = Number(process.env.META_DAILY_CALL_CAP ?? 3000);
let budget = { day: "", calls: 0 };
function spendBudget() {
  const day = new Date().toISOString().slice(0, 10);
  if (budget.day !== day) budget = { day, calls: 0 };
  if (budget.calls >= DAILY_CALL_CAP) throw new MetaApiError(429, "Daily Meta call budget reached");
  budget.calls += 1;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function upstreamMessage(body: string, status: number): string {
  try {
    const j = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    const m = typeof j.error === "string" ? j.error : j.error?.message ?? j.message;
    if (m) return m;
  } catch {
    // Non-JSON error body; fall through to the status line.
  }
  return `Meta Model API returned HTTP ${status}`;
}

/** POST to the Meta Model API with a timeout and exponential backoff on transient failures. Never logs the key. */
async function post<T>(path: string, body: unknown, timeoutMs: number, retries: number): Promise<T> {
  const key = process.env.META_MODEL_API_KEY;
  if (!key) throw new MetaNotConfigured();
  spendBudget();
  let last: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(500 * 2 ** (attempt - 1));
    let res: Response;
    try {
      res = await fetch(`${config.metaBaseUrl}${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      last = new MetaApiError(502, `Meta Model API unreachable: ${(e as Error).message}`);
      continue;
    }
    const text = await res.text();
    if (res.ok) return JSON.parse(text) as T;
    last = new MetaApiError(res.status, upstreamMessage(text, res.status));
    if (!RETRYABLE.has(res.status)) break;
  }
  throw last;
}

export function userContent(text: string, imageUrl?: string): ContentPart[] {
  const parts: ContentPart[] = [{ type: "text", text }];
  if (imageUrl) parts.push({ type: "image_url", image_url: { url: imageUrl } });
  return parts;
}

/**
 * One Muse Spark chat completion.
 * No max_completion_tokens: Muse Spark always reasons, reasoning tokens count against the cap, and a low cap returns empty content.
 */
export async function chat(opts: {
  messages: Message[];
  effort?: Effort;
  tools?: Tool[];
  responseFormat?: { type: "json_schema"; json_schema: { name: string; schema: JsonSchema; strict: boolean } };
  timeoutMs?: number;
  retries?: number;
}): Promise<{ message: ChatResponse["choices"][number]["message"]; finishReason?: string; model: string; usage: unknown; latencyMs: number }> {
  const t0 = Date.now();
  const res = await post<ChatResponse>(
    "/chat/completions",
    {
      model: config.textModel,
      reasoning_effort: opts.effort ?? "low",
      messages: opts.messages,
      ...(opts.tools ? { tools: opts.tools, tool_choice: "auto" } : {}),
      ...(opts.responseFormat ? { response_format: opts.responseFormat } : {}),
    },
    opts.timeoutMs ?? 120_000,
    opts.retries ?? 2,
  );
  const choice = res.choices?.[0];
  if (!choice) throw new MetaApiError(502, "Meta Model API returned no choices");
  return { message: choice.message, finishReason: choice.finish_reason, model: res.model || config.textModel, usage: res.usage, latencyMs: Date.now() - t0 };
}

/** Muse Spark call with constrained JSON output. */
export async function chatJson<T>(opts: {
  system: string;
  user: string | ContentPart[];
  schemaName: string;
  schema: JsonSchema;
  effort?: Effort;
}): Promise<{ data: T; usage: unknown; latencyMs: number; model: string }> {
  const r = await chat({
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    effort: opts.effort,
    responseFormat: { type: "json_schema", json_schema: { name: opts.schemaName, schema: opts.schema, strict: true } },
  });
  const content = r.message.content;
  if (!content) throw new MetaApiError(502, `Empty model response (finish_reason=${r.finishReason})`);
  return { data: JSON.parse(content) as T, usage: r.usage, latencyMs: r.latencyMs, model: r.model };
}

export async function generateImage(prompt: string, size = "1024x1024"): Promise<{ b64: string; latencyMs: number }> {
  const t0 = Date.now();
  const res = await post<{ data?: { b64_json?: string }[] }>(
    "/images/generations",
    { model: config.imageModel, prompt, n: 1, size },
    180_000,
    1,
  );
  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new MetaApiError(502, "Muse Image returned no image data");
  return { b64, latencyMs: Date.now() - t0 };
}
