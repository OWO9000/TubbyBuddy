import { Router } from "express";
import multer from "multer";
import crypto from "node:crypto";
import QRCode from "qrcode";
import { z } from "zod";
import { APP_NAME, EARN_RULES, OFFER_BOUNDS } from "../config.js";
import { db, now } from "../db.js";
import { chatJson, isAiConfigured, userContent } from "../meta.js";
import { localOffer, localProof } from "../demo.js";
import { CATEGORIES, sanitizeOffer, type RawOffer } from "../offerSanity.js";
import { addEntry, balanceOf, ensureUser, spend } from "../ledger.js";
import { DeviceId, HttpError, deviceIdOf, newId, parse, readImage, route } from "../http.js";
import { redeemLimit } from "../rateLimit.js";
import { matchOffers } from "../offerCatalog.js";
import { goalsWithThemes } from "./assistant.js";

export const merchant = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

const OFFER_SCHEMA = {
  type: "object",
  properties: {
    business: { type: "string", description: "Business name as printed, or empty string if not visible" },
    offerTitle: { type: "string", description: "Short punchy offer title, max 60 chars" },
    description: { type: "string", description: "1-2 sentences selling an offline, phone-free experience" },
    items: {
      type: "array",
      description: "Menu items / services read from the image with their listed price in USD (0 if unreadable)",
      items: {
        type: "object",
        properties: { name: { type: "string" }, price: { type: "number" } },
        required: ["name", "price"],
        additionalProperties: false,
      },
    },
    regularPrice: { type: "number", description: "Regular USD price of exactly what the offer covers (item or bundle)" },
    suggestedDiscountPercent: { type: "integer", description: `Between ${OFFER_BOUNDS.discountMin} and ${OFFER_BOUNDS.discountMax}` },
    monthlyCap: { type: "integer", description: "How many redemptions per month the business can absorb" },
    pointsPrice: { type: "integer", description: "Points cost; ~100 points per $1 the customer saves" },
    terms: { type: "string" },
    category: { type: "string", enum: [...CATEGORIES] },
    confidence: { type: "number", description: "0-1 confidence the image was read correctly" },
    notes: { type: "string", description: "Anything the merchant should double-check" },
  },
  required: ["business", "offerTitle", "description", "items", "regularPrice", "suggestedDiscountPercent", "monthlyCap", "pointsPrice", "terms", "category", "confidence", "notes"],
  additionalProperties: false,
};

const OFFER_SYSTEM = `You are the merchant onboarding agent for ${APP_NAME}. ${APP_NAME} users earn points by staying off
distracting apps and spend them on real-world perks. A local business owner uploaded a photo of their menu or flyer.
Read it carefully (items and prices exactly as printed) and draft ONE attractive but sustainable offer:
- Prefer an item or experience people enjoy in person, away from their phone.
- Keep the discount modest enough that the business still profits (usually 15-40%).
- monthlyCap should reflect a small business's capacity (often 20-100).
- pointsPrice ~= dollars saved x 100 (regularPrice x discount% x 100).
If the image is not a menu/flyer or is unreadable, still return the schema with confidence below 0.3 and explain in notes.`;

merchant.post(
  "/merchant/offer-from-photo",
  upload.single("image"),
  route(async (req) => {
    const businessName = typeof req.body?.businessName === "string" ? req.body.businessName.slice(0, 80) : undefined;
    const img = readImage(req);
    if (!isAiConfigured()) {
      const sampleMenu = req.body?.sampleMenu === true || req.body?.sampleMenu === "true";
      const raw = localOffer({ businessName, sampleMenu });
      const offer = sanitizeOffer(raw, businessName);
      return { draft: offer, raw, imageUrl: img.publicUrl, model: "offline", latencyMs: 0, mode: "demo" };
    }
    const r = await chatJson<RawOffer>({
      system: OFFER_SYSTEM,
      user: userContent(
        `Draft an offer from this image.${businessName ? ` The business says its name is "${businessName}".` : ""}`,
        img.dataUrl,
      ),
      schemaName: "merchant_offer",
      schema: OFFER_SCHEMA,
    });
    const offer = sanitizeOffer(r.data, businessName);
    return { draft: offer, raw: r.data, imageUrl: img.publicUrl, model: r.model, latencyMs: r.latencyMs, usage: r.usage, mode: "live" };
  }),
);

