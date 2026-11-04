// Generates the reward and badge artwork with Muse Image into web/public/art/.
// Run from /backend: npx tsx --env-file=../.env scripts/generate-art.ts [offers|badges] [id ...]
// Existing files are kept; delete one to regenerate it. The committed files were then downscaled
// (offers to 800 px, badges to 256 px, WebP) to keep the web bundle and APK light.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateImage } from "../src/meta.js";
import { DEMO_OFFERS } from "../src/offerCatalog.js";

const STYLE =
  "Glossy, airy illustration: sky blue, white and aqua palette, soft daylight, gentle reflections, clean and bright. No text, no letters, no logos, no faces.";
const BADGE =
  "A single glossy, toy-like 3D emblem object centered on a plain soft sky-blue gradient background, rounded shapes, subtle glass highlights, generous empty margin. No text, no letters, no logos.";

const OFFERS: Record<string, string> = Object.fromEntries(DEMO_OFFERS.map((o) => [o.id, o.art]));

const BADGES: Record<string, string> = {
  "first-resist": "a smartphone lying face-down on a soft white cushion with a small glowing aqua check mark above it",
  "resist-10": "a shiny chrome thumbs-up trophy on a small round pedestal",
  "resist-50": "a smooth pale stone standing firm while soft wind swirls bend around it",
  "first-session": "a glossy round target with an aqua arrow in the bullseye",
  "session-10": "a glass hourglass with glowing aqua sand",
  "streak-3": "a glossy aqua ball rolling forward with three small sparkles trailing behind",
  "streak-7": "a shiny trophy cup with seven tiny stars circling it",
  "earned-1000": "a glass jar full of glowing aqua coins",
  "first-redeem": "a golden ticket stub with a small silver key resting on it",
  "proof": "an instant photo of a cafe table with a latte, with a small sparkle in the corner",
  "first-cosmetic": "a paint palette with pink, mint and blue paint blobs and a small brush",
};

const outDir = fileURLToPath(new URL("../../web/public/art/", import.meta.url));
const [kind = "all", ...only] = process.argv.slice(2);
const jobs: { file: string; prompt: string }[] = [];
if (kind === "all" || kind === "offers")
  for (const [id, p] of Object.entries(OFFERS)) jobs.push({ file: path.join(outDir, "offers", `${id}.webp`), prompt: `${p} ${STYLE}` });
if (kind === "all" || kind === "badges")
  for (const [id, p] of Object.entries(BADGES)) jobs.push({ file: path.join(outDir, "badges", `${id}.webp`), prompt: `${BADGE} The object: ${p}.` });

const todo = jobs.filter((j) => (only.length === 0 || only.some((id) => j.file.includes(id))) && !fs.existsSync(j.file));
await Promise.all(
  todo.map(async (j, i) => {
    // Stagger requests so a dozen images don't hit the API in the same second.
    await new Promise((r) => setTimeout(r, i * 1500));
    const r = await generateImage(j.prompt, "1024x1024");
    fs.mkdirSync(path.dirname(j.file), { recursive: true });
    fs.writeFileSync(j.file, Buffer.from(r.b64, "base64"));
    console.log(`${path.relative(outDir, j.file)}  ${(r.latencyMs / 1000).toFixed(1)}s`);
  }),
);
console.log(`${todo.length} image(s) generated, ${jobs.length - todo.length} kept`);
