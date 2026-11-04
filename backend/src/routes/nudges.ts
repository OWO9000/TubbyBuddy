import { Router } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { APP_NAME } from "../config.js";
import { db, now } from "../db.js";
import { chatJson, isAiConfigured } from "../meta.js";
import { localNudge, localNudgeBatch } from "../demo.js";
import { DeviceId, HttpError, parse, route } from "../http.js";
import { coachOf } from "./assistant.js";
import { plainDashes } from "../assistant.js";

export const nudges = Router();

const Tone = z.enum(["playful", "tough-love", "calm", "hype", "witty"]);
const NudgeContext = z.object({
  deviceId: DeviceId.optional(),
  /** Omitted: the device's saved goals are used (the desktop guard doesn't carry them). */
  goals: z.union([z.string().min(2).max(300), z.array(z.string().min(2).max(200)).min(1).max(6)]).optional(),
  appName: z.string().min(1).max(60),
  pointsAtRisk: z.number().int().min(0).max(1_000_000),
  streak: z.number().int().min(0).max(10_000),
  tone: Tone.optional(),
  nextReward: z.string().max(120).optional(),
  history: z
    .array(z.object({ nudge: z.string().max(300), outcome: z.enum(["backed_off", "opened_anyway"]) }))
    .max(10)
    .optional(),
});
type NudgeContext = z.infer<typeof NudgeContext>;

const SYSTEM = `You write the interruption screen for ${APP_NAME}, a focus app that rewards people with real-world perks
(local cafes, climbing gyms, classes) for staying off apps they chose to limit. Opening a limited app burns their points.
You are their in-the-moment focus guard, not a therapist: no health or medical advice, no guilt-tripping about worth.
Write like a sharp, warm friend. Be concrete: name the app, the points they would burn, their streak, their own goal,
and the real-life reward they are working toward when given. If the streak is 0, don't mention losing it; frame it as
starting one today. Max 140 characters per nudge. No hashtags. At most one emoji.`;

function goalsOf(ctx: NudgeContext): string[] {
  if (ctx.goals) return Array.isArray(ctx.goals) ? ctx.goals : [ctx.goals];
  const saved = ctx.deviceId ? coachOf(ctx.deviceId).goals : [];
  return saved.length ? saved : ["spend less time on distracting apps"];
}

function describe(ctx: NudgeContext) {
  const goals = goalsOf(ctx).join("; ");
  const hist = ctx.history?.length
    ? `\nWhat worked before (adapt tone toward what made them back off):\n${ctx.history
        .map((h) => `- "${h.nudge}" -> ${h.outcome}`)
        .join("\n")}`
    : "";
  return `App they are opening: ${ctx.appName}
Points that would burn: ${ctx.pointsAtRisk}
Current streak: ${ctx.streak} day(s)
Their goals: ${goals}
${ctx.nextReward ? `Reward they are close to: ${ctx.nextReward}\n` : ""}Preferred tone: ${ctx.tone ?? "pick what fits"}${hist}`;
}

const ONE_SCHEMA = {
  type: "object",
  properties: {
    nudge: { type: "string", description: "The interruption message, max 140 chars" },
    tone: { type: "string", enum: Tone.options },
  },
  required: ["nudge", "tone"],
  additionalProperties: false,
};

nudges.post(
  "/nudge",
  route(async (req) => {
    const ctx = parse(NudgeContext, req.body);
    if (!isAiConfigured()) {
      const local = localNudge({ ...ctx, goals: goalsOf(ctx) });
      return { ...local, model: "offline", latencyMs: 0, mode: "demo" };
    }
    try {
      const r = await chatJson<{ nudge: string; tone: string }>({
        system: SYSTEM,
        user: `${describe(ctx)}\n\nWrite one nudge.`,
        schemaName: "nudge",
        schema: ONE_SCHEMA,
      });
      return { nudge: plainDashes(r.data.nudge).slice(0, 200), tone: r.data.tone, model: r.model, latencyMs: r.latencyMs, mode: "live" };
    } catch (e) {
      // A block screen must never wait on, or fail because of, the model.
      console.error("[nudge]", (e as Error).message);
      return { ...localNudge({ ...ctx, goals: goalsOf(ctx) }), model: "offline", latencyMs: 0, mode: "demo", fallback: true };
    }
  }),
);

