import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { APP_NAME, EARN_RULES, STREAK_BONUS_CAP, STREAK_BONUS_PER_DAY, config } from "../config.js";
import { db, now } from "../db.js";
import { generateImage } from "../meta.js";
import { achievementsOf, addEntry, balanceOf, ensureUser, spend } from "../ledger.js";
import { DeviceId, HttpError, deviceIdOf, newId, parse, route } from "../http.js";
import { burnLimit, buyLimit, earnLimit, unlockLimit } from "../rateLimit.js";
import { dayBuckets, localDay, type DayStats } from "../stats.js";
import { DEFAULT_COLOR } from "../seed.js";
import { createDemoProfile } from "../demoProfile.js";
import { rateLimit } from "../rateLimit.js";

export const points = Router();

const dayStr = (d: Date) => d.toISOString().slice(0, 10);
const demoGrantsAllowed = () => process.env.ALLOW_DEMO_GRANTS !== "false";
/**
 * Limits on how often a put-down is logged. Put-downs pay no points, but they unlock badges and feed the Focus Score,
 * so the same app can't be logged again within 10 minutes, and logs need a minute between them. Mirrored in android PointsRules.
 */
const RESIST = {
  windowMs: 10 * 60_000,
  gapMs: 60_000,
  maxAppsPerDay: 8,
  dailyCount: 10,
} as const;

/** Wearable slots: fur colors and one accessory. Older item rows (hats, generated art) stay in the DB but are hidden. */
const WEARABLE_SLOTS = ["color", "accessory"] as const;
type WearableSlot = (typeof WEARABLE_SLOTS)[number];
const SLOT_SQL = WEARABLE_SLOTS.map((s) => `'${s}'`).join(",");

function equippedItems(raw: string | null | undefined): Partial<Record<WearableSlot, string>> {
  let parsed: Record<string, string> = {};
  try {
    parsed = JSON.parse(raw || "{}") as Record<string, string>;
  } catch {
    parsed = {};
  }
  const out: Partial<Record<WearableSlot, string>> = {};
  for (const slot of WEARABLE_SLOTS) {
    const id = parsed[slot];
    if (id && !(slot === "color" && id === DEFAULT_COLOR)) out[slot] = id;
  }
  return out;
}

function ownsItem(deviceId: string, id: string, slot?: WearableSlot): boolean {
  const c = db.prepare(`SELECT price, slot FROM cosmetics WHERE id=?`).get(id) as { price: number; slot: WearableSlot } | undefined;
  if (!c || !WEARABLE_SLOTS.includes(c.slot)) return false;
  if (slot && c.slot !== slot) return false;
  return c.price === 0 || !!db.prepare(`SELECT 1 FROM owned_cosmetics WHERE device_id=? AND cosmetic_id=?`).get(deviceId, id);
}

type GuardPrefs = Record<string, unknown> & {
  unlocks?: Record<string, number>;
  penaltyUntil?: number;
  unlockDay?: string;
  unlockCount?: number;
  difficulty?: "normal" | "hard";
  hardSince?: number;
  passWeek?: string;
};

function prefsOf(deviceId: string): GuardPrefs {
  const u = ensureUser(deviceId);
  try {
    return JSON.parse(u.prefs || "{}") as GuardPrefs;
  } catch {
    return {};
  }
}

/**
 * Hard mode: every slip costs double, unlocks are scarcer, a slow-earn penalty lasts longer,
 * and ending a focus session early needs the weekly emergency pass. Focus sessions pay more to make it worth it.
 * The guards themselves stay escapable; hard mode only changes the points.
 */
const HARD = { burnMultiplier: 2, unlockCap: 3, penaltyMinutes: 60, focusReward: 30 } as const;
const isHard = (prefs: GuardPrefs) => prefs.difficulty === "hard";

/** Local ISO-style week key (Monday start), used for the one emergency pass per week. */
function weekKey(t: number): string {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return localDay(d.getTime());
}
const passesLeft = (prefs: GuardPrefs) => (prefs.passWeek === weekKey(now()) ? 0 : 1);

/** Cost of one slip: 25% of the balance (min 10, max 150), doubled in hard mode. Never more than the balance. */
function slipCost(balance: number, hard: boolean): number {
  if (balance <= 0) return 0;
  const base = Math.min(150, Math.max(10, Math.round(balance * 0.25)));
  return Math.min(balance, hard ? base * HARD.burnMultiplier : base);
}

