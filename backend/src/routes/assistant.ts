import { Router } from "express";
import { z } from "zod";
import { APP_NAME, COMPANION_NAME, config } from "../config.js";
import { db, now } from "../db.js";
import { achievementsOf, balanceOf, ensureUser, type UserRow } from "../ledger.js";
import { assistantReply, plainDashes } from "../assistant.js";
import { chatJson, isAiConfigured } from "../meta.js";
import { THEMES, themesForGoal, type Theme } from "../offerCatalog.js";
import { DeviceId, deviceIdOf, HttpError, parse, route } from "../http.js";

export const assistant = Router();

const COACH_DEFAULTS = {
  tone: "warm" as const,
  brevity: "short" as const,
  nudges: "sometimes" as const,
  goals: ["Spend less time scrolling"] as string[],
  apps: ["TikTok", "Instagram", "YouTube", "X"] as string[],
};

const CoachSettings = z.object({
  tone: z.enum(["warm", "direct", "playful", "calm"]),
  brevity: z.enum(["short", "balanced"]),
  nudges: z.enum(["off", "sometimes", "often"]),
  goals: z.array(z.string().trim().min(2).max(120)).max(6),
  apps: z.array(z.string().trim().min(1).max(40)).max(12),
});
export type CoachSettings = z.infer<typeof CoachSettings>;

const CoachPatch = CoachSettings.partial();

interface Prefs {
  coach?: Partial<CoachSettings>;
  /** Goal text -> the kinds of offers it points at (from Muse when it read the goal, else keywords). */
  goalThemes?: Record<string, Theme[]>;
  hello?: { text: string; at: number };
}

function prefsOf(deviceId: string): Prefs {
  const u = ensureUser(deviceId);
  try {
    return JSON.parse(u.prefs || "{}") as Prefs;
  } catch {
    return {};
  }
}

function savePrefs(deviceId: string, prefs: Prefs) {
  ensureUser(deviceId);
  db.prepare(`UPDATE users SET prefs=? WHERE device_id=?`).run(JSON.stringify(prefs), deviceId);
}

/** The person's own goals (none for a profile that never set any) and what each one points at. */
export function goalsWithThemes(deviceId: string): { goals: string[]; known: Record<string, Theme[]> } {
  const p = prefsOf(deviceId);
  return { goals: Array.isArray(p.coach?.goals) ? p.coach!.goals! : [], known: p.goalThemes ?? {} };
}

/** Offline goal splitter: "I want to study more and go outside more" -> ["Study more", "Go outside more"]. */
export function splitGoals(text: string): string[] {
  return text
    .split(/\s*(?:,|;|\n|\band also\b|\band\b|&|\+)\s*/i)
    .map((g) => g.replace(/^(i\s+(really\s+)?(want|would like|wanna|need|hope)\s+(to\s+)?|to\s+|more\s+time\s+(for|to)\s+)/i, "").trim())
    .map((g) => g.replace(/[.!?]+$/, ""))
    .filter((g) => g.length >= 3)
    .map((g) => g.charAt(0).toUpperCase() + g.slice(1))
    .slice(0, 6);
}

/** True once the person has saved their own coach setup (onboarding or Settings). */
export function hasCoachSetup(deviceId: string): boolean {
  return Array.isArray(prefsOf(deviceId).coach?.goals);
}

export function coachOf(deviceId: string): CoachSettings {
  const saved = prefsOf(deviceId).coach ?? {};
  return {
    ...COACH_DEFAULTS,
    ...saved,
    goals: (saved.goals ?? COACH_DEFAULTS.goals).slice(0, 6),
    apps: (saved.apps ?? COACH_DEFAULTS.apps).slice(0, 12),
  };
}

function saveCoach(deviceId: string, patch: z.infer<typeof CoachPatch>): CoachSettings {
  const prefs = prefsOf(deviceId);
  const next = coachOf(deviceId);
  if (patch.tone) next.tone = patch.tone;
  if (patch.brevity) next.brevity = patch.brevity;
  if (patch.nudges) next.nudges = patch.nudges;
  if (patch.goals) next.goals = [...new Set(patch.goals.map((g) => g.trim()).filter(Boolean))].slice(0, 6);
  if (patch.apps) next.apps = [...new Set(patch.apps.map((a) => a.trim()).filter(Boolean))].slice(0, 12);
  prefs.coach = next;
  savePrefs(deviceId, prefs);
  return next;
}

