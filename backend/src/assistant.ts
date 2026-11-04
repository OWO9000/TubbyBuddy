import { chat, type Effort } from "./meta.js";

export interface AssistantTurn {
  role: "user" | "assistant";
  content: string;
}

/** One short coach reply from Muse Spark. Plain text, no JSON schema, so replies stay quick. */
export async function assistantReply(opts: {
  system: string;
  messages: AssistantTurn[];
  effort?: Effort;
}): Promise<{ text: string; model: string; latencyMs: number }> {
  const r = await chat({
    messages: [{ role: "system", content: opts.system }, ...opts.messages],
    // "minimal" keeps a coach turn around 2-3 s; "low" roughly doubles the hidden reasoning.
    effort: opts.effort ?? "minimal",
    timeoutMs: 45_000,
    retries: 1,
  });
  return { text: cleanReply(r.message.content ?? ""), model: r.model, latencyMs: r.latencyMs };
}

/** Em dashes and emoji read as machine-written in a chat bubble: commas and words do the same job. */
export function plainDashes(s: string): string {
  return s
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\uFE0F\u200D]/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.!?,])/g, "$1")
    .replace(/\s*—\s*|\s+–\s+/g, ", ").replace(/,\s*([.!?])/g, "$1").replace(/,\s*,/g, ",").replace(/[\s,]+$/, "");
}

/** Strip code fences, a leading speaker name and wrapping quotes, and keep the reply to a few sentences. */
export function cleanReply(raw: string): string {
  let s = plainDashes(raw.trim());
  s = s.replace(/^```[\s\S]*?\n|```$/g, "").trim();
  s = s.replace(/^(tubby|assistant|coach)\s*:\s*/i, "");
  s = s.replace(/^["'“”](.*)["'“”]$/s, "$1").trim();
  // Muse sometimes drops the final period on short replies.
  if (s && !/[.!?…"”)]$/.test(s)) s += ".";
  if (s.length > 600) {
    const cut = s.slice(0, 600);
    const end = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("!"), cut.lastIndexOf("?"));
    s = end > 120 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
  }
  return s;
}