/** Chat guard unlocks are capped per local day (the burn/penalty cost still applies to each one). */
const DAILY_UNLOCK_CAP = Number(process.env.DAILY_UNLOCK_CAP ?? 6);
const unlockCap = (prefs: GuardPrefs) => (isHard(prefs) ? Math.min(HARD.unlockCap, DAILY_UNLOCK_CAP) : DAILY_UNLOCK_CAP);
function unlocksLeftToday(prefs: GuardPrefs): number {
  const cap = unlockCap(prefs);
  return prefs.unlockDay === localDay(now()) ? Math.max(0, cap - Number(prefs.unlockCount || 0)) : cap;
}

function savePrefs(deviceId: string, prefs: Record<string, unknown>) {
  ensureUser(deviceId);
  db.prepare(`UPDATE users SET prefs=? WHERE device_id=?`).run(JSON.stringify(prefs), deviceId);
}

function me(deviceId: string) {
  const u = ensureUser(deviceId);
  const prefs = prefsOf(deviceId);
  const owned = db
    .prepare(
      `SELECT c.* FROM cosmetics c LEFT JOIN owned_cosmetics oc ON oc.cosmetic_id=c.id AND oc.device_id=?
       WHERE c.slot IN (${SLOT_SQL}) AND (c.price=0 OR oc.device_id IS NOT NULL) ORDER BY c.slot, c.price`,
    )
    .all(deviceId) as Record<string, unknown>[];
  const recent = db
    .prepare(`SELECT delta, kind, reason, created_at AS at FROM ledger WHERE device_id=? ORDER BY id DESC LIMIT 20`)
    .all(deviceId);
  const redemptions = db
    .prepare(`SELECT r.id, r.code, r.status, r.points, r.created_at AS at, o.title, o.business FROM redemptions r JOIN offers o ON o.id=r.offer_id WHERE r.device_id=? ORDER BY r.created_at DESC LIMIT 10`)
    .all(deviceId);
  return {
    app: APP_NAME,
    deviceId,
    balance: balanceOf(deviceId),
    streak: u.streak,
    bestStreak: u.best_streak,
    lastStreakDay: u.last_streak_day,
    penaltyUntil: Number(prefs.penaltyUntil || 0),
    unlocks: prefs.unlocks || {},
    unlocksLeft: unlocksLeftToday(prefs),
    dailyUnlockCap: unlockCap(prefs),
    difficulty: isHard(prefs) ? "hard" : "normal",
    emergencyPassesLeft: isHard(prefs) ? passesLeft(prefs) : 0,
    achievements: achievementsOf(deviceId),
    ownedCosmetics: owned.map(cosmeticOut),
    equipped: equippedItems(u.equipped),
    redemptions,
    recent,
  };
}

points.get("/me", route(async (req) => me(deviceIdOf(req))));

/** Read-only "Tubby's journal": the last N local days of the ledger, bucketed for the patterns view. */
points.get(
  "/journal",
  route(async (req) => {
    const deviceId = deviceIdOf(req);
    ensureUser(deviceId);
    const days = Math.min(31, Math.max(7, Math.trunc(Number(req.query.days) || 14)));
    const { days: dayList, byHour, totals } = dayBuckets(deviceId, days);
    const bestDay = dayList.reduce<DayStats | null>((best, d) => (d.earned > 0 && (!best || d.earned > best.earned) ? d : best), null);
    // The hour with the most temptations, whichever way they went.
    const peak = byHour.reduce((p, h) => (h.putdowns + h.slips > p.putdowns + p.slips ? h : p), byHour[0]);
    return { days: dayList, byHour, totals, bestDay, peakHour: peak.putdowns + peak.slips > 0 ? peak.hour : null };
  }),
);

const UnlockBody = z.object({
  deviceId: DeviceId,
  appName: z.string().trim().min(2).max(60),
});

/**
 * "Let me open Telegram" from the desktop guard/chat.
 * With points: burn a slip's cost (25%, min 10, max 150; doubled in hard mode) and unlock for 10 minutes.
 * With fewer than 10 points: allow it, but halve earn rates for 30 minutes (60 in hard mode).
 */
