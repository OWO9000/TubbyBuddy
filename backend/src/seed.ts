import { db, now } from "./db.js";
import { DEMO_OFFERS } from "./offerCatalog.js";

/**
 * Cosmetics: fur colors (recolor the model) and accessories (a small 3D/2D prop attached to the head or neck).
 * "Classic" is free and always owned. The web renders accessories in three.js and as SVG overlays on the PNG fallback.
 */
export const FUR_COLORS = [
  { id: "color-classic", name: "Classic Pink", slot: "color", price: 0, emoji: "🩷" },
  { id: "color-mint", name: "Mint", slot: "color", price: 80, emoji: "🟢" },
  { id: "color-ocean", name: "Ocean", slot: "color", price: 80, emoji: "🔵" },
  { id: "color-grape", name: "Grape", slot: "color", price: 120, emoji: "🟣" },
  { id: "color-sunset", name: "Sunset", slot: "color", price: 150, emoji: "🟠" },
  { id: "color-midnight", name: "Midnight", slot: "color", price: 250, emoji: "🌙" },
  { id: "color-gold", name: "Gold", slot: "color", price: 400, emoji: "🟡" },
];

export const ACCESSORIES = [
  { id: "acc-bow", name: "Velvet Bow", slot: "accessory", price: 150, emoji: "🎀" },
  { id: "acc-glasses", name: "Star Shades", slot: "accessory", price: 180, emoji: "🕶️" },
  { id: "acc-scarf", name: "Cozy Scarf", slot: "accessory", price: 220, emoji: "🧣" },
  { id: "acc-flowers", name: "Daisy Crown", slot: "accessory", price: 240, emoji: "🌼" },
  { id: "acc-headphones", name: "Beat Headphones", slot: "accessory", price: 260, emoji: "🎧" },
  { id: "acc-crown", name: "Sunbeam Crown", slot: "accessory", price: 320, emoji: "👑" },
];

export const COSMETICS = [...FUR_COLORS, ...ACCESSORIES];
export const DEFAULT_COLOR = "color-classic";

export function seed() {
  const insC = db.prepare(
    `INSERT OR IGNORE INTO cosmetics (id,name,slot,price,emoji,generated,created_at) VALUES (?,?,?,?,?,0,?)`,
  );
  for (const c of COSMETICS) insC.run(c.id, c.name, c.slot, c.price, c.emoji, now());
  // Keep names/prices in sync for databases seeded by earlier builds.
  const upd = db.prepare(`UPDATE cosmetics SET name=?, price=?, emoji=?, slot=? WHERE id=?`);
  for (const c of COSMETICS) upd.run(c.name, c.price, c.emoji, c.slot, c.id);

  const insO = db.prepare(`INSERT OR IGNORE INTO offers
    (id,business,title,description,category,items,discount_percent,monthly_cap,points_price,terms,source,consent_at,consent_name,status,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,'seed',?,?,'published',?)`);
  for (const o of DEMO_OFFERS)
    insO.run(o.id, o.business, o.title, o.description, o.category, JSON.stringify(o.items), o.discount, o.cap, o.points, o.terms, now(), "seed data", now());
  // Offer art was made with Muse Image (scripts/generate-art.ts) and ships with the web build.
  const art = db.prepare(`UPDATE offers SET image_url=? WHERE id=? AND (image_url IS NULL OR image_url LIKE '/art/%')`);
  for (const o of DEMO_OFFERS) art.run(`/art/offers/${o.id}.webp`, o.id);
}
