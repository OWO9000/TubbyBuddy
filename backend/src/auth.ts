import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { db } from "./db.js";
import { DeviceId, HttpError } from "./http.js";
import { ensureUser } from "./ledger.js";

/**
 * Accounts: "Continue with Google" on the web, and a short link code for the phone and Windows apps
 * (they open the browser, the person signs in there, the app picks up its session).
 *
 * All existing data stays keyed by a profile id (the old anonymous device id). An account owns exactly one
 * profile; once a profile is owned, every request that names it must carry that account's session token.
 * Profiles nobody owns (guests, demo profiles) keep working with just the id.
 */

db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT,
  name TEXT,
  picture TEXT,
  profile_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  label TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_account ON sessions(account_id);
CREATE TABLE IF NOT EXISTS link_codes (
  code TEXT PRIMARY KEY,
  label TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  token TEXT,
  account_id TEXT
);
`);

const SESSION_DAYS = 90;
const LINK_MINUTES = 10;

export interface Account {
  id: string;
  email: string | null;
  name: string | null;
  picture: string | null;
  profileId: string;
}

interface AccountRow {
  id: string;
  google_sub: string;
  email: string | null;
  name: string | null;
  picture: string | null;
  profile_id: string;
}

const toAccount = (r: AccountRow): Account => ({ id: r.id, email: r.email, name: r.name, picture: r.picture, profileId: r.profile_id });

export const googleClientId = () => (process.env.GOOGLE_CLIENT_ID ?? "").trim();
export const googleConfigured = () => googleClientId().length > 0;

let jwks: JWTVerifyGetKey | null = null;
function googleKeys(): JWTVerifyGetKey {
  if (!jwks) jwks = createRemoteJWKSet(new URL(process.env.GOOGLE_JWKS_URL ?? "https://www.googleapis.com/oauth2/v3/certs"));
  return jwks;
}
/** Test hook: forget cached Google keys (the JWKS URL is read once). */
export function resetGoogleKeys() {
  jwks = null;
}

export interface GoogleClaims {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
}

/** Verifies a Google ID token (signature, issuer, audience, expiry). */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleClaims> {
  if (!googleConfigured()) throw new HttpError(503, "Google sign-in is not set up on this server");
  try {
    const { payload } = await jwtVerify(idToken, googleKeys(), {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: googleClientId(),
    });
    if (typeof payload.sub !== "string" || !payload.sub) throw new Error("no subject");
    if (payload.email && payload.email_verified === false) throw new Error("email not verified");
    return {
      sub: payload.sub,
      email: typeof payload.email === "string" ? payload.email : undefined,
      name: typeof payload.name === "string" ? payload.name : undefined,
      picture: typeof payload.picture === "string" ? payload.picture : undefined,
    };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(401, "Google sign-in could not be verified");
  }
}

const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

function newSession(accountId: string, label?: string): string {
  const token = `tb_${crypto.randomBytes(32).toString("base64url")}`;
  const now = Date.now();
  db.prepare("INSERT INTO sessions (token_hash, account_id, label, created_at, expires_at) VALUES (?, ?, ?, ?, ?)").run(
    hash(token),
    accountId,
    label?.slice(0, 80) ?? null,
    now,
    now + SESSION_DAYS * 86_400_000,
  );
  return token;
}

const ownerStmt = () => db.prepare("SELECT * FROM accounts WHERE profile_id = ?");
export function ownerOf(profileId: string): AccountRow | undefined {
  return ownerStmt().get(profileId) as AccountRow | undefined;
}

/**
 * Signs in with verified Google claims. A first sign-in keeps the progress of the guest profile it came from,
 * unless that profile is a demo profile or already belongs to someone else.
 */
export function signInWithGoogle(claims: GoogleClaims, fromProfile?: string, label?: string) {
  const now = Date.now();
  const existing = db.prepare("SELECT * FROM accounts WHERE google_sub = ?").get(claims.sub) as AccountRow | undefined;
  let row: AccountRow;
  let isNew = false;
  if (existing) {
    db.prepare("UPDATE accounts SET email = ?, name = ?, picture = ?, last_login_at = ? WHERE id = ?").run(
      claims.email ?? existing.email,
      claims.name ?? existing.name,
      claims.picture ?? existing.picture,
      now,
      existing.id,
    );
    row = { ...existing, email: claims.email ?? existing.email, name: claims.name ?? existing.name, picture: claims.picture ?? existing.picture };
  } else {
    const adoptable = fromProfile && DeviceId.safeParse(fromProfile).success && !fromProfile.startsWith("demo-") && !ownerOf(fromProfile);
    const profileId = adoptable ? fromProfile! : `acct-${crypto.randomBytes(12).toString("hex")}`;
    ensureUser(profileId);
    const id = crypto.randomUUID();
    db.prepare(
      "INSERT INTO accounts (id, google_sub, email, name, picture, profile_id, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(id, claims.sub, claims.email ?? null, claims.name ?? null, claims.picture ?? null, profileId, now, now);
    row = { id, google_sub: claims.sub, email: claims.email ?? null, name: claims.name ?? null, picture: claims.picture ?? null, profile_id: profileId };
    isNew = true;
  }
  return { token: newSession(row.id, label), account: toAccount(row), isNew };
}

/** The account behind `Authorization: Bearer <token>`, if the session is valid. */
export function sessionAccount(req: Request): (Account & { tokenHash: string }) | null {
  const m = (req.header("authorization") ?? "").match(/^Bearer\s+(tb_[A-Za-z0-9_-]{20,})$/);
  if (!m) return null;
  const h = hash(m[1]);
  const row = db
    .prepare("SELECT a.*, s.expires_at FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ?")
    .get(h) as (AccountRow & { expires_at: number }) | undefined;
  if (!row || row.expires_at < Date.now()) return null;
  return { ...toAccount(row), tokenHash: h };
}

export function signOut(tokenHash: string) {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
}

/**
 * Every device id a request mentions (header, body, query) must be either unowned or owned by the signed-in
 * account. Mounted before the API routers, so no route can forget the check.
 */
export function requireProfileAccess(req: Request, _res: Response, next: NextFunction) {
  const ids = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === "string" && v) ids.add(v.trim());
  };
  add(req.header("x-device-id"));
  add((req.body as Record<string, unknown> | undefined)?.deviceId);
  add(req.query.deviceId);
  if (!ids.size) return next();
  let session: ReturnType<typeof sessionAccount> | undefined;
  for (const id of ids) {
    const owner = ownerOf(id);
    if (!owner) continue;
    session ??= sessionAccount(req);
    if (!session || session.id !== owner.id) return next(new HttpError(401, "sign_in_required"));
  }
  next();
}

// ---- Link codes: the phone and Windows apps sign in through the browser. ----

const LINK_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newCode(): string {
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes, (b) => LINK_ALPHABET[b % LINK_ALPHABET.length]).join("");
}

export function createLinkCode(label?: string) {
  const now = Date.now();
  db.prepare("DELETE FROM link_codes WHERE expires_at < ?").run(now);
  const code = newCode();
  const expiresAt = now + LINK_MINUTES * 60_000;
  db.prepare("INSERT INTO link_codes (code, label, created_at, expires_at) VALUES (?, ?, ?, ?)").run(code, label?.slice(0, 80) ?? null, now, expiresAt);
  return { code, expiresAt };
}

interface LinkRow {
  code: string;
  label: string | null;
  expires_at: number;
  token: string | null;
  account_id: string | null;
}

/** Approve a code from the browser where the person is signed in. Issues a fresh session for the app. */
export function approveLinkCode(code: string, accountId: string) {
  const row = db.prepare("SELECT * FROM link_codes WHERE code = ?").get(code) as LinkRow | undefined;
  if (!row || row.expires_at < Date.now()) throw new HttpError(404, "This link code has expired. Start again from the app.");
  if (row.token) throw new HttpError(409, "This code was already used.");
  const token = newSession(accountId, row.label ?? "Linked app");
  db.prepare("UPDATE link_codes SET token = ?, account_id = ? WHERE code = ?").run(token, accountId, code);
}

/** Polled by the app. Hands the session over exactly once, then forgets it. */
export function claimLinkCode(code: string): { status: "pending" | "expired" } | { status: "approved"; token: string; account: Account } {
  const row = db.prepare("SELECT * FROM link_codes WHERE code = ?").get(code) as LinkRow | undefined;
  if (!row || row.expires_at < Date.now()) return { status: "expired" };
  if (!row.token || !row.account_id) return { status: "pending" };
  db.prepare("DELETE FROM link_codes WHERE code = ?").run(code);
  const acct = db.prepare("SELECT * FROM accounts WHERE id = ?").get(row.account_id) as AccountRow;
  return { status: "approved", token: row.token, account: toAccount(acct) };
}

export const linkCodeLabel = (code: string) =>
  (db.prepare("SELECT label, expires_at FROM link_codes WHERE code = ?").get(code) as { label: string | null; expires_at: number } | undefined) ?? null;