points.post(
  "/guard/unlock",
  unlockLimit(),
  route(async (req) => {
    const b = parse(UnlockBody, req.body);
    const balance = balanceOf(b.deviceId);
    const prefs = prefsOf(b.deviceId);
    const today = localDay(now());
    const hard = isHard(prefs);
    const cap = unlockCap(prefs);
    const usedToday = prefs.unlockDay === today ? Number(prefs.unlockCount || 0) : 0;
    if (usedToday >= cap) {
      throw new HttpError(429, `No unlocks left today, so ${b.appName} stays guarded. The cap resets at midnight.`, {
        unlocksLeft: 0,
        dailyCap: cap,
      });
    }
    prefs.unlockDay = today;
    prefs.unlockCount = usedToday + 1;
    const unlockUntil = now() + 10 * 60_000;
    const unlocks = { ...(prefs.unlocks || {}) };
    for (const [key, until] of Object.entries(unlocks)) if (Number(until) <= now()) delete unlocks[key];
    unlocks[b.appName.toLowerCase()] = unlockUntil;
    prefs.unlocks = unlocks;

    let burned = 0;
    let penaltyUntil = Number(prefs.penaltyUntil || 0);
    let reason: string;
    const penaltyMinutes = hard ? HARD.penaltyMinutes : 30;
    if (balance >= 10) {
      burned = slipCost(balance, hard);
      addEntry(b.deviceId, -burned, "burn", `Unlocked ${b.appName} for 10 min${hard ? " · hard mode" : ""}`, b.appName);
      reason = `Unlocked ${b.appName} for 10 minutes. -${burned} points.`;
    } else {
      penaltyUntil = now() + penaltyMinutes * 60_000;
      prefs.penaltyUntil = penaltyUntil;
      reason = `No points to burn. ${b.appName} is open for 10 minutes, but earning is 50% slower for ${penaltyMinutes} minutes.`;
    }
    savePrefs(b.deviceId, prefs);
    return {
      allowed: true,
      unlockedUntil: unlockUntil,
      burned,
      penaltyMinutes: burned > 0 ? 0 : penaltyMinutes,
      reason,
      ...me(b.deviceId),
    };
  }),
);

const EarnBody = z.object({
  deviceId: DeviceId,
  event: z.enum(["focus_session", "resisted_temptation", "streak_day", "demo_grant"]),
  appName: z.string().max(60).optional(),
  /** Client's local date for a check-in. Only today, yesterday or the day before (queued offline) is accepted. */
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Minutes from Date.getTimezoneOffset(), so a check-in counts on the user's calendar day, not the server's. */
  tzOffset: z.number().int().min(-840).max(720).optional(),
  amount: z.number().int().min(1).max(5000).optional(),
  /** Completed focus-session length. Required for focus_session so a single click can't farm points. */
  minutes: z.number().int().min(5).max(180).optional(),
});