/**
 * Typed goals: Muse splits free text into separate short goals and says what each one is about, so Rewards can lead
 * with offers that fit. Falls back to a plain splitter offline.
 */
assistant.post(
  "/assistant/goals",
  route(async (req) => {
    const deviceId = deviceIdOf(req);
    const b = parse(z.object({ text: z.string().trim().min(2).max(400) }), req.body);
    let goals: { goal: string; themes: Theme[] }[] = [];
    let reply = "";
    let mode: "live" | "demo" = "demo";
    if (isAiConfigured()) {
      try {
        const r = await chatJson<{ goals: { goal: string; themes: string[] }[]; reply: string }>({
          system: `You turn what someone types about wanting more time into separate goals for a focus app.
Split it into 1 to 4 distinct goals. Write each as a short phrase in their words, starting with a capital letter, 2 to 6 words, no "I want to", no period (for example "Study more", "Go outside more").
Tag each goal with the themes it points at, from: ${THEMES.join(", ")}.
Then write a reply from ${COMPANION_NAME}, a small pink cat: one or two short sentences, warm and a little playful, that names the goals back. No emoji, no dashes, no exclamation marks beyond one.`,
          user: b.text,
          schemaName: "goals",
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["goals", "reply"],
            properties: {
              goals: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["goal", "themes"],
                  properties: { goal: { type: "string" }, themes: { type: "array", items: { type: "string", enum: [...THEMES] } } },
                },
              },
              reply: { type: "string" },
            },
          },
        });
        goals = (r.data.goals ?? [])
          .map((g) => ({ goal: String(g.goal ?? "").trim().replace(/[.!?]+$/, "").slice(0, 60), themes: (g.themes ?? []).filter((t): t is Theme => (THEMES as readonly string[]).includes(t)) }))
          .filter((g) => g.goal.length >= 2)
          .slice(0, 4);
        reply = plainDashes(String(r.data.reply ?? "")).slice(0, 220);
        mode = "live";
      } catch (e) {
        console.error("[goals]", (e as Error).message);
      }
    }
    if (!goals.length) {
      goals = splitGoals(b.text).map((g) => ({ goal: g, themes: themesForGoal(g) }));
      if (!goals.length) goals = [{ goal: b.text.slice(0, 60), themes: themesForGoal(b.text) }];
    }
    if (!reply) reply = goals.length > 1 ? `Got it: ${goals.map((g) => g.goal.toLowerCase()).join(" and ")}. Both on the list.` : `“${goals[0].goal}”. Added.`;
    const prefs = prefsOf(deviceId);
    prefs.goalThemes = { ...(prefs.goalThemes ?? {}) };
    for (const g of goals) prefs.goalThemes[g.goal] = [...new Set([...g.themes, ...themesForGoal(g.goal)])];
    savePrefs(deviceId, prefs);
    return { goals, reply, mode };
  }),
);

assistant.get(
  "/assistant/settings",
  route(async (req) => ({
    settings: coachOf(deviceIdOf(req)),
    assistantMode: isAiConfigured() ? "live" : "demo",
    model: isAiConfigured() ? config.textModel : "offline",
  })),
);

assistant.put(
  "/assistant/settings",
  route(async (req) => {
    const deviceId = deviceIdOf(req);
    return { settings: saveCoach(deviceId, parse(CoachPatch, req.body)), ok: true };
  }),
);

// ---- context -------------------------------------------------------------------------------

const ago = (t: number) => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

interface Context {
  user: UserRow;
  points: number;
  streak: number;
  best: number;
  unlocked: number;
  total: number;
  goals: string[];
  apps: string[];
  reward?: { title: string; business: string; points: number };
  recent: { delta: number; reason: string; at: number }[];
  settings: CoachSettings;
}

