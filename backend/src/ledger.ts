import { db, now } from "./db.js";
import { HttpError } from "./http.js";

export function ensureUser(deviceId: string) {
  db.prepare(`INSERT OR IGNORE INTO users (device_id, created_at) VALUES (?, ?)`).run(deviceId, now());
  return db.prepare(`SELECT * FROM users WHERE device_id = ?`).get(deviceId) as UserRow;
}

export interface UserRow {
  device_id: string;
  created_at: number;
  streak: number;
  best_streak: number;
  last_streak_day: string | null;
  equipped: string;
  prefs: string;
}

export function balanceOf(deviceId: string): number {
  const r = db.prepare(`SELECT COALESCE(SUM(delta),0) AS b FROM ledger WHERE device_id = ?`).get(deviceId) as { b: number };
  return r.b;
}

export function addEntry(deviceId: string, delta: number, kind: string, reason?: string, ref?: string) {
  db.prepare(`INSERT INTO ledger (device_id, delta, kind, reason, ref, created_at) VALUES (?,?,?,?,?,?)`).run(
    deviceId, delta, kind, reason ?? null, ref ?? null, now(),
  );
}

/** Spend points atomically; throws 402 if the balance is too low. */
export const spend = db.transaction((deviceId: string, amount: number, kind: string, reason: string, ref?: string) => {
  const bal = balanceOf(deviceId);
  if (bal < amount) throw new HttpError(402, "Not enough points yet", { balance: bal, needed: amount });
  addEntry(deviceId, -amount, kind, reason, ref);
  return bal - amount;
});

export interface Achievement {
  id: string;
  name: string;
  emoji: string;
  description: string;
  unlocked: boolean;
  /** 0..1 toward the goal, so the UI can draw a progress bar instead of a binary lock. */
  progress: number;
  detail: string;
}

export function achievementsOf(deviceId: string): Achievement[] {
  const u = ensureUser(deviceId);
  const count = (sql: string) => (db.prepare(sql).get(deviceId) as { c: number }).c;
  const resisted = count(`SELECT COUNT(*) c FROM ledger WHERE device_id=? AND kind='earn:resisted_temptation'`);
  const sessions = count(`SELECT COUNT(*) c FROM ledger WHERE device_id=? AND kind='earn:focus_session'`);
  const earned = (db.prepare(`SELECT COALESCE(SUM(delta),0) c FROM ledger WHERE device_id=? AND delta>0`).get(deviceId) as { c: number }).c;
  const redeemed = count(`SELECT COUNT(*) c FROM redemptions WHERE device_id=?`);
  const verified = count(`SELECT COUNT(*) c FROM redemptions WHERE device_id=? AND status='verified'`);
  const cosmetics = count(`SELECT COUNT(*) c FROM owned_cosmetics WHERE device_id=?`);
  const def = (id: string, name: string, emoji: string, description: string, current: number, target: number): Achievement => ({
    id,
    name,
    emoji,
    description,
    unlocked: current >= target,
    progress: Math.max(0, Math.min(1, current / target)),
    detail: `${Math.min(current, target)} / ${target}`,
  });
  return [
    def("first-resist", "Put It Down", "🛑", "Resisted an app you meant to avoid", resisted, 1),
    def("resist-10", "Iron Thumb", "💪", "Resisted 10 times", resisted, 10),
    def("resist-50", "Unshakeable", "🗿", "Resisted 50 times", resisted, 50),
    def("first-session", "Deep Work", "🎯", "Finished a focus session", sessions, 1),
    def("session-10", "Focus Regular", "🧘", "Finished 10 focus sessions", sessions, 10),
    def("streak-3", "On a Roll", "🔥", "3-day streak", u.best_streak, 3),
    def("streak-7", "Week Warrior", "🏆", "7-day streak", u.best_streak, 7),
    def("earned-1000", "Point Hoarder", "💰", "Earned 1,000 points total", earned, 1000),
    def("first-redeem", "Real Life Unlocked", "🎟️", "Redeemed a real-world reward", redeemed, 1),
    def("proof", "Been There", "📸", "Verified a real visit with a photo", verified, 1),
    def("first-cosmetic", "Fresh Fur", "🎨", "Unlocked your first fur color", cosmetics, 1),
  ];
}
