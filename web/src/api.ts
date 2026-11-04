import brand from "../../brand.json";
import { androidDeviceId, androidSession, shellKind } from "./lib/native";

export const APP_NAME = brand.name;
export const TAGLINE = brand.tagline;
export const COMPANION_NAME = brand.companionName;
/** Where the Windows and Android builds are published (GitHub Releases). */
export const DOWNLOADS_URL = (brand as { downloadsUrl?: string }).downloadsUrl ?? "";

const KEY = `${APP_NAME.toLowerCase()}.deviceId`;
export function deviceId(): string {
  // The Electron desktop shell injects the same device id the tray and block overlay use,
  // so points earned in the desktop guard show up in the React app.
  const injected = (globalThis as { tubbyDesktop?: { deviceId?: string } }).tubbyDesktop?.deviceId;
  if (injected) return injected;
  // The Android app owns its profile id and session too (its block screen books points against the same profile).
  const phone = androidDeviceId();
  if (phone) return phone;
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = `web-${crypto.randomUUID().slice(0, 12)}`;
    localStorage.setItem(KEY, id);
  }
  return id;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

const SESSION_KEY = `${APP_NAME.toLowerCase()}.session.v1`;

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = { "x-device-id": deviceId() };
  let token: string | null = null;
  try {
    token = shellKind() === "android" ? androidSession() : localStorage.getItem(SESSION_KEY);
  } catch {
    /* storage blocked */
  }
  if (token) headers.authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(`/api${path}`, { method: opts.method ?? (body ? "POST" : "GET"), headers, body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && json?.error === "sign_in_required" && !path.startsWith("/auth/") && shellKind() === "web") {
      // This profile belongs to an account and the session is gone: back to the sign-in screen.
      for (const k of [SESSION_KEY, KEY, `${APP_NAME.toLowerCase()}.onboarded.v1`, `${APP_NAME.toLowerCase()}.onboarded.v2`]) localStorage.removeItem(k);
      location.assign("/");
    }
    const msg = json?.issues?.[0]?.message ?? json?.error ?? `HTTP ${res.status}`;
    throw new ApiError(res.status, msg, json);
  }
  return json as T;
}

export interface Achievement {
  id: string;
  name: string;
  emoji: string;
  description: string;
  unlocked: boolean;
  progress: number;
  detail: string;
}
export interface Cosmetic { id: string; name: string; slot: Slot; price: number; emoji: string | null; imageUrl: string | null; generated: boolean; owned?: boolean }
/** Wearable cosmetic slots: fur color + one accessory. */
export type Slot = "color" | "accessory";
export interface Me {
  app: string;
  deviceId: string;
  balance: number;
  streak: number;
  bestStreak: number;
  /** The last calendar day (YYYY-MM-DD, the user's local date) a check-in counted. */
  lastStreakDay?: string | null;
  unlocksLeft?: number;
  dailyUnlockCap?: number;
  penaltyUntil?: number;
  difficulty?: Difficulty;
  emergencyPassesLeft?: number;
  achievements: Achievement[];
  ownedCosmetics: Cosmetic[];
  equipped: Partial<Record<Slot, string>>;
  redemptions: { id: string; code: string; status: string; points: number; at: number; title: string; business: string }[];
  recent: { delta: number; kind: string; reason: string; at: number }[];
}
export type Difficulty = "normal" | "hard";

export interface Offer {
  id: string; business: string; title: string; description: string; category: string;
  items: { name: string; price: number }[]; discountPercent: number; monthlyCap: number; pointsPrice: number;
  terms: string; imageUrl: string | null; source: string; redeemedThisMonth?: number;
  /** The person's goal this offer fits, when it fits one. */
  forGoal?: string | null;
}
export interface Draft {
  business: string; offerTitle: string; description: string; items: { name: string; price: number }[];
  regularPrice: number; suggestedDiscountPercent: number; monthlyCap: number; pointsPrice: number; terms: string;
  category: string; confidence: number; notes: string; flags: string[]; adjustments: string[];
}

// ---- coach (the chat model) ----

export type CoachTone = "warm" | "direct" | "playful" | "calm";
export type CoachBrevity = "short" | "balanced";
export type CoachNudges = "off" | "sometimes" | "often";

export interface CoachSettings {
  tone: CoachTone;
  brevity: CoachBrevity;
  nudges: CoachNudges;
  goals: string[];
  apps: string[];
}

export const COACH_DEFAULTS: CoachSettings = {
  tone: "warm",
  brevity: "short",
  nudges: "sometimes",
  goals: ["Spend less time scrolling"],
  apps: ["TikTok", "Instagram", "YouTube", "X"],
};

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  at: number;
}

export interface AssistantReply {
  reply: string;
  mood: "happy" | "proud" | "worried" | "neutral";
  model: string;
  latencyMs: number;
  mode: "live" | "demo";
  fallback?: boolean;
}

export interface Health {
  ok: boolean;
  app: string;
  tagline: string;
  metaConfigured: boolean;
  aiMode: "live" | "demo";
  assistantConfigured: boolean;
  assistantMode: "live" | "demo";
  assistantModel: string;
  googleSignIn?: boolean;
  /** The server's files were updated after it started: it needs a restart to run the new version. */
  stale?: boolean;
}

export interface JournalDay {
  date: string;
  earned: number;
  burned: number;
  putdowns: number;
  slips: number;
  focusMinutes: number;
}
export interface JournalTotals {
  earned: number;
  burned: number;
  putdowns: number;
  slips: number;
  focusMinutes: number;
  activeDays: number;
  sessions: number;
}
export interface Journal {
  days: JournalDay[];
  byHour: { hour: number; putdowns: number; slips: number }[];
  totals: JournalTotals;
  bestDay: JournalDay | null;
  peakHour: number | null;
}
export interface WeeklyReport {
  score: number;
  parts: { resist: number; focus: number; consistency: number; streak: number };
  lastScore: number | null;
  delta: number | null;
  week: JournalTotals & { from: string; to: string };
  lastWeek: JournalTotals | null;
  days: JournalDay[];
  focusTargetMinutes: number;
  note: string;
  noteMode: "live" | "offline";
}

export const fileToDataUrl = (f: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(f);
  });

export const timeAgo = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
