// Meta Model API client against a local mock server: request shape, retries, error mapping, coach wiring.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import type { AddressInfo } from "node:net";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tubby-meta-"));
process.env.DATA_DIR = tmp;
process.env.MEDIA_DIR = path.join(tmp, "media");
process.env.RATE_LIMITS = "off";

interface Seen { path: string; auth: string | undefined; body: Record<string, unknown> }
const seen: Seen[] = [];
let script: { status: number; body: unknown }[] = [];

const mock = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    seen.push({ path: req.url ?? "", auth: req.headers.authorization, body: JSON.parse(raw || "{}") });
    const next = script.shift() ?? { status: 500, body: { error: { message: "no scripted reply" } } };
    res.writeHead(next.status, { "content-type": "application/json" });
    res.end(JSON.stringify(next.body));
  });
});
await new Promise<void>((r) => mock.listen(0, "127.0.0.1", r));
process.env.META_BASE_URL = `http://127.0.0.1:${(mock.address() as AddressInfo).port}/v1`;
process.env.META_MODEL_API_KEY = "test-key-not-real";
after(() => mock.close());

const { chat, chatJson, MetaApiError } = await import("../src/meta.js");
const { cleanReply } = await import("../src/assistant.js");

const { createApp } = await import("../src/app.js");

test("cleanReply strips a speaker prefix and quotes, and finishes the sentence", () => {
  assert.equal(cleanReply('Tubby: "Put it face down for two minutes"'), "Put it face down for two minutes.");
  assert.equal(cleanReply("Two minutes first?"), "Two minutes first?");
  assert.equal(cleanReply("Close it — then breathe for a minute"), "Close it, then breathe for a minute.");
  assert.equal(cleanReply("Two minutes — "), "Two minutes.");
  assert.equal(cleanReply("Try 10–15 minutes"), "Try 10–15 minutes.", "number ranges keep their dash");
  assert.equal(cleanReply("Grab your book instead? 📚"), "Grab your book instead?");
  assert.equal(cleanReply("Nice work 🎉 keep going"), "Nice work keep going.");
});

const reply = (content: string) => ({ status: 200, body: { model: "muse-spark-1.3", choices: [{ finish_reason: "stop", message: { content } }] } });

test("chat sends the Muse model, effort and bearer key to /chat/completions", async () => {
  seen.length = 0;
  script = [reply("Hello.")];
  const r = await chat({ messages: [{ role: "user", content: "hi" }] });
  assert.equal(r.message.content, "Hello.");
  assert.equal(seen[0].path, "/v1/chat/completions");
  assert.equal(seen[0].auth, "Bearer test-key-not-real");
  assert.equal(seen[0].body.model, "muse-spark-1.3");
  assert.equal(seen[0].body.reasoning_effort, "low");
  assert.equal(seen[0].body.max_completion_tokens, undefined, "no token cap: reasoning tokens would starve the reply");
});

test("chat retries transient errors, then succeeds", async () => {
  seen.length = 0;
  script = [{ status: 503, body: { error: { message: "busy" } } }, reply("Second try.")];
  const r = await chat({ messages: [{ role: "user", content: "hi" }], retries: 1 });
  assert.equal(r.message.content, "Second try.");
  assert.equal(seen.length, 2);
});

test("chat does not retry a 400 and surfaces the upstream status and message", async () => {
  seen.length = 0;
  script = [{ status: 400, body: { error: { message: "bad schema" } } }];
  await assert.rejects(chat({ messages: [{ role: "user", content: "hi" }] }), (e: unknown) => {
    assert.ok(e instanceof MetaApiError);
    assert.equal(e.status, 400);
    assert.equal(e.message, "bad schema");
    return true;
  });
  assert.equal(seen.length, 1);
});

test("chatJson parses strict JSON output", async () => {
  script = [reply(JSON.stringify({ nudge: "Close it.", tone: "calm" }))];
  const r = await chatJson<{ nudge: string }>({ system: "s", user: "u", schemaName: "n", schema: { type: "object" } });
  assert.equal(r.data.nudge, "Close it.");
});

test("coach chat runs on Muse and reports live mode; health names only Meta models", async () => {
  const app = createApp().listen(0);
  const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}/api`;
  try {
    const health = await (await fetch(`${base}/health`)).json();
    assert.equal(health.metaConfigured, true);
    assert.equal(health.assistantMode, "live");
    assert.match(health.assistantModel, /^muse-/);

    script = [reply("Tubby: \"Two minutes first, then decide.\"")];
    const r = await fetch(`${base}/assistant/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-device-id": "meta-test-1" },
      body: JSON.stringify({ messages: [{ role: "user", content: "I want to open TikTok" }] }),
    });
    const j = await r.json();
    assert.equal(j.mode, "live");
    assert.equal(j.reply, "Two minutes first, then decide.");

    script = [{ status: 500, body: {} }, { status: 500, body: {} }];
    const down = await (await fetch(`${base}/assistant/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-device-id": "meta-test-1" },
      body: JSON.stringify({ messages: [{ role: "user", content: "I want to open TikTok" }] }),
    })).json();
    assert.equal(down.fallback, true, "an outage falls back to the offline coach instead of failing the chat");
    assert.ok(down.reply.length > 0);
  } finally {
    app.close();
  }
});