const PublishBody = z.object({
  consent: z.literal(true, { message: "merchant must explicitly confirm (consent: true) before publishing" }),
  consentName: z.string().trim().min(2).max(80),
  imageUrl: z.string().max(300).optional(),
  offer: z.object({
    business: z.string().trim().min(1).max(80),
    offerTitle: z.string().trim().min(3).max(80),
    description: z.string().trim().max(400).default(""),
    items: z.array(z.object({ name: z.string().max(80), price: z.number().min(0) })).max(20).default([]),
    suggestedDiscountPercent: z.number().int().min(OFFER_BOUNDS.discountMin).max(100),
    monthlyCap: z.number().int().min(1).max(10_000),
    pointsPrice: z.number().int().min(10).max(100_000),
    terms: z.string().trim().max(400).default(""),
    category: z.enum(CATEGORIES).default("other"),
  }),
});

const offerOut = (o: Record<string, unknown>) => ({
  id: o.id,
  business: o.business,
  title: o.title,
  description: o.description,
  category: o.category,
  items: JSON.parse(String(o.items ?? "[]")),
  discountPercent: o.discount_percent,
  monthlyCap: o.monthly_cap,
  pointsPrice: o.points_price,
  terms: o.terms,
  imageUrl: o.image_url,
  source: o.source,
  redeemedThisMonth: o.redeemed_this_month ?? undefined,
  createdAt: o.created_at,
});

merchant.post(
  "/merchant/offers",
  route(async (req, res) => {
    const b = parse(PublishBody, req.body);
    const id = newId("off");
    const o = b.offer;
    db.prepare(`INSERT INTO offers (id,business,title,description,category,items,discount_percent,monthly_cap,points_price,terms,image_url,source,consent_at,consent_name,status,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,'merchant',?,?,'published',?)`).run(
      id, o.business, o.offerTitle, o.description, o.category, JSON.stringify(o.items), o.suggestedDiscountPercent,
      o.monthlyCap, o.pointsPrice, o.terms, b.imageUrl ?? null, now(), b.consentName, now(),
    );
    res.status(201);
    return { offer: offerOut(db.prepare(`SELECT * FROM offers WHERE id=?`).get(id) as Record<string, unknown>) };
  }),
);

const monthStart = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
};

merchant.get(
  "/offers",
  route(async (req) => {
    const rows = db
      .prepare(`SELECT o.*, (SELECT COUNT(*) FROM redemptions r WHERE r.offer_id=o.id AND r.created_at>=?) AS redeemed_this_month
                FROM offers o WHERE status='published' ORDER BY (source='seed'), points_price`)
      .all(monthStart()) as Record<string, unknown>[];
    // Lead with offers that fit the person's own goals, and say which goal each one is for.
    const dev = DeviceId.safeParse(req.header("x-device-id"));
    const { goals, known } = dev.success ? goalsWithThemes(dev.data) : { goals: [], known: {} };
    const out = rows.map(offerOut);
    const ranked = matchOffers(out, goals, known)
      .map((m, i) => ({ ...m, i }))
      .sort((a, b) => b.score - a.score || a.i - b.i);
    return { offers: ranked.map((m) => ({ ...m.offer, forGoal: m.forGoal })), goals };
  }),
);

/** Printable poster QR for a published offer (links customers to it in the app). */
merchant.get(
  "/offers/:id/qr",
  route(async (req) => {
    const o = db.prepare(`SELECT id, title, business FROM offers WHERE id=?`).get(req.params.id) as Record<string, string> | undefined;
    if (!o) throw new HttpError(404, "That offer isn't available anymore");
    const origin = typeof req.query.origin === "string" && /^https?:\/\/[\w.:-]+$/.test(req.query.origin) ? req.query.origin : `${req.protocol}://${req.get("host")}`;
    const url = `${origin}/?offer=${encodeURIComponent(o.id)}`;
    return { url, qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 360 }), title: o.title, business: o.business };
  }),
);

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const code = () => {
  const b = crypto.randomBytes(8);
  const s = Array.from(b, (x) => ALPHABET[x % ALPHABET.length]).join("");
  return `${APP_NAME.toUpperCase().slice(0, 4)}-${s.slice(0, 4)}-${s.slice(4)}`;
};

