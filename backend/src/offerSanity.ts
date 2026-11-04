import { OFFER_BOUNDS as B } from "./config.js";

export const CATEGORIES = ["food", "drinks", "fitness", "experience", "class", "retail", "other"] as const;
export const POINTS_PER_DOLLAR_SAVED = 100;

export interface RawOffer {
  business: string;
  offerTitle: string;
  description: string;
  items: { name: string; price: number }[];
  /** Regular USD price of exactly what the offer covers (the featured item or bundle). */
  regularPrice: number;
  suggestedDiscountPercent: number;
  monthlyCap: number;
  pointsPrice: number;
  terms: string;
  category: string;
  confidence: number;
  notes: string;
}

export interface SanitizedOffer extends RawOffer {
  flags: string[];
  adjustments: string[];
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const num = (n: unknown, fallback: number) => (typeof n === "number" && Number.isFinite(n) ? n : fallback);

/** Deterministic guard rails on top of the model's draft. Pure function (unit tested). */
export function sanitizeOffer(raw: RawOffer, businessOverride?: string): SanitizedOffer {
  const flags: string[] = [];
  const adjustments: string[] = [];

  const items = (Array.isArray(raw.items) ? raw.items : [])
    .filter((i) => i && typeof i.name === "string" && i.name.trim())
    .slice(0, 20)
    .map((i) => ({ name: i.name.trim().slice(0, 80), price: Math.max(0, Math.round(num(i.price, 0) * 100) / 100) }));
  if (items.length === 0) flags.push("no_items_detected");

  let discount = Math.round(num(raw.suggestedDiscountPercent, 20));
  const d2 = clamp(discount, B.discountMin, B.discountMax);
  if (d2 !== discount) adjustments.push(`discount ${discount}% clamped to ${d2}%`);
  discount = d2;

  let cap = Math.round(num(raw.monthlyCap, 30));
  const c2 = clamp(cap, B.capMin, B.capMax);
  if (c2 !== cap) adjustments.push(`monthly cap ${cap} clamped to ${c2}`);
  cap = c2;

  // Points price should track the real dollar value the user saves.
  // Use the offer's own regular price; fall back to the median menu item.
  const priced = items.filter((i) => i.price > 0).map((i) => i.price).sort((a, b) => a - b);
  const regular = Math.max(0, num(raw.regularPrice, 0));
  const basis = regular > 0 ? regular : priced.length ? priced[Math.floor(priced.length / 2)] : 0;
  const basisLabel = regular > 0 ? `regular price $${basis}` : `median item $${basis}`;
  const derived = basis ? Math.round((basis * discount * POINTS_PER_DOLLAR_SAVED) / 100 / 10) * 10 : 0;
  let points = Math.round(num(raw.pointsPrice, derived || 300));
  if (derived && (points < derived * 0.5 || points > derived * 2)) {
    adjustments.push(`points price ${points} re-derived from ${basisLabel} at ${discount}% off -> ${derived}`);
    points = derived;
  }
  const p2 = clamp(Math.round(points / 10) * 10, B.pointsMin, B.pointsMax);
  if (p2 !== points) adjustments.push(`points price ${points} clamped to ${p2}`);
  points = p2;

  const confidence = clamp(num(raw.confidence, 0), 0, 1);
  if (confidence < B.lowConfidence) flags.push("low_confidence_review_carefully");

  let category = String(raw.category ?? "other").toLowerCase();
  if (!(CATEGORIES as readonly string[]).includes(category)) {
    adjustments.push(`unknown category '${category}' -> other`);
    category = "other";
  }

  const business = (businessOverride?.trim() || String(raw.business ?? "").trim() || "Unknown business").slice(0, 80);
  if (!businessOverride && !String(raw.business ?? "").trim()) flags.push("business_name_missing");

  return {
    business,
    offerTitle: String(raw.offerTitle ?? "").trim().slice(0, 80) || `${discount}% off at ${business}`,
    description: String(raw.description ?? "").trim().slice(0, 400),
    items,
    regularPrice: Math.round(basis * 100) / 100,
    suggestedDiscountPercent: discount,
    monthlyCap: cap,
    pointsPrice: points,
    terms: String(raw.terms ?? "").trim().slice(0, 400) || "One per person per month.",
    category,
    confidence,
    notes: String(raw.notes ?? "").trim().slice(0, 400),
    flags,
    adjustments,
  };
}
