// Generates the demo "visit proof" photo with Muse Image.
// Run once from /backend: npx tsx --env-file=../.env scripts/make-sample-proof.ts
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { generateImage } from "../src/meta.js";

const out = fileURLToPath(new URL("../../web/public/samples/proof-latte.png", import.meta.url));
const r = await generateImage(
  "Candid smartphone photo of a latte with simple heart latte art in a ceramic cup on a wooden cafe table, a croissant on a plate, window light, a phone lying face-down next to the cup. Photorealistic, no text, no people.",
  "1024x1024",
);
fs.writeFileSync(out, Buffer.from(r.b64, "base64"));
console.log("saved", out, r.latencyMs, "ms");
