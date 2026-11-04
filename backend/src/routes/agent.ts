import { Router } from "express";
import { z } from "zod";
import { APP_NAME, config } from "../config.js";
import { db, now } from "../db.js";
import { chat, isAiConfigured, type Message, type Tool } from "../meta.js";
import { localScout } from "../demo.js";
import { BUSINESSES, BUSINESS_CATEGORIES, CITIES } from "../data/directory.js";
import { HttpError, newId, parse, route } from "../http.js";

export const agent = Router();

const TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "search_businesses",
      description: "Search the local business directory. Returns short summaries.",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string" },
          category: { type: "string", description: "food | fitness | class | experience | retail | any" },
        },
        required: ["city", "category"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_business_profile",
      description: "Full profile for one business: description, tags, slow hours, price level.",
      parameters: { type: "object", properties: { businessId: { type: "string" } }, required: ["businessId"], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "score_candidates",
      description: "Record 0-100 fit scores for one or more businesses as reward partners. Call once with all candidates.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          scores: {
            type: "array",
            items: {
              type: "object",
              properties: {
                businessId: { type: "string" },
                score: { type: "integer", description: "0-100" },
                reasons: { type: "array", items: { type: "string" }, description: "1-3 short reasons" },
              },
              required: ["businessId", "score", "reasons"],
              additionalProperties: false,
            },
          },
        },
        required: ["scores"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "draft_outreach",
      description: "Save a personalized partnership pitch as a DRAFT for human review. Nothing is sent.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          businessId: { type: "string" },
          subject: { type: "string" },
          body: { type: "string", description: "Under 120 words, personal, references their slow hours" },
          proposedOffer: { type: "string" },
        },
        required: ["businessId", "subject", "body", "proposedOffer"],
        additionalProperties: false,
      },
    },
  },
];

// Be forgiving about reason shapes (strings or small objects) so one malformed call doesn't waste a turn.
const Reason = z.union([z.string(), z.record(z.string(), z.unknown()).transform((o) => Object.values(o).map(String).join(": "))]);
const ScoreItem = z.object({ businessId: z.string(), score: z.coerce.number().int().min(0).max(100), reasons: z.array(Reason).max(6).default([]) });
const ScoreArgs = z.object({ scores: z.array(ScoreItem).min(1).max(30) });
const DraftArgs = z.object({ businessId: z.string(), subject: z.string().max(140), body: z.string().max(1500), proposedOffer: z.string().max(200) });

interface Step {
  n: number;
  kind: "tool_call" | "message";
  tool?: string;
  args?: unknown;
  result?: unknown;
  text?: string;
  ms: number;
}