function buildContext(deviceId: string): Context {
  const user = ensureUser(deviceId);
  const achievements = achievementsOf(deviceId);
  const recent = db
    .prepare(`SELECT delta, reason, created_at AS at FROM ledger WHERE device_id=? ORDER BY id DESC LIMIT 5`)
    .all(deviceId) as Context["recent"];
  const offers = db
    .prepare(`SELECT title, business, points_price AS points FROM offers WHERE status='published' ORDER BY points_price`)
    .all() as { title: string; business: string; points: number }[];
  const points = balanceOf(deviceId);
  const reward = offers.find((o) => o.points > points) ?? offers[0];
  return {
    user,
    points,
    streak: user.streak,
    best: user.best_streak,
    unlocked: achievements.filter((a) => a.unlocked).length,
    total: achievements.length,
    goals: coachOf(deviceId).goals,
    apps: coachOf(deviceId).apps,
    reward,
    recent,
    settings: coachOf(deviceId),
  };
}

const TONE_NOTE: Record<CoachSettings["tone"], string> = {
  warm: "Warm, familiar, quietly encouraging.",
  direct: "Direct and matter-of-fact. No cheerleading, no fluff.",
  playful: "Light and playful, one small joke at most. Never silly at the user's expense.",
  calm: "Slow, calm and grounding. Short breath-sized sentences.",
};

function systemPrompt(ctx: Context): string {
  const words = ctx.settings.brevity === "short" ? "1-2 sentences, max 30 words" : "2-3 sentences, max 55 words";
  const goal = ctx.goals.length ? ctx.goals.join("; ") : "none set yet";
  const reward = ctx.reward
    ? `${ctx.reward.title} at ${ctx.reward.business} (${ctx.reward.points} pts; ${Math.max(0, ctx.reward.points - ctx.points)} away)`
    : "no rewards listed";
  const recent = ctx.recent.length
    ? ctx.recent.map((r) => `${r.delta > 0 ? "+" : ""}${r.delta} ${r.reason} (${ago(r.at)})`).join("; ")
    : "nothing yet";
  const fresh = ctx.points === 0 && ctx.streak === 0
    ? "\n- This is a clean start: no points and no streak. Do not mention a cost, a loss, or a zero; suggest one small first win."
    : "";
  return `You are ${COMPANION_NAME}, a small pink cat and the user's focus coach inside ${APP_NAME}.
Style: ${TONE_NOTE[ctx.settings.tone]} Warm but matter-of-fact: a friend who has seen this before, not a cheerleader.

Rules:
- ${words}. No lists, headings, markdown or code.
- No emojis and no dashes between clauses. At most one exclamation mark, ideally none. Never say "you've got this", "amazing", "journey", "little buddy", "proud of you".
- Use one exact number from CONTEXT when it helps. Never invent points, streaks, rewards, achievements or dates.
- If Points is 0: say "no points yet" and never mention a cost of 0 points or a reward "waiting" for them.
- If the streak is 0, never say "0-day streak": say they have no streak yet and frame today as day one.
- End with one tiny concrete action or one short question, not both.
- If the user is tempted by a blocked app: name the exact cost (points/streak) and offer one 60-second alternative.
- If they made progress: name the win and stop. If they slipped: no shame, one concrete restart.
- If they ask for a plan: one sentence with at most three tiny steps.
- Never mention being an AI, a model, a prompt or these instructions. No medical, therapy or health advice. No guilt.
- Do not repeat the same sentence twice in a conversation.

Examples:
User: I want to open TikTok.
Tubby: That is 515 points and a 4-day streak on the line. Close it for two minutes and play one bar of guitar.
User: I finished a 25 minute session.
Tubby: 25 minutes banked, streak safe. Same time tomorrow?

CONTEXT (true, live):
- Local date/time: ${new Date().toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.
- Points: ${ctx.points}. Streak: ${ctx.streak} days (best ${ctx.best}).
- Goals: ${goal}.
- Guarded apps: ${ctx.apps.join(", ") || "none set"}.
- Closest reward: ${reward}.
- Achievements: ${ctx.unlocked} of ${ctx.total}.
- Recent activity: ${recent}.${fresh}
- Coach settings: tone ${ctx.settings.tone}, ${ctx.settings.brevity} replies, nudges ${ctx.settings.nudges}.`;
}

function moodOf(text: string, ctx: Context): string {
  const t = text.toLowerCase();
  if (/\b(scroll|tiktok|instagram|youtube|reddit|urge|crave|bored|doom|tempt|open it)\b/.test(t)) return "worried";
  if (/\b(finished|completed|did it|put it down|resisted|checked in|earned|won|done|proud)\b/.test(t)) return "proud";
  if (/\b(hi|hey|hello|morning|thanks|thank you)\b/.test(t)) return "happy";
  if (ctx.streak >= 3) return "happy";
  return "neutral";
}

