import { db } from "./db.js";

export const localDay = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export interface DayStats {
  date: string;
  earned: number;
  burned: number;
  putdowns: number;
  slips: number;
  focusMinutes: number;
}

/** Giving in to a guarded app. Store purchases ("store") and rewards ("redeem") are spending, not slips. */
const SLIP_KINDS = new Set(["burn"]);

/**
 * Per-day buckets for the `days` local days ending today (index 0 = oldest), plus temptations by hour.
 * Calendar arithmetic, not +86400 s, so a DST change can't merge or drop a day.
 */
export function dayBuckets(deviceId: string, days: number, endOffsetDays = 0) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1) - endOffsetDays);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + days);
  const rows = db
    .prepare(`SELECT delta, kind, reason, created_at AS at FROM ledger WHERE device_id=? AND created_at>=? AND created_at<? ORDER BY created_at`)
    .all(deviceId, start.getTime(), end.getTime()) as { delta: number; kind: string; reason: string | null; at: number }[];

  const byDay = new Map<string, DayStats>();
  for (let i = 0; i < days; i++) {
    const date = localDay(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i).getTime());
    byDay.set(date, { date, earned: 0, burned: 0, putdowns: 0, slips: 0, focusMinutes: 0 });
  }
  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, putdowns: 0, slips: 0 }));
  let sessions = 0;
  for (const r of rows) {
    const bucket = byDay.get(localDay(r.at));
    if (!bucket) continue;
    if (r.delta > 0) bucket.earned += r.delta;
    if (r.delta < 0 && SLIP_KINDS.has(r.kind)) bucket.burned += -r.delta;
    if (r.kind === "earn:resisted_temptation") {
      bucket.putdowns += 1;
      byHour[new Date(r.at).getHours()].putdowns += 1;
    }
    if (SLIP_KINDS.has(r.kind)) {
      bucket.slips += 1;
      byHour[new Date(r.at).getHours()].slips += 1;
    }
    if (r.kind === "earn:focus_session") {
      sessions += 1;
      const m = r.reason?.match(/^(\d+)-minute/);
      bucket.focusMinutes += m ? Number(m[1]) : 0;
    }
  }
  const list = [...byDay.values()];
  const totals = list.reduce(
    (t, d) => ({
      earned: t.earned + d.earned,
      burned: t.burned + d.burned,
      putdowns: t.putdowns + d.putdowns,
      slips: t.slips + d.slips,
      focusMinutes: t.focusMinutes + d.focusMinutes,
      activeDays: t.activeDays + (d.earned > 0 ? 1 : 0),
      sessions,
    }),
    { earned: 0, burned: 0, putdowns: 0, slips: 0, focusMinutes: 0, activeDays: 0, sessions },
  );
  return { days: list, byHour, totals };
}

export type WeekTotals = ReturnType<typeof dayBuckets>["totals"];

/** Weekly focus target behind the "focus" part of the score: six 25-minute sessions. */
export const FOCUS_TARGET_MINUTES = 150;

/**
 * Focus Score, 0–100, for one week:
 *  40  resisting: share of temptations you put down (an active week with no temptations gets half credit)
 *  30  focus: focus minutes toward the weekly target
 *  20  consistency: days with any points earned, out of 7
 *  10  streak: current streak toward 7 days
 */
export function focusScore(t: WeekTotals, streak: number) {
  const temptations = t.putdowns + t.slips;
  const resist = temptations > 0 ? t.putdowns / temptations : t.activeDays > 0 ? 0.5 : 0;
  const parts = {
    resist: Math.round(40 * resist),
    focus: Math.round(30 * Math.min(1, t.focusMinutes / FOCUS_TARGET_MINUTES)),
    consistency: Math.round(20 * Math.min(1, t.activeDays / 7)),
    streak: Math.round(10 * Math.min(1, streak / 7)),
  };
  return { score: parts.resist + parts.focus + parts.consistency + parts.streak, parts };
}
