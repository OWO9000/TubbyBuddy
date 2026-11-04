// Offline tests (no network): offer guard rails + nudge templating + ledger rules via HTTP.
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "burn-unit-"));
process.env.DATA_DIR = tmp;
process.env.MEDIA_DIR = path.join(tmp, "media");

const { sanitizeOffer } = await import("../src/offerSanity.js");
const { fillTemplate } = await import("../src/routes/nudges.js");
const { localNudge, localNudgeBatch, localOffer, localScout } = await import("../src/demo.js");
const { BUSINESSES } = await import("../src/data/directory.js");
const { createApp } = await import("../src/app.js");

const base = {
  business: "Test Cafe", offerTitle: "Latte deal", description: "d", items: [{ name: "Latte", price: 5 }],
  regularPrice: 5, suggestedDiscountPercent: 30, monthlyCap: 50, pointsPrice: 150, terms: "t", category: "food", confidence: 0.9, notes: "",
};

test("sanitizeOffer clamps discount, cap and flags low confidence", () => {
  const o = sanitizeOffer({ ...base, suggestedDiscountPercent: 95, monthlyCap: 100000, confidence: 0.2, category: "spaceship" });
  assert.equal(o.suggestedDiscountPercent, 50);
  assert.equal(o.monthlyCap, 300);
  assert.equal(o.category, "other");
  assert.ok(o.flags.includes("low_confidence_review_carefully"));
  assert.ok(o.adjustments.length >= 3);
});

test("sanitizeOffer re-derives an absurd points price from the regular price", () => {
  const o = sanitizeOffer({ ...base, regularPrice: 28, suggestedDiscountPercent: 25, pointsPrice: 5 });
  assert.equal(o.pointsPrice, 700);
});

test("sanitizeOffer keeps a sane draft untouched", () => {
  const o = sanitizeOffer(base);
  assert.deepEqual(o.adjustments, []);
  assert.deepEqual(o.flags, []);
});

test("fillTemplate substitutes placeholders", () => {
  assert.equal(fillTemplate("{app} burns {points} pts, {streak}d", { app: "TikTok", points: 40, streak: 3 }), "TikTok burns 40 pts, 3d");
});

// ---- offline demo coach (what runs when META_MODEL_API_KEY is absent) ----

test("demo coach: nudge is short, names the app, and can honor a tone", () => {
  const ctx = { goals: ["play guitar 30 minutes a day"], appName: "TikTok", pointsAtRisk: 40, streak: 4 };
  const n = localNudge(ctx);
  assert.ok(n.nudge.length > 0 && n.nudge.length <= 140, n.nudge);
  assert.ok(n.nudge.includes("TikTok") || n.nudge.toLowerCase().includes("streak"));
  assert.ok(["playful", "tough-love", "calm", "hype", "witty"].includes(n.tone));
  const calm = localNudge({ ...ctx, tone: "calm" });
  assert.equal(calm.tone, "calm");
});

test("demo coach: batch keeps the display-time placeholders", () => {
  const batch = localNudgeBatch(6, { goals: ["read more"], appName: "Instagram", pointsAtRisk: 40, streak: 0 });
  assert.equal(batch.length, 6);
  assert.ok(batch.some((n) => n.text.includes("{points}") || n.text.includes("{app}")));
  assert.ok(batch.every((n) => n.text.length > 10));
});

test("demo coach: sample menu is transcribed and passes the guard rails", () => {
  const offer = sanitizeOffer(localOffer({ sampleMenu: true }));
  assert.equal(offer.business, "Ember & Oak Café");
  assert.ok(offer.items.length >= 8);
  assert.equal(offer.adjustments.length, 0);
  assert.equal(offer.flags.length, 0);
  assert.equal(offer.pointsPrice, 240);
});

test("demo coach: scout runs tool steps and drafts outreach without sending", () => {
  const run = localScout({ city: "San Francisco", category: "any", topN: 3 }, BUSINESSES);
  assert.equal(run.complete, true);
  assert.equal(run.outreachSent, false);
  assert.equal(run.drafts.length, 3);
  assert.ok(run.drafts.every((d) => d.status === "draft_not_sent" && d.to.includes("@example.com")));
  assert.ok(run.ranked.length >= 3);
  assert.ok(run.ranked[0].score >= run.ranked[1].score);
  assert.ok(run.steps.some((s) => s.tool === "search_businesses"));
  assert.ok(run.steps.some((s) => s.tool === "score_candidates"));
});

