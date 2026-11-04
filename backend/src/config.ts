import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const BACKEND_ROOT = path.resolve(here, "..");

// Load .env for every entry point (dev used --env-file; production `node dist/server.js` did not).
const envFile = path.resolve(BACKEND_ROOT, "../.env");
if (fs.existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    /* malformed .env: keep process env */
  }
}

/** Product name lives in /brand.json only (shared by backend + web). Rename the app there. */
const brand = JSON.parse(fs.readFileSync(path.resolve(BACKEND_ROOT, "../brand.json"), "utf8")) as {
  name: string;
  tagline: string;
  companionName: string;
};
export const APP_NAME = brand.name;
export const APP_TAGLINE = brand.tagline;
export const COMPANION_NAME = brand.companionName;

export const config = {
  port: Number(process.env.PORT ?? 8787),
  metaBaseUrl: process.env.META_BASE_URL ?? "https://api.meta.ai/v1",
  textModel: process.env.META_TEXT_MODEL ?? "muse-spark-1.3",
  imageModel: process.env.META_IMAGE_MODEL ?? "muse-image-1.0",
  dataDir: process.env.DATA_DIR || path.join(BACKEND_ROOT, "data"),
  mediaDir: process.env.MEDIA_DIR || path.join(BACKEND_ROOT, "media"),
  webDist: path.resolve(BACKEND_ROOT, "../web/dist"),
};

/** Points economy. Server decides amounts so clients can't mint points. */
export const EARN_RULES = {
  focus_session: 20,
  /** Putting a guarded app down is logged (badges, Focus Score) but pays nothing: points come from finished timers. */
  resisted_temptation: 0,
  streak_day: 10, // + 5 per streak day, capped below
  proof_verified: 25,
} as const;
export const STREAK_BONUS_PER_DAY = 5;
export const STREAK_BONUS_CAP = 50;

/** Sanity bounds applied to AI-drafted merchant offers. */
export const OFFER_BOUNDS = {
  discountMin: 5,
  discountMax: 50,
  capMin: 5,
  capMax: 300,
  pointsMin: 100,
  pointsMax: 5000,
  lowConfidence: 0.6,
};
