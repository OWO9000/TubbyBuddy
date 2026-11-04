import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EDGE = process.env.EDGE ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const EXT = path.resolve(HERE, "../../extension");
const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const OUT = process.env.SHOTS ?? path.resolve(HERE, "shots");
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: [
    "--no-sandbox",
    "--disable-gpu",
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    "--window-size=1280,900",
  ],
  defaultViewport: { width: 1280, height: 900 },
});

// Find the extension id from its service worker target.
let id = "";
for (let i = 0; i < 20 && !id; i++) {
  const t = browser.targets().find((x) => x.url().startsWith("chrome-extension://") && x.type() === "service_worker");
  if (t) id = new URL(t.url()).host;
  else await sleep(400);
}
check("extension service worker loaded", !!id, id);
if (!id) {
  await browser.close();
  process.exit(1);
}

const page = await browser.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await page.goto(`chrome-extension://${id}/src/options/options.html`, { waitUntil: "domcontentloaded" });
await sleep(700);
check("options page rebranded", (await page.evaluate(() => document.body.innerText)).includes("TubbyBuddy options"));
await page.screenshot({ path: path.join(OUT, "ext-options.png") });

// Point the extension at this test server before adding the local origin.
await page.$eval("#backend-url", (el, v) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(el, v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}, BASE);

// Add our local app origin to the blocked list and save.
await page.type("#site-input", "127.0.0.1");
await page.click("#site-add");
await sleep(300);
await page.click("#save");
await sleep(800);
const sites = await page.evaluate(() => document.querySelector("#sites-list")?.innerText ?? "");
check("local origin added to block list", sites.includes("127.0.0.1"), sites.replace(/\n/g, " "));

// Visit the "blocked" site; the content script should draw the Tubby overlay.
const site = await browser.newPage();
await site.goto(`${BASE}/`, { waitUntil: "networkidle2" });
check("overlay injected", await site.evaluate(() => !!document.querySelector("#burn-focus-guard-host")?.shadowRoot));
const info = await site.evaluate(() => {
  const s = document.querySelector("#burn-focus-guard-host")?.shadowRoot;
  return s
    ? {
        text: s.querySelector(".burn-card")?.innerText ?? "",
        img: s.querySelector(".burn-tubby")?.getAttribute("src") ?? "",
        imgLoaded: (s.querySelector(".burn-tubby")?.naturalWidth ?? 0) > 0,
        eyebrow: s.querySelector(".burn-eyebrow")?.textContent ?? "",
      }
    : null;
});
check("overlay says TubbyBuddy", (info?.eyebrow ?? "").includes("TubbyBuddy"), info?.eyebrow ?? "");
check("Tubby art loads", !!info?.imgLoaded, info?.img ?? "");
check("overlay text mentions Tubby", (info?.text ?? "").includes("Tubby"));
await sleep(4500);
const nudge = await site.evaluate(() => document.querySelector("#burn-focus-guard-host")?.shadowRoot?.querySelector("#burn-nudge")?.textContent ?? "");
check("overlay gets a nudge", nudge.length > 10 && !nudge.includes("thinking"), nudge);
await site.screenshot({ path: path.join(OUT, "ext-overlay.png") });

// Continue anyway: overlay closes and points burn.
await site.evaluate(() => document.querySelector("#burn-focus-guard-host")?.shadowRoot?.querySelector("#burn-continue")?.click());
await sleep(2500);
check("continue closes the overlay", !(await site.evaluate(() => !!document.querySelector("#burn-focus-guard-host")?.shadowRoot?.querySelector(".burn-overlay"))));

// Popup
const popup = await browser.newPage();
await popup.setViewport({ width: 360, height: 520 });
await popup.goto(`chrome-extension://${id}/src/popup/popup.html`, { waitUntil: "domcontentloaded" });
await sleep(1500);
const popText = await popup.evaluate(() => document.body.innerText);
check("popup rebranded", popText.includes("TubbyBuddy"));
check("popup shows balance", /Balance/.test(popText));
await popup.screenshot({ path: path.join(OUT, "ext-popup.png") });

fs.writeFileSync(path.join(OUT, "ext-results.json"), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
