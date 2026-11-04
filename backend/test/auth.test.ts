// Google sign-in, profile ownership and the app link-code flow, against a local stand-in for Google's key endpoint.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tubby-auth-"));
process.env.DATA_DIR = tmp;
process.env.MEDIA_DIR = path.join(tmp, "media");
process.env.RATE_LIMITS = "off";
delete process.env.META_MODEL_API_KEY;

const CLIENT = "test-client.apps.googleusercontent.com";
const { privateKey, publicKey } = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
const keys = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ keys: [jwk] }));
});
await new Promise<void>((r) => keys.listen(0, "127.0.0.1", r));
process.env.GOOGLE_JWKS_URL = `http://127.0.0.1:${(keys.address() as AddressInfo).port}/certs`;
process.env.GOOGLE_CLIENT_ID = CLIENT;
after(() => keys.close());

const { createApp } = await import("../src/app.js");
const server = createApp().listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
after(() => server.close());

const idToken = (sub: string, opts: { aud?: string; exp?: string; iss?: string } = {}) =>
  new SignJWT({ email: `${sub}@example.com`, email_verified: true, name: `Person ${sub}`, picture: "https://example.com/p.png" })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(opts.iss ?? "https://accounts.google.com")
    .setAudience(opts.aud ?? CLIENT)
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "1h")
    .sign(privateKey);

async function call(p: string, { dev, token, body, method }: { dev?: string; token?: string; body?: unknown; method?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (dev) headers["x-device-id"] = dev;
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(`${base}${p}`, { method: method ?? (body ? "POST" : "GET"), headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: (await r.json()) as any };
}

test("health and config advertise Google sign-in only when a client id is set", async () => {
  assert.equal((await call("/health")).json.googleSignIn, true);
  const c = await call("/auth/config");
  assert.deepEqual(c.json, { google: true, googleClientId: CLIENT });
});

test("first sign-in keeps the guest's progress; the profile then needs the session", async () => {
  const guest = "guest-auth-1";
  await call("/points/earn", { dev: guest, body: { deviceId: guest, event: "demo_grant", amount: 300 } });

  const r = await call("/auth/google", { body: { credential: await idToken("g-1"), deviceId: guest } });
  assert.equal(r.status, 200);
  assert.equal(r.json.isNew, true);
  assert.equal(r.json.account.profileId, guest, "the guest profile becomes the account's profile");
  assert.equal(r.json.account.email, "g-1@example.com");
  assert.equal(r.json.account.onboarded, false);
  assert.match(r.json.token, /^tb_/);

  const open = await call("/me", { dev: guest });
  assert.equal(open.status, 401, "the id alone no longer opens a signed-in profile");
  assert.equal(open.json.error, "sign_in_required");

  const mine = await call("/me", { dev: guest, token: r.json.token });
  assert.equal(mine.status, 200);
  assert.equal(mine.json.balance, 300);

  const s = await call("/auth/session", { token: r.json.token });
  assert.equal(s.json.account.profileId, guest);
});

test("a body device id can't be used to reach someone else's profile", async () => {
  const victim = await call("/auth/google", { body: { credential: await idToken("g-victim"), deviceId: "victim-dev" } });
  const attacker = await call("/auth/google", { body: { credential: await idToken("g-attacker"), deviceId: "attacker-dev" } });
  const r = await call("/points/burn", {
    dev: "attacker-dev",
    token: attacker.json.token,
    body: { deviceId: victim.json.account.profileId, reason: "x", amount: 10 },
  });
  assert.equal(r.status, 401);
});

test("returning sign-in finds the same profile; demo profiles are never adopted", async () => {
  const first = await call("/auth/google", { body: { credential: await idToken("g-2") } });
  assert.match(first.json.account.profileId, /^acct-/);
  await call("/assistant/settings", { method: "PUT", dev: first.json.account.profileId, token: first.json.token, body: { goals: ["Read more"] } });

  const again = await call("/auth/google", { body: { credential: await idToken("g-2"), deviceId: "some-other-guest" } });
  assert.equal(again.json.isNew, false);
  assert.equal(again.json.account.profileId, first.json.account.profileId);
  assert.equal(again.json.account.onboarded, true);

  const demo = (await call("/demo/profile", { body: {} })).json.deviceId as string;
  const fromDemo = await call("/auth/google", { body: { credential: await idToken("g-3"), deviceId: demo } });
  assert.notEqual(fromDemo.json.account.profileId, demo);
  assert.equal((await call("/me", { dev: demo })).status, 200, "demo profiles stay open");
});

test("bad tokens are refused", async () => {
  assert.equal((await call("/auth/google", { body: { credential: await idToken("g-x", { aud: "someone-else" }) } })).status, 401);
  assert.equal((await call("/auth/google", { body: { credential: await idToken("g-x", { iss: "https://evil.example" }) } })).status, 401);
  assert.equal((await call("/auth/google", { body: { credential: await idToken("g-x", { exp: "-1m" }) } })).status, 401);
  assert.equal((await call("/auth/session", { token: "tb_notarealtokennotarealtoken" })).status, 401);
});

test("link code: the app polls, the browser approves, the session is handed over once", async () => {
  const web = await call("/auth/google", { body: { credential: await idToken("g-link") } });
  const link = await call("/auth/link", { body: { label: "Windows app" } });
  assert.equal(link.status, 201);
  assert.match(link.json.code, /^[A-Z2-9]{8}$/);
  assert.ok(link.json.url.endsWith(`/link?code=${link.json.code}`));

  assert.equal((await call(`/auth/link/${link.json.code}/info`)).json.label, "Windows app");
  assert.equal((await call(`/auth/link/${link.json.code}`)).json.status, "pending");
  assert.equal((await call(`/auth/link/${link.json.code}/approve`, { body: {} })).status, 401);
  assert.equal((await call(`/auth/link/${link.json.code}/approve`, { token: web.json.token, body: {} })).status, 200);

  const got = await call(`/auth/link/${link.json.code}`);
  assert.equal(got.json.status, "approved");
  assert.equal(got.json.account.profileId, web.json.account.profileId);
  assert.notEqual(got.json.token, web.json.token, "the app gets its own session");
  assert.equal((await call(`/auth/link/${link.json.code}`)).json.status, "expired", "a code hands over only once");
  assert.equal((await call("/me", { dev: got.json.account.profileId, token: got.json.token })).status, 200);
});

test("sign out ends only that session", async () => {
  const a = await call("/auth/google", { body: { credential: await idToken("g-out") } });
  const b = await call("/auth/google", { body: { credential: await idToken("g-out") } });
  await call("/auth/logout", { token: a.json.token, body: {} });
  assert.equal((await call("/auth/session", { token: a.json.token })).status, 401);
  assert.equal((await call("/auth/session", { token: b.json.token })).status, 200);
});