points.post(
  "/points/earn",
  earnLimit(),
  route(async (req) => {
    const b = parse(EarnBody, req.body);
    const u = ensureUser(b.deviceId);
    const prefs = prefsOf(b.deviceId);
    const penaltyUntil = Number(prefs.penaltyUntil || 0);
    const penaltyActive = penaltyUntil > now();
    let amount = 0;
    let reason = "";
    if (b.event === "streak_day") {
      const userToday = b.tzOffset !== undefined ? dayStr(new Date(now() - b.tzOffset * 60_000)) : dayStr(new Date());
      const today = b.day ?? userToday;
      // A client-supplied day can't run ahead of any real time zone or reach back past an offline gap,
      // and never goes backwards; otherwise a script could mint a streak by counting up the calendar.
      const utcToday = Date.parse(`${dayStr(new Date())}T00:00:00Z`);
      const asked = Date.parse(`${today}T00:00:00Z`);
      if (asked > utcToday + 86_400_000 || asked < utcToday - 2 * 86_400_000 || (u.last_streak_day && today < u.last_streak_day))
        throw new HttpError(409, "That day can't be checked in anymore", { streak: u.streak });
      if (u.last_streak_day === today) throw new HttpError(409, "Already checked in today. Come back tomorrow.", { streak: u.streak });
      const yesterday = dayStr(new Date(new Date(`${today}T12:00:00Z`).getTime() - 86_400_000));
      const streak = u.last_streak_day === yesterday ? u.streak + 1 : 1;
      db.prepare(`UPDATE users SET streak=?, best_streak=MAX(best_streak, ?), last_streak_day=? WHERE device_id=?`).run(streak, streak, today, b.deviceId);
      amount = EARN_RULES.streak_day + Math.min(STREAK_BONUS_PER_DAY * streak, STREAK_BONUS_CAP);
      reason = `Day ${streak} streak`;
    } else if (b.event === "demo_grant") {
      if (!demoGrantsAllowed()) throw new HttpError(403, "Demo points are off on this server");
      amount = b.amount ?? 500;
      reason = "Demo points grant";
    } else if (b.event === "focus_session") {
      if (!b.minutes) throw new HttpError(400, "minutes is required for a focus session");
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const sessionsToday = (db
        .prepare(`SELECT COUNT(*) c FROM ledger WHERE device_id=? AND kind='earn:focus_session' AND created_at>=?`)
        .get(b.deviceId, dayStart.getTime()) as { c: number }).c;
      if (sessionsToday >= 8) throw new HttpError(429, "That's 8 focus sessions today, the daily max. Rest up.");
      // The hard-mode rate only applies if hard mode was on for the whole session.
      const hardAllSession = isHard(prefs) && Number(prefs.hardSince || 0) <= now() - b.minutes * 60_000;
      amount = hardAllSession ? HARD.focusReward : EARN_RULES.focus_session;
      reason = `${b.minutes}-minute focus session`;
    } else if (b.event === "resisted_temptation") {
      const appName = b.appName?.trim();
      if (!appName) throw new HttpError(400, "appName is required for a put-down");
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const today = db
        .prepare(`SELECT COUNT(*) c FROM ledger WHERE device_id=? AND kind='earn:resisted_temptation' AND created_at>=?`)
        .get(b.deviceId, dayStart.getTime()) as { c: number };
      const lastApp = (db
        .prepare(`SELECT MAX(created_at) t FROM ledger WHERE device_id=? AND kind='earn:resisted_temptation' AND ref=?`)
        .get(b.deviceId, appName) as { t: number | null }).t;
      const lastAny = (db
        .prepare(`SELECT MAX(created_at) t FROM ledger WHERE device_id=? AND kind='earn:resisted_temptation'`)
        .get(b.deviceId) as { t: number | null }).t;
      const distinct = (db
        .prepare(`SELECT COUNT(DISTINCT ref) c FROM ledger WHERE device_id=? AND kind='earn:resisted_temptation' AND created_at>=?`)
        .get(b.deviceId, dayStart.getTime()) as { c: number }).c;
      const seenApp = (db
        .prepare(`SELECT 1 x FROM ledger WHERE device_id=? AND kind='earn:resisted_temptation' AND ref=? AND created_at>=? LIMIT 1`)
        .get(b.deviceId, appName, dayStart.getTime()) as { x: number } | undefined) != null;

      const skip = (why: string) => ({ earned: 0, counted: false, reason: why, ...me(b.deviceId) });
      if (today.c >= RESIST.dailyCount) return skip("Daily put-down log is full");
      if (lastApp != null && now() - lastApp < RESIST.windowMs) return skip("That app already counted recently");
      if (lastAny != null && now() - lastAny < RESIST.gapMs) return skip("Wait a minute between put-downs");
      if (!seenApp && distinct >= RESIST.maxAppsPerDay) return skip("Daily variety limit reached");
      reason = `Put down ${appName}`;
      addEntry(b.deviceId, EARN_RULES.resisted_temptation, "earn:resisted_temptation", reason, appName);
      return { earned: 0, counted: true, reason, ...me(b.deviceId) };
    } else {
      throw new HttpError(400, "unknown earn event");
    }
    // The slow-earn penalty halves every real earning (not demo grants).
    if (penaltyActive && b.event !== "demo_grant" && amount > 0) {
      amount = Math.max(1, Math.floor(amount * 0.5));
      reason += " · slow-earn penalty";
    }
    addEntry(b.deviceId, amount, `earn:${b.event}`, reason);
    return { earned: amount, reason, ...me(b.deviceId) };
  }),
);