const BATCH_SCHEMA = {
  type: "object",
  properties: {
    nudges: {
      type: "array",
      items: {
        type: "object",
        properties: { text: { type: "string" }, tone: { type: "string", enum: Tone.options } },
        required: ["text", "tone"],
        additionalProperties: false,
      },
    },
  },
  required: ["nudges"],
  additionalProperties: false,
};

const contextKey = (deviceId: string | undefined, appName: string) =>
  crypto.createHash("sha256").update(`${deviceId ?? "anon"}|${appName.toLowerCase()}`).digest("hex").slice(0, 24);

/** Fill {points}/{streak}/{app} placeholders so cached nudges stay accurate as numbers change. */
export function fillTemplate(text: string, v: { points?: number; streak?: number; app?: string }) {
  return text
    .replaceAll("{points}", String(v.points ?? "your"))
    .replaceAll("{streak}", String(v.streak ?? 0))
    .replaceAll("{app}", v.app ?? "this app");
}

nudges.post(
  "/nudges/batch",
  route(async (req) => {
    const body = parse(NudgeContext.extend({ count: z.number().int().min(1).max(12).default(6) }), req.body);
    let generated: { text: string; tone: string }[];
    let model: string;
    let latencyMs: number;
    if (!isAiConfigured()) {
      generated = localNudgeBatch(body.count, { ...body, goals: goalsOf(body) });
      model = "offline";
      latencyMs = 0;
    } else {
      const r = await chatJson<{ nudges: { text: string; tone: string }[] }>({
        system: SYSTEM,
        user: `${describe(body)}

Write ${body.count} different nudges in a mix of tones. They will be cached on the phone and shown later, so use these
placeholders instead of literal numbers: {points} for points at risk, {streak} for streak days, {app} for the app name.`,
        schemaName: "nudge_batch",
        schema: BATCH_SCHEMA,
      });
      generated = r.data.nudges.map((n) => ({ ...n, text: plainDashes(n.text) }));
      model = r.model;
      latencyMs = r.latencyMs;
    }
    const key = contextKey(body.deviceId, body.appName);
    const ins = db.prepare(`INSERT INTO nudges (device_id, context_key, app_name, text, tone, created_at) VALUES (?,?,?,?,?,?)`);
    const saved = db.transaction(() =>
      generated.slice(0, body.count).map((n) => {
        const info = ins.run(body.deviceId ?? null, key, body.appName, n.text.slice(0, 200), n.tone, now());
        return { id: Number(info.lastInsertRowid), template: n.text, tone: n.tone };
      }),
    )();
    return {
      contextKey: key,
      nudges: saved.map((n) => ({
        ...n,
        preview: fillTemplate(n.template, { points: body.pointsAtRisk, streak: body.streak, app: body.appName }),
      })),
      model,
      latencyMs,
      mode: isAiConfigured() ? "live" : "demo",
    };
  }),
);

/** Instant path for the Android overlay: pop the next cached nudge (no model call). */
nudges.get(
  "/nudges/next",
  route(async (req) => {
    const q = parse(
      z.object({
        deviceId: DeviceId.optional(),
        appName: z.string().min(1).max(60),
        points: z.coerce.number().int().min(0).optional(),
        streak: z.coerce.number().int().min(0).optional(),
      }),
      req.query,
    );
    const key = contextKey(q.deviceId, q.appName);
    const row = db
      .prepare(`SELECT id, text, tone FROM nudges WHERE context_key=? AND used_at IS NULL ORDER BY id LIMIT 1`)
      .get(key) as { id: number; text: string; tone: string } | undefined;
    const remaining = (db.prepare(`SELECT COUNT(*) c FROM nudges WHERE context_key=? AND used_at IS NULL`).get(key) as { c: number }).c;
    if (!row) throw new HttpError(404, "no cached nudges; call POST /api/nudges/batch", { remaining: 0 });
    db.prepare(`UPDATE nudges SET used_at=? WHERE id=?`).run(now(), row.id);
    return { id: row.id, nudge: fillTemplate(row.text, { points: q.points, streak: q.streak, app: q.appName }), tone: row.tone, remaining: remaining - 1 };
  }),
);
