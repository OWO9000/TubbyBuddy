import { Router } from "express";
import { COMPANION_NAME } from "../config.js";
import { db } from "../db.js";
import { ensureUser } from "../ledger.js";
import { assistantReply } from "../assistant.js";
import { isAiConfigured } from "../meta.js";
import { deviceIdOf, route } from "../http.js";
import { FOCUS_TARGET_MINUTES, dayBuckets, focusScore, type WeekTotals } from "../stats.js";

export const report = Router();

interface NoteCache {
  key: string;
  text: string;
  mode: "live" | "offline";
}

function offlineNote(score: number, t: WeekTotals, delta: number | null): string {
  if (t.putdowns + t.slips + t.focusMinutes === 0) return "A quiet week. One focus session tomorrow gets the score moving.";
  const trend = delta === null || delta === 0 ? "" : delta > 0 ? ` Up ${delta} from last week.` : ` Down ${-delta} from last week.`;
  if (t.slips > t.putdowns) return `More slips than put-downs this week.${trend} Pick the one app that gets you most and start there.`;
  if (score >= 70) return `Strong week: ${t.putdowns} put-downs and ${t.focusMinutes} focus minutes.${trend}`;
  return `${t.putdowns} put-downs and ${t.focusMinutes} focus minutes so far.${trend} One more session lifts the focus part.`;
}

/**
 * This week's Focus Score with its parts, last week's for comparison, and a short note from Tubby.
 * The note is written by Muse Spark once per score change and cached, so the page stays fast.
 */
report.get(
  "/report/weekly",
  route(async (req) => {
    const deviceId = deviceIdOf(req);
    const user = ensureUser(deviceId);
    const withNote = req.query.note !== "false";
    const thisWeek = dayBuckets(deviceId, 7);
    const lastWeek = dayBuckets(deviceId, 7, 7);
    const now = focusScore(thisWeek.totals, user.streak);
    const hasLastWeek = lastWeek.totals.earned + lastWeek.totals.burned > 0;
    // Same streak credit on both sides, so the delta reflects the week's behaviour rather than the streak.
    const prev = hasLastWeek ? focusScore(lastWeek.totals, user.streak) : null;
    const delta = prev ? now.score - prev.score : null;

    let prefs: Record<string, unknown> & { reportNote?: NoteCache } = {};
    try {
      prefs = JSON.parse(user.prefs || "{}");
    } catch {
      // Corrupt prefs: regenerate the note rather than fail the report.
    }
    const key = `${thisWeek.days[6].date}:${now.score}:${thisWeek.totals.slips}`;
    let note = prefs.reportNote?.key === key ? prefs.reportNote : null;
    if (!note && !withNote) note = { key, text: "", mode: "offline" };
    if (!note) {
      let text = offlineNote(now.score, thisWeek.totals, delta);
      let mode: NoteCache["mode"] = "offline";
      const quiet = thisWeek.totals.earned + thisWeek.totals.burned === 0;
      if (isAiConfigured() && !quiet) {
        try {
          const t = thisWeek.totals;
          const r = await assistantReply({
            system: `You are ${COMPANION_NAME}, a small pink cat who coaches focus. Write ONE sentence (max 26 words) to the user about their week, in your own voice ("I", "you"); never refer to yourself by name.
Name one real number from the data. If it went well, say so plainly; if not, give one concrete thing to try next week.
No emojis, no exclamation marks, no medical or therapy language, never mention being an AI.`,
            messages: [
              {
                role: "user",
                content: `Focus Score ${now.score}/100${delta !== null ? ` (${delta >= 0 ? "+" : ""}${delta} vs last week)` : ""}. Put-downs ${t.putdowns}, slips ${t.slips}, focus minutes ${t.focusMinutes} of ${FOCUS_TARGET_MINUTES}, active days ${t.activeDays}/7, points earned ${t.earned}, burned ${t.burned}, streak ${user.streak}.`,
              },
            ],
          });
          if (r.text) {
            text = r.text;
            mode = "live";
          }
        } catch (e) {
          console.error("[report]", (e as Error).message);
        }
      }
      note = { key, text, mode };
      prefs.reportNote = note;
      db.prepare(`UPDATE users SET prefs=? WHERE device_id=?`).run(JSON.stringify(prefs), deviceId);
    }

    return {
      score: now.score,
      parts: now.parts,
      lastScore: prev?.score ?? null,
      delta,
      week: { from: thisWeek.days[0].date, to: thisWeek.days[6].date, ...thisWeek.totals },
      lastWeek: hasLastWeek ? lastWeek.totals : null,
      days: thisWeek.days,
      focusTargetMinutes: FOCUS_TARGET_MINUTES,
      note: note.text,
      noteMode: note.mode,
    };
  }),
);