const BurnBody = z.object({
  deviceId: DeviceId,
  reason: z.string().trim().min(2).max(200),
  amount: z.number().int().min(1).max(100_000),
  appName: z.string().max(60).optional(),
  breaksStreak: z.boolean().default(false),
  /** The client already applied the hard-mode multiplier to `amount` (the Android app does, for its offline ledger). */
  difficultyApplied: z.boolean().default(false),
});

points.post(
  "/points/burn",
  burnLimit(),
  route(async (req) => {
    const b = parse(BurnBody, req.body);
    ensureUser(b.deviceId);
    const hard = isHard(prefsOf(b.deviceId));
    const multiplier = hard && !b.difficultyApplied ? HARD.burnMultiplier : 1;
    const burned = Math.min(b.amount * multiplier, balanceOf(b.deviceId));
    const reason = `${b.appName ? `${b.reason} (${b.appName})` : b.reason}${hard ? " · hard mode" : ""}`;
    if (burned > 0) addEntry(b.deviceId, -burned, "burn", reason);
    if (b.breaksStreak) db.prepare(`UPDATE users SET streak=0 WHERE device_id=?`).run(b.deviceId);
    return { burned, requested: b.amount, multiplier, ...me(b.deviceId) };
  }),
);

/** "Load demo profile": a new device id with two weeks of history. Off when demo grants are disabled. */
points.post(
  "/demo/profile",
  rateLimit({ name: "demo-profile", max: 20, windowMs: 3_600_000, byIp: true }),
  route(async (_req, res) => {
    if (!demoGrantsAllowed()) throw new HttpError(403, "Demo profiles are off on this server");
    res.status(201);
    return { deviceId: createDemoProfile() };
  }),
);

points.post(
  "/difficulty",
  route(async (req) => {
    const b = parse(z.object({ deviceId: DeviceId, level: z.enum(["normal", "hard"]) }), req.body);
    const prefs = prefsOf(b.deviceId);
    if (b.level === "hard" && !isHard(prefs)) prefs.hardSince = now();
    if (b.level === "normal") delete prefs.hardSince;
    prefs.difficulty = b.level;
    savePrefs(b.deviceId, prefs);
    return me(b.deviceId);
  }),
);

/**
 * Ending a focus session before the timer. Normal mode: free (no points for the session).
 * Hard mode: spends the weekly emergency pass, or without one costs a doubled slip and the streak.
 */
points.post(
  "/focus/quit",
  burnLimit(),
  route(async (req) => {
    const b = parse(z.object({ deviceId: DeviceId, minutes: z.number().int().min(1).max(180) }), req.body);
    const prefs = prefsOf(b.deviceId);
    if (!isHard(prefs)) return { cost: "none", burned: 0, usedPass: false, ...me(b.deviceId) };
    if (passesLeft(prefs) > 0) {
      prefs.passWeek = weekKey(now());
      savePrefs(b.deviceId, prefs);
      return { cost: "pass", burned: 0, usedPass: true, ...me(b.deviceId) };
    }
    const burned = slipCost(balanceOf(b.deviceId), true);
    if (burned > 0) addEntry(b.deviceId, -burned, "burn", `Quit a ${b.minutes}-minute focus session · hard mode`);
    db.prepare(`UPDATE users SET streak=0 WHERE device_id=?`).run(b.deviceId);
    return { cost: "burn", burned, usedPass: false, ...me(b.deviceId) };
  }),
);

function cosmeticOut(c: Record<string, unknown>) {
  return {
    id: c.id,
    name: c.name,
    slot: c.slot,
    price: c.price,
    emoji: c.emoji ?? null,
    imageUrl: c.image_url ?? null,
    generated: !!c.generated,
  };
}

points.get(
  "/store",
  route(async (req) => {
    const rows = db.prepare(`SELECT * FROM cosmetics WHERE slot IN (${SLOT_SQL}) AND generated=0 ORDER BY slot, price, name`).all() as Record<string, unknown>[];
    const dev = DeviceId.safeParse(req.header("x-device-id") ?? req.query.deviceId);
    const owned = new Set<string>();
    if (dev.success) {
      for (const r of db.prepare(`SELECT cosmetic_id FROM owned_cosmetics WHERE device_id=?`).all(dev.data) as { cosmetic_id: string }[])
        owned.add(r.cosmetic_id);
    }
    return { items: rows.map((r) => ({ ...cosmeticOut(r), owned: Number(r.price) === 0 || owned.has(String(r.id)) })) };
  }),
);