agent.post(
  "/agent/discover-merchants",
  route(async (req) => {
    const input = parse(
      z.object({
        city: z.string().trim().min(2).max(60),
        category: z.string().trim().max(40).default("any"),
        topN: z.number().int().min(1).max(5).default(3),
      }),
      req.body,
    );
    const scores = new Map<string, { score: number; reasons: string[] }>();
    const drafts: { id: string; businessId: string; businessName: string; to: string; subject: string; body: string; proposedOffer: string; status: "draft_not_sent" }[] = [];
    const steps: Step[] = [];

    if (!isAiConfigured()) {
      const result = localScout(input, BUSINESSES);
      db.prepare(`INSERT INTO agent_runs (id, input, steps, result, created_at) VALUES (?,?,?,?,?)`).run(
        result.runId, JSON.stringify(input), JSON.stringify(result.steps), JSON.stringify(result), now(),
      );
      return result;
    }

    const exec = (name: string, rawArgs: string): unknown => {
      let args: any;
      try {
        args = JSON.parse(rawArgs || "{}");
      } catch {
        return { error: "arguments were not valid JSON" };
      }
      switch (name) {
        case "search_businesses": {
          const city = String(args.city ?? "").toLowerCase();
          const cat = String(args.category ?? "any").toLowerCase();
          return BUSINESSES.filter((b) => b.city.toLowerCase() === city && (cat === "any" || b.category === cat)).map((b) => ({
            id: b.id, name: b.name, category: b.category, neighborhood: b.neighborhood, rating: b.rating,
          }));
        }
        case "get_business_profile": {
          const b = BUSINESSES.find((x) => x.id === args.businessId);
          if (!b) return { error: "unknown businessId" };
          const { contact: _c, ...profile } = b;
          return profile;
        }
        case "score_candidates": {
          const r = ScoreArgs.safeParse(args);
          if (!r.success) return { error: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
          const unknown: string[] = [];
          for (const it of r.data.scores) {
            if (!BUSINESSES.some((b) => b.id === it.businessId)) unknown.push(it.businessId);
            else scores.set(it.businessId, { score: it.score, reasons: it.reasons });
          }
          return { ok: true, recorded: r.data.scores.length - unknown.length, unknownIds: unknown };
        }
        case "draft_outreach": {
          const r = DraftArgs.safeParse(args);
          if (!r.success) return { error: r.error.issues.map((i) => i.message).join("; ") };
          const b = BUSINESSES.find((x) => x.id === r.data.businessId);
          if (!b) return { error: "unknown businessId" };
          const d = { id: newId("draft"), businessName: b.name, to: b.contact, ...r.data, businessId: b.id, status: "draft_not_sent" as const };
          drafts.push(d);
          return { draftId: d.id, status: d.status, note: "Saved for human review. Not sent." };
        }
        default:
          return { error: `unknown tool ${name}` };
      }
    };

    const messages: Message[] = [
      {
        role: "system",
        content: `You are ${APP_NAME}'s merchant scout agent. ${APP_NAME} users earn points for staying off distracting apps and
redeem them for real-world, in-person perks. Find local businesses that would make great reward partners: offline, social or
hands-on experiences people would trade screen time for, with spare capacity (slow hours) a discount can fill.
Penalize businesses that are always packed, takeaway-only, or phone-centric.
Work in as few turns as possible: search, inspect profiles (parallel calls are fine), call score_candidates ONCE with
every business you found, then call draft_outreach for the top ${input.topN} in parallel. Outreach is a draft for a human to review; never claim it was sent.
Finish with a 2-3 sentence summary of your picks.`,
      },
      { role: "user", content: `City: ${input.city}. Category focus: ${input.category}.` },
    ];

    const t0 = Date.now();
    let summary = "";
    let n = 0;
    const MAX_TURNS = 14;
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const ts = Date.now();
      const { message: msg } = await chat({ messages, tools: TOOLS, effort: "low" });
      const calls = (msg.tool_calls ?? []).filter((c) => c.type === "function");
      const turnMs = Date.now() - ts;
      if (msg.content && msg.content.trim()) steps.push({ n: ++n, kind: "message", text: msg.content.trim(), ms: calls.length ? 0 : turnMs });
      if (!calls.length) {
        summary = msg.content?.trim() ?? "";
        break;
      }
      messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: calls });
      for (const c of calls) {
        const result = exec(c.function.name, c.function.arguments);
        let args: unknown = c.function.arguments;
        try {
          args = JSON.parse(c.function.arguments);
        } catch {
          // Keep the raw string in the step log when the model's arguments aren't valid JSON.
        }
        steps.push({ n: ++n, kind: "tool_call", tool: c.function.name, args, result, ms: turnMs });
        messages.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(result) });
      }
    }

    const ranked = [...scores.entries()]
      .map(([id, s]) => {
        const b = BUSINESSES.find((x) => x.id === id)!;
        return { businessId: id, name: b.name, category: b.category, neighborhood: b.neighborhood, ...s };
      })
      .sort((a, b) => b.score - a.score);
    const runId = newId("run");
    const complete = drafts.length >= Math.min(input.topN, ranked.length) && ranked.length > 0;
    const result = { runId, input, complete, ranked, drafts, summary, totalMs: Date.now() - t0, model: config.textModel, outreachSent: false };
    db.prepare(`INSERT INTO agent_runs (id, input, steps, result, created_at) VALUES (?,?,?,?,?)`).run(
      runId, JSON.stringify(input), JSON.stringify(steps), JSON.stringify(result), now(),
    );
    return { ...result, steps };
  }),
);

agent.get(
  "/agent/cities",
  route(async () => ({
    cities: CITIES,
    categories: ["any", ...BUSINESS_CATEGORIES],
    note: "Mock directory of fictional businesses for the demo.",
  })),
);
