// Offline tests (no network): write rate limits and abuse controls.
// Runs in its own process (node --test spawns per file), so env overrides here are safe.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "burn-ratelimit-"));
process.env.DATA_DIR = tmp;
process.env.MEDIA_DIR = path.join(tmp, "media");
// Tiny limits so the tests can trip them without hundreds of requests.
process.env.RATE_LIMIT_EARN_PER_HOUR = "3";
process.env.RATE_LIMIT_UNLOCK_PER_HOUR = "2";
process.env.RATE_LIMIT_WRITES_PER_HOUR = "12";
process.env.RATE_LIMIT_AI_PER_HOUR = "3";
delete process.env.META_MODEL_API_KEY;

const { createApp } = await import("../src/app.js");

const server = createApp().listen(0);
after(() => server.close());
const port = (server.address() as { port: number }).port;

const call = async (p: string, body?: unknown, dev = "rl-dev-1") => {
  const r = await fetch(`http://localhost:${port}/api${p}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", "x-device-id": dev },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, retryAfter: r.headers.get("retry-after"), json: (await r.json()) as any };
};

test("earn endpoint: 429 with Retry-After after the per-device cap, other devices unaffected", async () => {
  // 3 allowed per hour for rl-dev-1 (test env override).
  for (let i = 0; i < 3; i++) {
    const r = await call("/points/earn", { deviceId: "rl-dev-1", event: "demo_grant", amount: 1 });
    assert.equal(r.status, 200, `request ${i + 1} should pass`);
  }
  const blocked = await call("/points/earn", { deviceId: "rl-dev-1", event: "demo_grant", amount: 1 });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.json.error, "rate_limited");
  assert.ok(Number(blocked.retryAfter) > 0 && Number(blocked.retryAfter) <= 3600);
  assert.equal(blocked.json.retryAfterSec, Number(blocked.retryAfter));

  // A different device has its own bucket.
  const other = await call("/points/earn", { deviceId: "rl-dev-2", event: "demo_grant", amount: 1 }, "rl-dev-2");
  assert.equal(other.status, 200);
});

test("guard unlock: capped per device, and reads stay unlimited", async () => {
  const dev = "rl-dev-3";
  for (let i = 0; i < 2; i++) {
    const r = await call("/guard/unlock", { deviceId: dev, appName: "Telegram" });
    assert.equal(r.status, 200, `unlock ${i + 1} should pass`);
  }
  const blocked = await call("/guard/unlock", { deviceId: dev, appName: "Telegram" });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.json.error, "rate_limited");

  // GETs are not counted by the global write limit.
  for (let i = 0; i < 20; i++) {
    const r = await call("/me", undefined, dev);
    assert.equal(r.status, 200);
  }
});

test("global write limit: 429 after the hourly cap, body still well-formed", async () => {
  const dev = "rl-dev-4";
  // 12 writes/hour allowed (test env override). The unlock route's own 2/hour cap fires
  // first on calls 3-12, but every attempt still counts against the global write bucket.
  let last = 0;
  for (let i = 0; i < 12; i++) {
    const r = await call("/guard/unlock", { deviceId: dev, appName: "Telegram" });
    last = r.status;
  }
  assert.equal(last, 429);
  // 13th write from this device trips the global write limiter.
  const r = await call("/points/earn", { deviceId: dev, event: "demo_grant", amount: 1 });
  assert.equal(r.status, 429);
  assert.equal(r.json.error, "rate_limited");
});

test("validation errors are not hidden behind the limiter", async () => {
  // A malformed request still gets a 400 (validation runs after the limiter lets it through).
  const r = await call("/points/earn", { deviceId: "rl-dev-5", event: "nonsense" }, "rl-dev-5");
  assert.equal(r.status, 400);
});

test("AI endpoints are capped per IP, so rotating device ids doesn't buy more model calls", async () => {
  const chat = (dev: string) => call("/assistant/chat", { messages: [{ role: "user", content: "hi" }] }, dev);
  for (let i = 0; i < 3; i++) assert.equal((await chat(`rl-ai-${i}`)).status, 200);
  const r = await chat("rl-ai-fresh");
  assert.equal(r.status, 429);
  assert.ok(Number(r.retryAfter) > 0);
});