points.post(
  "/store/buy",
  buyLimit(),
  route(async (req) => {
    const b = parse(z.object({ deviceId: DeviceId, cosmeticId: z.string().min(1).max(80) }), req.body);
    ensureUser(b.deviceId);
    const c = db.prepare(`SELECT * FROM cosmetics WHERE id=?`).get(b.cosmeticId) as Record<string, any> | undefined;
    if (!c || !WEARABLE_SLOTS.includes(c.slot) || c.generated) throw new HttpError(404, "That item isn't available");
    if (ownsItem(b.deviceId, c.id)) throw new HttpError(409, "You already have that");
    db.transaction(() => {
      spend(b.deviceId, c.price, "store", `Bought ${c.name}`, c.id);
      db.prepare(`INSERT INTO owned_cosmetics (device_id, cosmetic_id, acquired_at) VALUES (?,?,?)`).run(b.deviceId, c.id, now());
    })();
    return { bought: cosmeticOut(c), ...me(b.deviceId) };
  }),
);

points.post(
  "/store/equip",
  route(async (req) => {
    const b = parse(
      z.object({
        deviceId: DeviceId,
        slot: z.enum(WEARABLE_SLOTS).default("color"),
        cosmeticId: z.string().max(80).nullable(),
      }),
      req.body,
    );
    const u = ensureUser(b.deviceId);
    if (b.cosmeticId && !ownsItem(b.deviceId, b.cosmeticId, b.slot)) throw new HttpError(403, "You don't have that yet");
    const eq = equippedItems(u.equipped);
    if (b.cosmeticId && !(b.slot === "color" && b.cosmeticId === DEFAULT_COLOR)) eq[b.slot] = b.cosmeticId;
    else delete eq[b.slot];
    db.prepare(`UPDATE users SET equipped=? WHERE device_id=?`).run(JSON.stringify(eq), b.deviceId);
    return me(b.deviceId);
  }),
);

// Keep image spend low: simple per-device hourly limit.
const genLog = new Map<string, number[]>();
const GEN_LIMIT_PER_HOUR = Number(process.env.COSMETIC_GEN_LIMIT ?? 10);

points.post(
  "/cosmetic/generate",
  route(async (req, res) => {
    const b = parse(
      z.object({
        deviceId: DeviceId.optional(),
        prompt: z.string().trim().min(3).max(300),
        slot: z.enum(["hat", "eyes", "aura", "held"]).default("hat"),
        name: z.string().trim().min(2).max(40).optional(),
        price: z.number().int().min(50).max(5000).default(300),
      }),
      req.body,
    );
    const key = b.deviceId ?? req.ip ?? "anon";
    const recent = (genLog.get(key) ?? []).filter((t) => t > Date.now() - 3_600_000);
    if (recent.length >= GEN_LIMIT_PER_HOUR) throw new HttpError(429, "Try again in a little while");
    genLog.set(key, [...recent, Date.now()]);

    const prompt = `A single collectible cosmetic item (${b.slot}) for a cute round flame-shaped mascot: ${b.prompt}.
Flat vector sticker style, bold clean outlines, warm palette, centered on a plain white background, no text, no characters.`;
    const img = await generateImage(prompt, "1024x1024");
    const id = newId("cos");
    const file = `${id}.png`;
    fs.writeFileSync(path.join(config.mediaDir, "cosmetics", file), Buffer.from(img.b64, "base64"));
    const url = `/media/cosmetics/${file}`;
    const name = b.name ?? b.prompt.split(/\s+/).slice(0, 3).join(" ").replace(/^./, (c) => c.toUpperCase());
    db.prepare(`INSERT INTO cosmetics (id,name,slot,price,image_url,generated,prompt,created_by,created_at) VALUES (?,?,?,?,?,1,?,?,?)`).run(
      id, name, b.slot, b.price, url, b.prompt, b.deviceId ?? null, now(),
    );
    res.status(201);
    return { cosmetic: { id, name, slot: b.slot, price: b.price, imageUrl: url, generated: true }, url, latencyMs: img.latencyMs };
  }),
);