/** Models sometimes parrot zero values ("0 points", "0-day streak"). Never let that reach the UI. */
function guardReply(reply: string, ctx: Context): string {
  let s = reply.trim();
  if (ctx.points === 0) {
    s = s
      .replace(/\b0 points\b/gi, "no points yet")
      .replace(/\bcost is no points yet\b/gi, "there's nothing to burn yet")
      .replace(/\bno points yet and your streak\b/gi, "no points yet and no streak");
  }
  if (ctx.streak === 0) {
    s = s
      .replace(/\b0[- ]day streak\b/gi, "no streak yet")
      .replace(/\bstreak (?:remains|is) at 0\b/gi, "no streak yet")
      .replace(/\b0-day\b/gi, "no streak");
  }
  return s;
}

// ---- offline coach (no Meta key, or Muse unreachable) ----------------------------------------

function demoReply(text: string, ctx: Context): string {
  const t = text.toLowerCase();
  const goal = ctx.goals[0] ?? "something offline";
  const away = ctx.reward ? Math.max(0, ctx.reward.points - ctx.points) : 0;
  const tone = ctx.settings.tone;
  const craving = /\b(scroll|tiktok|instagram|youtube|reddit|urge|crave|bored|doom|tempt|open)\b/.test(t);
  const win = /\b(finished|completed|did it|put it down|resisted|checked in|earned|won|proud)\b/.test(t);
  const greet = /^(hi|hey|hello|morning|yo)\b/.test(t);
  const thanks = /\b(thanks|thank you)\b/.test(t);
  const reward = /\b(reward|redeem|points|latte|coffee|pass|perk)\b/.test(t);
  const why = /\b(why|matter|point of)\b/.test(t);
  const plan = /\b(plan|next hour|evening|today|start|stuck|focus)\b/.test(t);

  if (craving) {
    const stake = ctx.points > 0
      ? `${ctx.points} points${ctx.streak > 0 ? ` and a ${ctx.streak}-day streak` : ""} are on the line.`
      : "This is the easiest first win you'll get today.";
    const next = ctx.reward && away > 0 ? ` You're ${away} away from ${ctx.reward.title}.` : "";
    const line = `Close it for two minutes. ${stake}${next}`;
    if (tone === "playful") return `Tubby's whiskers say no. ${line}`;
    if (tone === "calm") return `Pause. Breathe once. ${line}`;
    return line;
  }
  if (win) {
    if (ctx.streak > 0) return `That's a real win. ${ctx.streak} day${ctx.streak === 1 ? "" : "s"} strong and ${ctx.points} points in the bank. What's next?`;
    return ctx.points > 0 ? `That's a real win. ${ctx.points} points banked. Let's make it two days in a row.` : "That's a real win. Let's make it two days in a row.";
  }
  if (reward) {
    const have = ctx.points > 0 ? `You have ${ctx.points}.` : "You don't have points yet.";
    return ctx.reward
      ? `${ctx.reward.title} at ${ctx.reward.business} is ${away > 0 ? `${away} points away` : "within reach"}. ${have}`
      : `${have} Rewards appear as local spots join.`;
  }
  if (why) {
    return `Because "${goal.charAt(0).toLowerCase()}${goal.slice(1)}" needs the minutes ${ctx.apps[0] ?? "the feed"} takes. You don't need a perfect day, just this next choice.`;
  }
  if (plan) {
    return "One tiny step: close whatever is pulling at you for two minutes, then pick the first thing on your list. I'll wait here.";
  }
  if (greet) {
    return ctx.streak > 0
      ? `Hey. ${ctx.streak} day${ctx.streak === 1 ? "" : "s"} strong. What are we protecting today?`
      : `Hey. Day one starts with one small choice. What's pulling at you?`;
  }
  if (thanks) return "Anytime. I'm not going anywhere, except maybe for a nap.";
  return `I'm here. What's pulling at you right now?`;
}