merchant.post(
  "/offers/:id/redeem",
  redeemLimit(),
  route(async (req, res) => {
    const deviceId = deviceIdOf(req);
    ensureUser(deviceId);
    const offer = db.prepare(`SELECT * FROM offers WHERE id=? AND status='published'`).get(req.params.id) as Record<string, any> | undefined;
    if (!offer) throw new HttpError(404, "That offer isn't available anymore");
    const used = (db.prepare(`SELECT COUNT(*) c FROM redemptions WHERE offer_id=? AND created_at>=?`).get(offer.id, monthStart()) as { c: number }).c;
    if (used >= offer.monthly_cap) throw new HttpError(409, "This offer is used up for the month", { monthlyCap: offer.monthly_cap });
    const id = newId("red");
    const c = code();
    const balance = db.transaction(() => {
      const bal = spend(deviceId, offer.points_price, "redeem", `Redeemed: ${offer.title}`, id);
      db.prepare(`INSERT INTO redemptions (id, offer_id, device_id, code, points, created_at) VALUES (?,?,?,?,?,?)`).run(
        id, offer.id, deviceId, c, offer.points_price, now(),
      );
      return bal;
    })();
    const qrPayload = `${APP_NAME.toLowerCase()}:redeem:${c}`;
    const qrDataUrl = await QRCode.toDataURL(qrPayload, { margin: 1, width: 320, color: { dark: "#1b1206", light: "#ffffff" } });
    res.status(201);
    return { redemption: { id, code: c, offerId: offer.id, business: offer.business, title: offer.title, points: offer.points_price }, qrPayload, qrDataUrl, balance };
  }),
);

/** Merchant side: scan/enter a code at the counter (one-time use). */
merchant.post(
  "/merchant/redemptions/validate",
  route(async (req) => {
    const { code: c } = parse(z.object({ code: z.string().trim().toUpperCase().min(6).max(40) }), req.body);
    const clean = c.replace(/^.*:REDEEM:/, "");
    const r = db.prepare(`SELECT r.*, o.title, o.business FROM redemptions r JOIN offers o ON o.id=r.offer_id WHERE r.code=?`).get(clean) as Record<string, any> | undefined;
    if (!r) throw new HttpError(404, "That code doesn't exist");
    if (r.used_at) throw new HttpError(409, "That code was already used", { usedAt: r.used_at });
    db.prepare(`UPDATE redemptions SET used_at=?, status=CASE WHEN status='verified' THEN status ELSE 'used' END WHERE id=?`).run(now(), r.id);
    return { ok: true, redemptionId: r.id, title: r.title, business: r.business };
  }),
);

const PROOF_SCHEMA = {
  type: "object",
  properties: {
    isRealVisit: { type: "boolean" },
    confidence: { type: "number", description: "0-1" },
    reason: { type: "string", description: "One friendly sentence" },
  },
  required: ["isRealVisit", "confidence", "reason"],
  additionalProperties: false,
};

merchant.post(
  "/redemptions/:id/verify-proof",
  upload.single("image"),
  route(async (req) => {
    const deviceId = deviceIdOf(req);
    const red = db.prepare(`SELECT r.*, o.title, o.business, o.category FROM redemptions r JOIN offers o ON o.id=r.offer_id WHERE r.id=?`).get(req.params.id) as Record<string, any> | undefined;
    if (!red) throw new HttpError(404, "That code wasn't found");
    if (red.device_id !== deviceId) throw new HttpError(403, "That code belongs to someone else");
    const img = readImage(req);
    const r = isAiConfigured()
      ? await chatJson<{ isRealVisit: boolean; confidence: number; reason: string }>({
          system: `You check photo proof that a ${APP_NAME} user actually went out and enjoyed a real-world reward.
Be lenient and encouraging: any real photo plausibly taken at, or showing the kind of place/product from, the offer counts
(food, drinks, a venue interior, equipment, a receipt, a printed menu, a storefront). Only reject screenshots of other apps,
blank/black frames, or images clearly unrelated to going out. Never ask for or comment on people's identity.`,
          user: userContent(`Offer: "${red.title}" at ${red.business} (category: ${red.category}). Is this photo a plausible real visit?`, img.dataUrl),
          schemaName: "proof_check",
          schema: PROOF_SCHEMA,
        })
      : { data: localProof(), latencyMs: 0 };
    const verified = !!r.data.isRealVisit;
    const firstTime = verified && red.status !== "verified";
    db.prepare(`UPDATE redemptions SET status=?, proof_result=? WHERE id=?`).run(
      verified ? "verified" : red.status, JSON.stringify({ ...r.data, imageUrl: img.publicUrl, at: now() }), red.id,
    );
    if (firstTime) addEntry(deviceId, EARN_RULES.proof_verified, "earn:proof_verified", `Proof bonus: ${red.title}`, red.id);
    return {
      result: { ...r.data, confidence: Math.max(0, Math.min(1, r.data.confidence)) },
      verified,
      bonusPoints: firstTime ? EARN_RULES.proof_verified : 0,
      balance: balanceOf(deviceId),
      imageUrl: img.publicUrl,
      latencyMs: r.latencyMs,
      mode: isAiConfigured() ? "live" : "demo",
    };
  }),
);
