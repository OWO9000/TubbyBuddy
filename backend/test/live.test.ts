// Live smoke tests against the real Meta Model API. Small and cheap (~8 Muse Spark calls + 1 Muse Image call, well under $0.05).
// Run: npm run test:live (needs META_MODEL_API_KEY). Set SKIP_IMAGE_GEN=1 to skip the image-generation call.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import type { Server } from "node:http";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "burn-live-"));
process.env.DATA_DIR = tmp;
process.env.MEDIA_DIR = path.join(tmp, "media");
const { createApp } = await import("../src/app.js");
const samples = path.resolve(import.meta.dirname, "../../web/public/samples");
const hasKey = !!process.env.META_MODEL_API_KEY;
const DEV = "live-test-dev";

let server: Server;
let base = "";
before(() => {
  server = createApp().listen(0);
  base = `http://localhost:${(server.address() as { port: number }).port}/api`;
});
after(() => server.close());

async function post(p: string, body: unknown, dev = DEV) {
  const t = Date.now();
  const r = await fetch(base + p, { method: "POST", headers: { "content-type": "application/json", "x-device-id": dev }, body: JSON.stringify(body) });
  const json = (await r.json()) as any;
  console.log(`  ${p} -> ${r.status} in ${Date.now() - t}ms`);
  return { status: r.status, json };
}
const b64 = (f: string) => `data:image/jpeg;base64,${fs.readFileSync(path.join(samples, f)).toString("base64")}`;

test("live: nudge", { skip: !hasKey }, async () => {
  const r = await post("/nudge", { goals: ["practice guitar"], appName: "TikTok", pointsAtRisk: 40, streak: 3 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.nudge.length > 10 && r.json.nudge.length <= 200);
});

test("live: nudge batch + cache pop", { skip: !hasKey }, async () => {
  const r = await post("/nudges/batch", { deviceId: DEV, goals: "read more", appName: "Instagram", pointsAtRisk: 30, streak: 2, count: 3 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.nudges.length, 3);
  const n = await fetch(`${base}/nudges/next?deviceId=${DEV}&appName=Instagram&points=55&streak=4`).then((x) => x.json() as any);
  assert.ok(!n.nudge.includes("{points}"));
  assert.equal(n.remaining, 2);
});

let draft: any;
test("live: merchant offer from menu photo", { skip: !hasKey }, async () => {
  const r = await post("/merchant/offer-from-photo", { imageBase64: b64("menu-ember-oak.jpg") });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  draft = r.json.draft;
  assert.match(draft.business, /Ember/);
  assert.ok(draft.items.length >= 5);
  assert.ok(draft.suggestedDiscountPercent >= 5 && draft.suggestedDiscountPercent <= 50);
});

test("live: publish -> redeem -> verify proof", { skip: !hasKey }, async () => {
  const offer = draft ?? { business: "X", offerTitle: "Latte", description: "", items: [], suggestedDiscountPercent: 20, monthlyCap: 10, pointsPrice: 100, terms: "", category: "food" };
  const pub = await post("/merchant/offers", { consent: true, consentName: "Live Test", offer });
  assert.equal(pub.status, 201);
  await post("/points/earn", { deviceId: DEV, event: "demo_grant", amount: 5000 });
  const red = await post(`/offers/${pub.json.offer.id}/redeem`, {});
  assert.equal(red.status, 201);
  const v = await post(`/redemptions/${red.json.redemption.id}/verify-proof`, { imageBase64: b64("proof-latte.jpg") });
  assert.equal(v.status, 200, JSON.stringify(v.json));
  assert.equal(v.json.verified, true);
  assert.equal(v.json.bonusPoints, 25);
});

test("live: merchant discovery agent (tool calling, drafts only)", { skip: !hasKey }, async () => {
  const r = await post("/agent/discover-merchants", { city: "Oakland", category: "any", topN: 2 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.outreachSent, false);
  assert.ok(r.json.steps.some((s: any) => s.tool === "search_businesses"));
  assert.ok(r.json.ranked.length >= 3);
  assert.ok(r.json.drafts.length >= 1);
  assert.ok(r.json.drafts.every((d: any) => d.status === "draft_not_sent"));
});

test("live: Muse Image cosmetic", { skip: !hasKey || process.env.SKIP_IMAGE_GEN === "1" }, async () => {
  const r = await post("/cosmetic/generate", { deviceId: DEV, prompt: "tiny green leaf crown", slot: "hat" });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.ok(fs.existsSync(path.join(process.env.MEDIA_DIR!, "cosmetics", path.basename(r.json.url))));
});
