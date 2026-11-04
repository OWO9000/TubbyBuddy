// Hard mode, focus quit, check-in day rules, journal slips and the weekly Focus Score. Offline (no Meta key).
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import type { AddressInfo } from "node:net";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tubby-modes-"));
process.env.DATA_DIR = tmp;
process.env.MEDIA_DIR = path.join(tmp, "media");
process.env.RATE_LIMITS = "off";
delete process.env.META_MODEL_API_KEY;

const { createApp } = await import("../src/app.js");
const { db } = await import("../src/db.js");
const server = createApp().listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
test.after(() => server.close());

const call = async (p: string, dev: string, body?: unknown) => {
  const r = await fetch(`${base}${p}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", "x-device-id": dev },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, json: (await r.json()) as any };
};
const grant = (dev: string, amount: number) => call("/points/earn", dev, { deviceId: dev, event: "demo_grant", amount });
const dayOffset = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

test("normal mode: burns are as requested, quitting focus is free", async () => {
  const dev = "modes-normal";
  await grant(dev, 400);
  let r = await call("/points/burn", dev, { deviceId: dev, reason: "Continue anyway", amount: 100, breaksStreak: true });
  assert.equal(r.json.burned, 100);
  assert.equal(r.json.multiplier, 1);
  assert.equal(r.json.difficulty, "normal");
  r = await call("/focus/quit", dev, { deviceId: dev, minutes: 25 });
  assert.equal(r.json.cost, "none");
  assert.equal(r.json.balance, 300);
});

test("hard mode: double burns, 3 unlocks a day, 60-minute penalty, weekly pass then a burn", async () => {
  const dev = "modes-hard";
  await grant(dev, 400);
  let r = await call("/difficulty", dev, { deviceId: dev, level: "hard" });
  assert.equal(r.json.difficulty, "hard");
  assert.equal(r.json.emergencyPassesLeft, 1);
  assert.equal(r.json.dailyUnlockCap, 3);

  r = await call("/points/burn", dev, { deviceId: dev, reason: "Continue anyway", amount: 50, breaksStreak: true });
  assert.equal(r.json.burned, 100, "hard mode doubles the slip");
  assert.equal(r.json.balance, 300);
  r = await call("/points/burn", dev, { deviceId: dev, reason: "Continue anyway", amount: 20, breaksStreak: true, difficultyApplied: true });
  assert.equal(r.json.burned, 20, "a client that already doubled is not doubled again");
  await grant(dev, 20);

  r = await call("/guard/unlock", dev, { deviceId: dev, appName: "Telegram" });
  assert.equal(r.json.burned, 150, "25% of 300 is 75, doubled");
  for (let i = 0; i < 2; i++) assert.equal((await call("/guard/unlock", dev, { deviceId: dev, appName: "Telegram" })).status, 200);
  assert.equal((await call("/guard/unlock", dev, { deviceId: dev, appName: "Telegram" })).status, 429, "hard mode caps unlocks at 3");

  const poor = "modes-hard-poor";
  await call("/difficulty", poor, { deviceId: poor, level: "hard" });
  r = await call("/guard/unlock", poor, { deviceId: poor, appName: "Telegram" });
  assert.equal(r.json.penaltyMinutes, 60);

  r = await call("/focus/quit", dev, { deviceId: dev, minutes: 25 });
  assert.equal(r.json.cost, "pass");
  assert.equal(r.json.emergencyPassesLeft, 0);
  const before = r.json.balance;
  r = await call("/focus/quit", dev, { deviceId: dev, minutes: 25 });
  assert.equal(r.json.cost, "burn");
  assert.ok(r.json.burned > 0 && r.json.balance === before - r.json.burned);
  assert.equal(r.json.streak, 0);
});

test("hard mode pays 30 for a focus session only if it was on for the whole session", async () => {
  const dev = "modes-focus";
  await call("/difficulty", dev, { deviceId: dev, level: "hard" });
  let r = await call("/points/earn", dev, { deviceId: dev, event: "focus_session", minutes: 25 });
  assert.equal(r.json.earned, 20, "switched on mid-session: normal rate");
  const prefs = JSON.parse((db.prepare(`SELECT prefs FROM users WHERE device_id=?`).get(dev) as { prefs: string }).prefs);
  prefs.hardSince = Date.now() - 60 * 60_000;
  db.prepare(`UPDATE users SET prefs=? WHERE device_id=?`).run(JSON.stringify(prefs), dev);
  r = await call("/points/earn", dev, { deviceId: dev, event: "focus_session", minutes: 25 });
  assert.equal(r.json.earned, 30);
});

test("check-in: a client day can't run ahead of the calendar or go backwards", async () => {
  const dev = "modes-checkin";
  assert.equal((await call("/points/earn", dev, { deviceId: dev, event: "streak_day", day: dayOffset(5) })).status, 409);
  assert.equal((await call("/points/earn", dev, { deviceId: dev, event: "streak_day", day: dayOffset(-10) })).status, 409);
  let r = await call("/points/earn", dev, { deviceId: dev, event: "streak_day", day: dayOffset(-1) });
  assert.equal(r.status, 200);
  r = await call("/points/earn", dev, { deviceId: dev, event: "streak_day", day: dayOffset(0) });
  assert.equal(r.status, 200);
  assert.equal(r.json.streak, 2);
  assert.equal((await call("/points/earn", dev, { deviceId: dev, event: "streak_day", day: dayOffset(-1) })).status, 409, "no going back");
  // tzOffset picks the user's calendar day; the same local day can't be counted twice.
  const tz = "modes-tz";
  assert.equal((await call("/points/earn", tz, { deviceId: tz, event: "streak_day", tzOffset: 480 })).status, 200);
  assert.equal((await call("/points/earn", tz, { deviceId: tz, event: "streak_day", tzOffset: 480 })).status, 409);
});

test("journal counts slips separately from spending; weekly report scores the week", async () => {
  const dev = "modes-report";
  await grant(dev, 1000);
  await call("/points/earn", dev, { deviceId: dev, event: "resisted_temptation", appName: "TikTok" });
  await call("/points/earn", dev, { deviceId: dev, event: "focus_session", minutes: 25 });
  await call("/points/burn", dev, { deviceId: dev, reason: "Continue anyway", amount: 20, breaksStreak: true });
  await call("/store/buy", dev, { deviceId: dev, cosmeticId: "color-mint" });

  const j = await call("/journal?days=7", dev);
  const today = j.json.days[j.json.days.length - 1];
  assert.equal(today.slips, 1);
  assert.equal(today.burned, 20, "a store purchase is spending, not a slip");
  assert.ok(j.json.peakHour !== null);

  const r = await call("/report/weekly", dev);
  assert.equal(r.status, 200);
  assert.equal(r.json.parts.resist, 20, "1 put-down of 2 temptations = half of 40");
  assert.equal(r.json.parts.focus, 5, "25 of 150 minutes = 5 of 30");
  assert.equal(r.json.score, r.json.parts.resist + r.json.parts.focus + r.json.parts.consistency + r.json.parts.streak);
  assert.equal(r.json.days.length, 7);
  assert.equal(r.json.noteMode, "offline");
  assert.ok(r.json.note.length > 10);

  const empty = await call("/report/weekly", "modes-empty");
  assert.equal(empty.json.score, 0, "a week with no activity scores 0");
  assert.equal(empty.json.delta, null);
});

test("demo profile: a new device with two weeks of history and a live streak", async () => {
  const r = await fetch(`${base}/demo/profile`, { method: "POST" });
  assert.equal(r.status, 201);
  const { deviceId } = (await r.json()) as { deviceId: string };
  assert.match(deviceId, /^demo-[0-9a-f]{10}$/);
  const me = await call("/me", deviceId);
  assert.ok(me.json.balance >= 250, "enough for a reward");
  assert.equal(me.json.streak, 4);
  const journal = await call("/journal?days=14", deviceId);
  assert.ok(journal.json.totals.putdowns > 10);
  assert.ok(journal.json.totals.slips >= 2);
  const other = (await (await fetch(`${base}/demo/profile`, { method: "POST" })).json()) as { deviceId: string };
  assert.notEqual(other.deviceId, deviceId, "every visitor gets their own copy");
});
