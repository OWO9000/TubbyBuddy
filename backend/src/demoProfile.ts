import crypto from "node:crypto";
import { db, now } from "./db.js";
import { ensureUser } from "./ledger.js";

const DAY = 86_400_000;
const APPS = ["TikTok", "Instagram", "YouTube", "X"];

/** Small deterministic PRNG so every demo profile tells the same believable two-week story. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/**
 * A fresh device id with two weeks of history: daily put-downs, most days a focus session, three slips,
 * a four-day check-in streak and enough points for a reward. Used by "Load demo profile" so judges see a lived-in app.
 */
export function createDemoProfile(): string {
  const deviceId = `demo-${crypto.randomBytes(5).toString("hex")}`;
  const t = now();
  const rand = rng(7);
  ensureUser(deviceId);
  const add = db.prepare(`INSERT INTO ledger (device_id, delta, kind, reason, ref, created_at) VALUES (?,?,?,?,?,?)`);
  db.transaction(() => {
    add.run(deviceId, 500, "earn:demo_grant", "Demo points grant", null, t - 14 * DAY);
    for (let d = 13; d >= 1; d--) {
      const morning = new Date(t - d * DAY);
      morning.setHours(9, 0, 0, 0);
      const base = morning.getTime();
      const putdowns = 1 + Math.floor(rand() * 4);
      for (let i = 0; i < putdowns; i++) {
        const app = APPS[Math.floor(rand() * APPS.length)];
        add.run(deviceId, 0, "earn:resisted_temptation", `Put down ${app}`, app, base + (i * 2 + 1) * 3_600_000 + Math.floor(rand() * 1_800_000));
      }
      if (rand() < 0.75) {
        const minutes = [25, 25, 45, 15][Math.floor(rand() * 4)];
        add.run(deviceId, 20, "earn:focus_session", `${minutes}-minute focus session`, null, base + 5 * 3_600_000);
      }
      if (d === 11 || d === 6 || d === 3) {
        const app = APPS[d % APPS.length];
        add.run(deviceId, -[30, 45, 35][d % 3], "burn", `Opened ${app} anyway`, null, base + 13 * 3_600_000);
      }
      if (d <= 4) add.run(deviceId, 10 + Math.min(5 * (5 - d), 50), "earn:streak_day", `Day ${5 - d} streak`, null, base + 600_000);
    }
    const yesterday = new Date(t - DAY).toISOString().slice(0, 10);
    const prefs = {
      coach: {
        tone: "playful",
        brevity: "short",
        nudges: "sometimes",
        goals: ["Read more books", "Sleep before midnight"],
        apps: APPS,
      },
    };
    db.prepare(`UPDATE users SET streak=4, best_streak=6, last_streak_day=?, prefs=? WHERE device_id=?`).run(yesterday, JSON.stringify(prefs), deviceId);
  })();
  return deviceId;
}
