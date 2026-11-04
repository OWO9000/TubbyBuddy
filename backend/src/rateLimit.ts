import type { NextFunction, Request, RequestHandler, Response } from "express";
import { DeviceId } from "./http.js";

/**
 * Small in-process fixed-window rate limiter (no external dependency).
 * Keyed by device id when the client sends one, otherwise by IP.
 * State is per server process, good enough for the single-node MVP; move to
 * Redis/Upstash if the backend ever runs more than one replica.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

/** Drop expired buckets once a minute so the map cannot grow without bound. */
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, b] of buckets) if (b.resetAt <= now) buckets.delete(key);
}

/** Best-effort caller identity: anonymous device id if valid, else client IP. */
export function callerKey(req: Request): string {
  const raw =
    req.header("x-device-id") ??
    (req.body as Record<string, unknown> | undefined)?.deviceId ??
    req.query.deviceId;
  const parsed = DeviceId.safeParse(raw);
  if (parsed.success) return `dev:${parsed.data}`;
  return `ip:${req.ip ?? "unknown"}`;
}

export interface RateLimitOptions {
  /** Bucket namespace, e.g. "writes" or "earn". */
  name: string;
  /** Max requests per window per caller. */
  max: number;
  /** Window length in ms. */
  windowMs: number;
  /** Only count requests matching this predicate (e.g. writes only). */
  when?: (req: Request) => boolean;
  /** Key on the client IP even when a device id is sent (device ids are free to rotate). */
  byIp?: boolean;
}

/** Test hook: clear all buckets. Not used by the app itself. */
export function resetRateLimits() {
  buckets.clear();
}

export function rateLimit(opts: RateLimitOptions): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (rateLimitsDisabled()) return next();
    if (opts.when && !opts.when(req)) return next();
    const now = Date.now();
    sweep(now);
    const key = `${opts.name}:${opts.byIp ? `ip:${req.ip ?? "unknown"}` : callerKey(req)}`;
    const b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
      return next();
    }
    if (b.count < opts.max) {
      b.count += 1;
      return next();
    }
    const retryAfterSec = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
    res.set("Retry-After", String(retryAfterSec));
    res.status(429).json({ error: "rate_limited", retryAfterSec });
  };
}

/** RATE_LIMITS=off disables every limiter (load tests, local debugging). */
export function rateLimitsDisabled(): boolean {
  return process.env.RATE_LIMITS === "off";
}

const hour = 3_600_000;
const num = (env: string | undefined, fallback: number) => {
  const n = Number(env);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** Configured limits. Env overrides exist so hosts can tune without a redeploy of code. */
export const RATE_LIMITS = {
  /** Any mutating /api call from one device/IP. Generous: real clients write rarely. */
  writesPerHour: num(process.env.RATE_LIMIT_WRITES_PER_HOUR, 600),
  /** Points-economy writes. Anti-farm rules still apply on top. */
  earnPerHour: num(process.env.RATE_LIMIT_EARN_PER_HOUR, 240),
  burnPerHour: num(process.env.RATE_LIMIT_BURN_PER_HOUR, 240),
  /** Chat-driven guard unlocks. */
  unlockPerHour: num(process.env.RATE_LIMIT_UNLOCK_PER_HOUR, 30),
  /** Reward redemptions. */
  redeemPerHour: num(process.env.RATE_LIMIT_REDEEM_PER_HOUR, 30),
  /** Store purchases. */
  buyPerHour: num(process.env.RATE_LIMIT_BUY_PER_HOUR, 60),
  /** Anything that calls a Meta model, per client IP. */
  aiPerHour: num(process.env.RATE_LIMIT_AI_PER_HOUR, 120),
} as const;

export const writeLimit = () =>
  rateLimit({
    name: "writes",
    max: RATE_LIMITS.writesPerHour,
    windowMs: hour,
    when: (req) => !["GET", "HEAD", "OPTIONS"].includes(req.method),
  });

export const earnLimit = () => rateLimit({ name: "earn", max: RATE_LIMITS.earnPerHour, windowMs: hour });
export const burnLimit = () => rateLimit({ name: "burn", max: RATE_LIMITS.burnPerHour, windowMs: hour });
export const unlockLimit = () => rateLimit({ name: "unlock", max: RATE_LIMITS.unlockPerHour, windowMs: hour });
export const redeemLimit = () => rateLimit({ name: "redeem", max: RATE_LIMITS.redeemPerHour, windowMs: hour });
export const buyLimit = () => rateLimit({ name: "buy", max: RATE_LIMITS.buyPerHour, windowMs: hour });
export const aiLimit = () => rateLimit({ name: "ai", max: RATE_LIMITS.aiPerHour, windowMs: hour, byIp: true });