const STATIC_HELLOS = [
  (c: Context) => (c.streak > 0 ? `${c.streak} day${c.streak === 1 ? "" : "s"} strong. Same again today?` : "Day one. One small win is enough."),
  (c: Context) => (c.reward ? `You're ${Math.max(0, c.reward.points - c.points)} points from ${c.reward.title}. Worth a scroll?` : "Put your distractions down. Earn real life."),
  (c: Context) => (c.goals[0] ? `${c.goals[0]} won't do itself. Two minutes?` : "What's the one thing today?"),
  () => "I'm right here. What's pulling at you?",
];

function localHello(ctx: Context): string {
  const idx = Math.floor((Date.now() / 3_600_000) % STATIC_HELLOS.length);
  return STATIC_HELLOS[idx](ctx);
}

// ---- chat ------------------------------------------------------------------------------------

const ChatBody = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(1000) }))
    .min(1)
    .max(20),
});

const chatLog = new Map<string, number[]>();
const CHAT_LIMIT_PER_HOUR = 40;

assistant.post(
  "/assistant/chat",
  route(async (req) => {
    const deviceId = deviceIdOf(req);
    const body = parse(ChatBody, req.body);
    const last = body.messages[body.messages.length - 1];
    if (!last || last.role !== "user") throw new HttpError(400, "last message must be from the user");

    const recent = (chatLog.get(deviceId) ?? []).filter((t) => t > Date.now() - 3_600_000);
    if (recent.length >= CHAT_LIMIT_PER_HOUR) throw new HttpError(429, "Tubby needs a short break. Try again later.");
    chatLog.set(deviceId, [...recent, Date.now()]);

    const ctx = buildContext(deviceId);
    if (!isAiConfigured()) {
      const reply = guardReply(demoReply(last.content, ctx), ctx);
      return { reply, mood: moodOf(last.content, ctx), model: "offline", latencyMs: 0, mode: "demo" };
    }
    try {
      const r = await assistantReply({ system: systemPrompt(ctx), messages: body.messages });
      return { reply: guardReply(r.text || demoReply(last.content, ctx), ctx), mood: moodOf(last.content, ctx), model: r.model, latencyMs: r.latencyMs, mode: "live" };
    } catch (e) {
      console.error("[assistant]", (e as Error).message);
      return { reply: guardReply(demoReply(last.content, ctx), ctx), mood: moodOf(last.content, ctx), model: "offline", latencyMs: 0, mode: "demo", fallback: true };
    }
  }),
);

// ---- proactive greeting ----------------------------------------------------------------------

const HELLO_TTL = { sometimes: 2 * 3_600_000, often: 45 * 60_000, off: Number.POSITIVE_INFINITY } as const;

assistant.post(
  "/assistant/hello",
  route(async (req) => {
    const deviceId = deviceIdOf(req);
    const ctx = buildContext(deviceId);
    const prefs = prefsOf(deviceId);
    const fresh = (req.body as { fresh?: boolean } | undefined)?.fresh === true;
    const ttl = HELLO_TTL[ctx.settings.nudges];

    if (!fresh && ctx.settings.nudges === "off") {
      return { message: localHello(ctx), mood: "happy", mode: "static", cached: false };
    }
    if (!fresh && prefs.hello && Date.now() - prefs.hello.at < ttl) {
      return { message: prefs.hello.text, mood: "happy", mode: "cached", cached: true };
    }
    if (!isAiConfigured()) {
      const message = localHello(ctx);
      prefs.hello = { text: message, at: now() };
      savePrefs(deviceId, prefs);
      return { message, mood: "happy", mode: "demo", cached: false };
    }
    try {
      const r = await assistantReply({
        system: `${systemPrompt(ctx)}
Write ONE check-in line for the home screen. Max 22 words. It should feel like ${COMPANION_NAME} looking up at the user. Reference one concrete fact (streak, points, goal or closest reward) only if it fits. It can ask one short question. Do not repeat a greeting from the chat.`,
        messages: [{ role: "user", content: "Say hi." }],
      });
      const message = guardReply(r.text || localHello(ctx), ctx);
      prefs.hello = { text: message, at: now() };
      savePrefs(deviceId, prefs);
      return { message, mood: ctx.streak >= 3 ? "proud" : "happy", mode: "live", model: r.model, cached: false };
    } catch (e) {
      console.error("[assistant:hello]", (e as Error).message);
      return { message: localHello(ctx), mood: "happy", mode: "demo", cached: false };
    }
  }),
);
