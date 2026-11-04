import { Router } from "express";
import { z } from "zod";
import { DeviceId, HttpError, parse, route } from "../http.js";
import { rateLimit } from "../rateLimit.js";
import {
  approveLinkCode,
  claimLinkCode,
  createLinkCode,
  googleClientId,
  googleConfigured,
  linkCodeLabel,
  sessionAccount,
  signInWithGoogle,
  signOut,
  verifyGoogleIdToken,
  type Account,
} from "../auth.js";
import { hasCoachSetup } from "./assistant.js";

export const auth = Router();

const signInLimit = rateLimit({ name: "auth-signin", max: 30, windowMs: 3_600_000, byIp: true });
const linkLimit = rateLimit({ name: "auth-link", max: 30, windowMs: 3_600_000, byIp: true });
const pollLimit = rateLimit({ name: "auth-poll", max: 600, windowMs: 3_600_000, byIp: true });

const publicAccount = (a: Account) => ({
  name: a.name,
  email: a.email,
  picture: a.picture,
  profileId: a.profileId,
  onboarded: hasCoachSetup(a.profileId),
});

auth.get("/auth/config", (_req, res) => {
  res.json({ google: googleConfigured(), googleClientId: googleConfigured() ? googleClientId() : null });
});

auth.post(
  "/auth/google",
  signInLimit,
  route(async (req) => {
    const b = parse(
      z.object({ credential: z.string().min(20).max(5000), deviceId: DeviceId.optional(), label: z.string().max(80).optional() }),
      req.body,
    );
    const claims = await verifyGoogleIdToken(b.credential);
    const r = signInWithGoogle(claims, b.deviceId, b.label ?? "Web");
    return { token: r.token, isNew: r.isNew, account: publicAccount(r.account) };
  }),
);

auth.get(
  "/auth/session",
  route(async (req) => {
    const a = sessionAccount(req);
    if (!a) throw new HttpError(401, "signed_out");
    return { account: publicAccount(a) };
  }),
);

auth.post(
  "/auth/logout",
  route(async (req) => {
    const a = sessionAccount(req);
    if (a) signOut(a.tokenHash);
    return { ok: true };
  }),
);

/** The phone or Windows app asks for a code, opens `/link?code=…` in the browser, then polls. */
auth.post(
  "/auth/link",
  linkLimit,
  route(async (req, res) => {
    if (!googleConfigured()) throw new HttpError(503, "Google sign-in is not set up on this server");
    const b = parse(z.object({ label: z.string().max(80).optional() }), req.body ?? {});
    const { code, expiresAt } = createLinkCode(b.label);
    // Google only trusts the origins listed for the client, and local setups list http://localhost, not 127.0.0.1.
    const origin = `${req.protocol}://${String(req.get("host")).replace(/^127\.0\.0\.1(?=:|$)/, "localhost")}`;
    res.status(201);
    return { code, expiresAt, url: `${origin}/link?code=${code}` };
  }),
);

const Code = z.string().regex(/^[A-Z2-9]{8}$/);

auth.get(
  "/auth/link/:code",
  pollLimit,
  route(async (req) => {
    const r = claimLinkCode(parse(Code, req.params.code));
    if (r.status !== "approved") return r;
    return { status: r.status, token: r.token, account: publicAccount(r.account) };
  }),
);

/** What the browser shows before approving: which app is asking. */
auth.get(
  "/auth/link/:code/info",
  route(async (req) => {
    const info = linkCodeLabel(parse(Code, req.params.code));
    if (!info || info.expires_at < Date.now()) throw new HttpError(404, "This link code has expired. Start again from the app.");
    return { label: info.label ?? "TubbyBuddy app" };
  }),
);

auth.post(
  "/auth/link/:code/approve",
  signInLimit,
  route(async (req) => {
    const a = sessionAccount(req);
    if (!a) throw new HttpError(401, "sign_in_required");
    approveLinkCode(parse(Code, req.params.code), a.id);
    return { ok: true };
  }),
);