test("ledger: earn, burn floor at zero, store, redeem, consent required", async () => {
  const server = createApp().listen(0);
  const port = (server.address() as { port: number }).port;
  const call = async (p: string, body?: unknown, dev = "unit-dev-1") => {
    const r = await fetch(`http://localhost:${port}/api${p}`, {
      method: body ? "POST" : "GET",
      headers: { "content-type": "application/json", "x-device-id": dev },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, json: (await r.json()) as any };
  };
  try {
    // A put-down is logged (badges, Focus Score) but pays nothing: points come from finished timers.
    let r = await call("/points/earn", { deviceId: "unit-dev-1", event: "resisted_temptation", appName: "TikTok" });
    assert.equal(r.json.earned, 0);
    assert.equal(r.json.counted, true);
    assert.equal(r.json.balance, 0);
    assert.equal(r.json.achievements.find((a: { id: string }) => a.id === "first-resist").unlocked, true);
    // Logging limits: no repeat for the same app, and no rapid-fire across different apps.
    r = await call("/points/earn", { deviceId: "unit-dev-1", event: "resisted_temptation", appName: "TikTok" });
    assert.equal(r.json.counted, false);
    r = await call("/points/earn", { deviceId: "unit-dev-1", event: "resisted_temptation", appName: "Instagram" });
    assert.equal(r.json.counted, false);
    assert.equal((await call("/points/earn", { deviceId: "unit-dev-1", event: "resisted_temptation" })).status, 400);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    r = await call("/points/earn", { deviceId: "unit-dev-1", event: "streak_day", day: yesterday });
    assert.equal(r.json.streak, 1);
    r = await call("/points/earn", { deviceId: "unit-dev-1", event: "streak_day", day: today });
    assert.equal(r.json.streak, 2);
    assert.equal((await call("/points/earn", { deviceId: "unit-dev-1", event: "streak_day", day: today })).status, 409);
    // Focus sessions need a real length and pay once per completed session.
    assert.equal((await call("/points/earn", { deviceId: "unit-dev-1", event: "focus_session" })).status, 400);
    r = await call("/points/earn", { deviceId: "unit-dev-1", event: "focus_session", minutes: 25 });
    assert.equal(r.status, 200);
    assert.equal(r.json.earned, 20);
    assert.match(r.json.reason, /25-minute/i);
    r = await call("/points/burn", { deviceId: "unit-dev-1", reason: "Opened TikTok", amount: 99999 });
    assert.equal(r.json.balance, 0);
    assert.equal((await call("/store/buy", { deviceId: "unit-dev-1", cosmeticId: "color-gold" })).status, 402);
    // wardrobe = fur colors + accessories; Classic is free and always owned
    const store = await call("/store");
    assert.ok(store.json.items.length >= 12);
    assert.ok(store.json.items.some((c: any) => c.slot === "color"));
    assert.ok(store.json.items.some((c: any) => c.slot === "accessory"));
    assert.ok(store.json.items.find((c: any) => c.id === "color-classic").owned);
    assert.equal((await call("/store/buy", { deviceId: "unit-dev-1", cosmeticId: "hat-beanie" })).status, 404);
    assert.equal((await call("/store/equip", { deviceId: "unit-dev-1", cosmeticId: "color-mint" })).status, 403);
    assert.equal((await call("/store/equip", { deviceId: "unit-dev-1", slot: "accessory", cosmeticId: "acc-bow" })).status, 403);
    await call("/points/earn", { deviceId: "unit-dev-1", event: "demo_grant", amount: 1000 });
    r = await call("/store/buy", { deviceId: "unit-dev-1", cosmeticId: "color-mint" });
    assert.equal(r.status, 200);
    assert.equal((await call("/store/buy", { deviceId: "unit-dev-1", cosmeticId: "color-mint" })).status, 409);
    r = await call("/store/equip", { deviceId: "unit-dev-1", cosmeticId: "color-mint" });
    assert.deepEqual(r.json.equipped, { color: "color-mint" });
    r = await call("/store/buy", { deviceId: "unit-dev-1", cosmeticId: "acc-bow" });
    assert.equal(r.status, 200);
    r = await call("/store/equip", { deviceId: "unit-dev-1", slot: "accessory", cosmeticId: "acc-bow" });
    assert.deepEqual(r.json.equipped, { color: "color-mint", accessory: "acc-bow" });
    r = await call("/store/equip", { deviceId: "unit-dev-1", slot: "color", cosmeticId: "color-classic" });
    assert.deepEqual(r.json.equipped, { accessory: "acc-bow" });
    r = await call("/store/equip", { deviceId: "unit-dev-1", slot: "accessory", cosmeticId: null });
    assert.deepEqual(r.json.equipped, {});
    r = await call("/offers/demo-cafe/redeem", {});
    assert.equal(r.status, 201);
    assert.match(r.json.redemption.code, /^[A-Z]{1,4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    assert.ok(r.json.qrDataUrl.startsWith("data:image/png;base64,"));
    const v = await call("/merchant/redemptions/validate", { code: r.json.redemption.code });
    assert.equal(v.status, 200);
    assert.equal((await call("/merchant/redemptions/validate", { code: r.json.redemption.code })).status, 409);
    const pub = await call("/merchant/offers", { consent: false, consentName: "Owner", offer: { ...base, suggestedDiscountPercent: 20 } });
    assert.equal(pub.status, 400);
    const ok = await call("/merchant/offers", { consent: true, consentName: "Owner", offer: base });
    assert.equal(ok.status, 201);
    const me = await call("/me");
    assert.ok(me.json.achievements.find((a: any) => a.id === "first-redeem").unlocked);
    assert.ok(me.json.achievements.every((a: any) => typeof a.progress === "number" && a.detail.includes("/")));
  } finally {
    server.close();
  }
});

test("guard unlock: burns points, or applies a slow-earn penalty at zero", async () => {
  const server = createApp().listen(0);
  const port = (server.address() as { port: number }).port;
  const call = async (p: string, body?: unknown, dev = "unit-unlock-1") => {
    const r = await fetch(`http://localhost:${port}/api${p}`, {
      method: body ? "POST" : "GET",
      headers: { "content-type": "application/json", "x-device-id": dev },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, json: (await r.json()) as any };
  };
  try {
    let r = await call("/guard/unlock", { deviceId: "unit-unlock-1", appName: "Telegram" });
    assert.equal(r.status, 200);
    assert.equal(r.json.burned, 0);
    assert.equal(r.json.penaltyMinutes, 30);
    assert.ok(r.json.penaltyUntil > Date.now());
    // With an active penalty, a 20-point focus session is halved to 10.
    r = await call("/points/earn", { deviceId: "unit-unlock-1", event: "focus_session", minutes: 25 });
    assert.equal(r.json.earned, 10);
    assert.match(r.json.reason, /slow-earn/i);

    // With points, the unlock burns 25% (min 10, max 150) and does not add a penalty.
    const rich = "unit-unlock-rich";
    await call("/points/earn", { deviceId: rich, event: "demo_grant", amount: 100 }, rich);
    r = await call("/guard/unlock", { deviceId: rich, appName: "Telegram" }, rich);
    assert.equal(r.json.burned, 25);
    assert.equal(r.json.balance, 75);
    assert.equal(r.json.penaltyMinutes, 0);
  } finally {
    server.close();
  }
});

test("assistant: settings persist and the offline coach answers without a Meta key", async () => {
  const savedMeta = process.env.META_MODEL_API_KEY;
  delete process.env.META_MODEL_API_KEY;
  const server = createApp().listen(0);
  const port = (server.address() as { port: number }).port;
  const dev = "unit-coach-1";
  const call = async (p: string, body?: unknown, method = body ? "POST" : "GET") => {
    const r = await fetch(`http://localhost:${port}/api${p}`, {
      method,
      headers: { "content-type": "application/json", "x-device-id": dev },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, json: (await r.json()) as any };
  };
  try {
    let r = await call("/assistant/settings");
    assert.equal(r.status, 200);
    assert.equal(r.json.settings.tone, "warm");
    assert.ok(r.json.settings.goals.length >= 1);
    assert.equal(r.json.assistantMode, "demo");

    r = await call("/assistant/settings", { tone: "direct", brevity: "balanced", nudges: "often", goals: ["read more"], apps: ["TikTok"] }, "PUT");
    assert.equal(r.status, 200);
    assert.equal(r.json.settings.tone, "direct");
    r = await call("/assistant/settings");
    assert.deepEqual(r.json.settings.goals, ["read more"]);
    assert.equal((await call("/assistant/settings", { tone: "shouty" }, "PUT")).status, 400);

    r = await call("/assistant/chat", { messages: [{ role: "user", content: "I really want to open TikTok right now" }] });
    assert.equal(r.status, 200);
    assert.equal(r.json.mode, "demo");
    assert.equal(r.json.mood, "worried");
    assert.ok(r.json.reply.length > 10);
    assert.ok(!/0-day streak/.test(r.json.reply));
    // Regression: the zero-points rewrite used to produce "You're no points yet in and 250 away".
    assert.ok(!/no points yet (in|banked)/.test(r.json.reply), r.json.reply);
    for (const tone of ["playful", "calm", "warm"]) {
      await call("/assistant/settings", { tone }, "PUT");
      for (const msg of ["I want to scroll", "I resisted it!", "how many points until a reward?"]) {
        const t = await call("/assistant/chat", { messages: [{ role: "user", content: msg }] });
        assert.ok(!/no points yet (in|banked)|You have 0\b|\b0 points/.test(t.json.reply), `${tone}/${msg}: ${t.json.reply}`);
      }
    }

    r = await call("/assistant/hello", {});
    assert.equal(r.status, 200);
    assert.ok(r.json.message.length > 3);
  } finally {
    server.close();
    if (savedMeta) process.env.META_MODEL_API_KEY = savedMeta;
  }
});

test("journal: buckets put-downs, focus minutes and burns per day", async () => {
  const server = createApp().listen(0);
  const port = (server.address() as { port: number }).port;
  const dev = "unit-journal-1";
  const call = async (p: string, body?: unknown, method = body ? "POST" : "GET") => {
    const r = await fetch(`http://localhost:${port}/api${p}`, {
      method,
      headers: { "content-type": "application/json", "x-device-id": dev },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, json: (await r.json()) as any };
  };
  try {
    await call("/points/earn", { deviceId: dev, event: "resisted_temptation", appName: "TikTok" });
    await call("/points/earn", { deviceId: dev, event: "focus_session", minutes: 25 });
    await call("/points/burn", { deviceId: dev, reason: "Opened TikTok", amount: 10 });

    const r = await call("/journal?days=14");
    assert.equal(r.status, 200);
    assert.equal(r.json.days.length, 14);
    const today = r.json.days[r.json.days.length - 1];
    assert.equal(today.earned, 20, "put-downs pay nothing; the focus session pays 20");
    assert.equal(today.burned, 10);
    assert.equal(today.putdowns, 1);
    assert.equal(today.focusMinutes, 25);
    assert.equal(r.json.totals.sessions, 1);
    assert.equal(r.json.totals.putdowns, 1);
    assert.equal(r.json.byHour.reduce((n: number, h: { putdowns: number }) => n + h.putdowns, 0), 1);
    assert.ok(r.json.peakHour !== null);
    assert.equal(r.json.bestDay.earned, 20);

    // A fresh device gets an empty, well-formed journal.
    const fresh = await fetch(`http://localhost:${port}/api/journal?days=7`, { headers: { "x-device-id": "unit-journal-empty" } });
    const empty = { status: fresh.status, json: (await fresh.json()) as any };
    assert.equal(empty.status, 200);
    assert.equal(empty.json.days.length, 7);
    assert.equal(empty.json.totals.earned, 0);
    assert.equal(empty.json.peakHour, null);
  } finally {
    server.close();
  }
});

test("guard unlock: daily cap of 6, costs still apply, denial is clean", async () => {
  const server = createApp().listen(0);
  const port = (server.address() as { port: number }).port;
  const call = async (p: string, body?: unknown, dev = "unit-cap-1") => {
    const r = await fetch(`http://localhost:${port}/api${p}`, {
      method: body ? "POST" : "GET",
      headers: { "content-type": "application/json", "x-device-id": dev },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, json: (await r.json()) as any };
  };
  try {
    await call("/points/earn", { deviceId: "unit-cap-1", event: "demo_grant", amount: 500 });
    let prevBalance = 500;
    for (let i = 0; i < 6; i++) {
      const r = await call("/guard/unlock", { deviceId: "unit-cap-1", appName: "Telegram" });
      assert.equal(r.status, 200, `unlock ${i + 1} should pass`);
      assert.equal(r.json.allowed, true);
      assert.ok(r.json.burned > 0, "each unlock still burns points");
      assert.ok(r.json.balance < prevBalance, "balance drops each time");
      prevBalance = r.json.balance;
      assert.equal(r.json.unlocksLeft, 5 - i);
    }
    const denied = await call("/guard/unlock", { deviceId: "unit-cap-1", appName: "Telegram" });
    assert.equal(denied.status, 429);
    assert.match(denied.json.error, /No unlocks left today/);

    // At zero points the penalty path still works and counts against the cap.
    const poor = await call("/guard/unlock", { deviceId: "unit-cap-2", appName: "Telegram" });
    assert.equal(poor.json.allowed, true);
    assert.equal(poor.json.penaltyMinutes, 30);
    assert.equal(poor.json.unlocksLeft, 5);
  } finally {
    server.close();
  }
});
