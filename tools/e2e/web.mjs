import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";

const EDGE = process.env.EDGE ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const OUT = process.env.SHOTS ?? "shots";
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const errors = [];
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--window-size=1440,1100"],
  defaultViewport: { width: 1440, height: 1100 },
});
const page = await browser.newPage();
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});

const text = () => page.evaluate(() => document.body.innerText);
const count = async (sel) => (await page.$$(sel)).length;
const clickText = async (needle, sel = "button, a, label") => {
  const ok = await page.evaluate(
    (t, q) => {
      const el = [...document.querySelectorAll(q)].find((e) => (e.textContent || "").trim().includes(t) && e.getBoundingClientRect().width > 0);
      if (!el) return false;
      el.click();
      return true;
    },
    needle,
    sel,
  );
  if (!ok) throw new Error(`no clickable "${needle}"`);
  await sleep(400);
};
const waitFor = async (fn, timeout = 20000, step = 250) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await fn()) return true;
    await sleep(step);
  }
  return false;
};
const bubble = () => page.evaluate(() => document.querySelector(".speech")?.textContent?.trim() ?? "");
const deviceId = () => page.evaluate(() => localStorage.getItem("tubbybuddy.deviceId"));
const nav = (label) => page.evaluate((l) => [...document.querySelectorAll(".dock a")].find((a) => a.textContent?.includes(l))?.click(), label);

await page.goto(BASE, { waitUntil: "networkidle2" });

// ---- first run: welcome stage (sign-in), then the setup conversation on the same stage
const advance = async () => {
  for (let i = 0; i < 15; i++) {
    await sleep(600);
    const more = await page.$(".dialogue-text.can-advance");
    if (!more) break;
    await more.click();
  }
  await sleep(500);
};
const answer = (t) => clickText(t, ".dialogue-answers button");
check("welcome stage appears for a new visitor", await waitFor(async () => (await page.$(".intro .dialogue")) !== null, 15000));
await advance();
check("welcome asks to sign in or try the demo", (await text()).includes("Look around with a demo account") && !!(await page.$(".intro-title")));
check("menu bar and dock hidden behind the stage", await page.evaluate(() => getComputedStyle(document.querySelector(".menubar")).visibility === "hidden"));
await page.screenshot({ path: path.join(OUT, "new-welcome.png") });
// Google can't be automated here: continue as a guest profile.
await page.evaluate(() => { localStorage.setItem("tubbybuddy.guest.v1", "1"); });
await page.reload({ waitUntil: "networkidle2" });
check("setup conversation starts", await waitFor(async () => (await page.$(".intro .dialogue")) !== null, 15000));
await advance();
check("tubby introduces itself", (await text()).includes("Extremely pink"));
await page.screenshot({ path: path.join(OUT, "new-onboarding.png") });
await answer("What do you do?");
await advance();
check("'What do you do?' is gone once answered", !(await text()).includes("What do you do?"));
await answer("Let's set me up");
await advance();
check("goals question arrives", (await text()).includes("what do you want more time for"));
await answer("Read more books");
await page.type(".intro-composer input", "I want to study more and go outside more");
await page.keyboard.press("Enter");
await sleep(1500);
await advance();
check("typed goals are split into separate chips", await waitFor(async () => (await page.$$eval(".intro .pick-chip.on", (els) => els.map((e) => e.textContent.toLowerCase()))).filter((t) => t.includes("study") || t.includes("outside")).length >= 2, 25000));
await advance();
await waitFor(async () => page.evaluate(() => [...document.querySelectorAll(".dialogue-answers button")].some((b) => b.textContent.includes("That's all") && !b.disabled)), 10000);
await answer("That's all");
await advance();
check("apps question arrives", (await text()).includes("time thieves"));
await answer("TikTok");
await answer("That's all");
await advance();
check("plan summary arrives", (await text()).includes("Here's the plan"));
await answer("Deal. Let's go!");
await advance();
check("web-only note about the apps", (await text()).includes("Windows and Android apps"));
await answer("Let's go");
check("stage closes and is remembered", await waitFor(async () => (await page.$(".intro")) === null, 8000) && (await page.evaluate(() => localStorage.getItem("tubbybuddy.onboarded.v2") === localStorage.getItem("tubbybuddy.deviceId"))));
check("onboarding saved goals + apps", await page.evaluate(async () => {
  const id = localStorage.getItem("tubbybuddy.deviceId");
  const r = await fetch("/api/assistant/settings", { headers: { "x-device-id": id } });
  const j = await r.json();
  return j.settings.goals.includes("Read more books") && j.settings.apps.includes("TikTok");
}));

check("hello arrives", await waitFor(async () => (await count(".msg.assistant .bubble:not(.typing)")) >= 1 && (await bubble()).length > 8, 25000));
check("brand and 5-tab dock", (await text()).includes("TubbyBuddy") && (await count(".dock .aqua-dock-item")) === 5, String(await count(".dock .aqua-dock-item")));
check("customer-only: no merchant or scout nav", !(await text()).includes("For businesses") && !(await text()).includes("Merchant scout"));
check("cat is present", (await page.evaluate(() => {
  const img = document.querySelector(".cat-wrap img");
  const canvas = document.querySelector(".cat-wrap canvas");
  return (img && img.naturalWidth > 0) || !!canvas;
})) === true);
check("chat greeting in transcript", (await count(".msg.assistant")) >= 1);
check("starter suggestions visible", (await count(".chat-starter .suggestion")) >= 3);
await page.screenshot({ path: path.join(OUT, "new-home.png") });

// ---- chat
const before = await bubble();
await clickText("I want to scroll", ".suggestion");
check("assistant replies", await waitFor(async () => (await count(".msg.assistant .bubble:not(.typing)")) >= 2 && (await page.$(".typing")) === null, 30000));
const reply = await page.evaluate(() => {
  const msgs = [...document.querySelectorAll(".msg.assistant .bubble:not(.typing)")];
  return msgs[msgs.length - 1]?.textContent?.trim() ?? "";
});
check("reply is short and non-empty", reply.length > 8 && reply.length < 400, reply.slice(0, 100));
check("speech bubble follows the reply", (await bubble()) === reply);
check("mood changed after the message", before !== (await bubble()));
await page.screenshot({ path: path.join(OUT, "new-chat.png") });

// ---- chat-driven mode switch
await page.type(".composer input", "can we do night mode?");
await page.click(".send-btn");
check("mode request gets a confirmation", await waitFor(async () => (await text()).includes("Turn it on?"), 15000));
await waitFor(async () => (await page.$(".chat-unlock-confirm .suggestion.on")) !== null, 5000);
await clickText("Turn on Night", ".suggestion");
check("night mode applied from chat", await page.evaluate(async () => {
  const id = localStorage.getItem("tubbybuddy.deviceId");
  const r = await fetch("/api/assistant/settings", { headers: { "x-device-id": id } });
  const j = await r.json();
  return j.settings?.apps?.includes("Netflix");
}));

check("voice controls are hidden for now", (await count(".mic-btn")) === 0 && (await count(".chat-tools .icon-btn[aria-pressed]")) === 0);

await page.reload({ waitUntil: "networkidle2" });
await sleep(1800);
check("chat survives reload", (await count(".msg")) >= 3, String(await count(".msg")));
check("bubble restores last reply", (await bubble()).length > 8);

// ---- focus session
await clickText("Start a focus session");
await sleep(500);
check("focus setup shows 3 durations", (await count(".duration")) === 3);
await clickText("15");
await clickText("Start 15 minutes");
check("focus timer runs", await waitFor(async () => (await count(".focus-ring")) === 1 && (await page.$(".focus-time b")) !== null, 4000));
await page.screenshot({ path: path.join(OUT, "new-focus-running.png") });
await clickText("I'm tempted");
check("Tubby answers the temptation", await waitFor(async () => {
  const t = await page.evaluate(() => document.querySelector(".focus-line")?.textContent?.trim() ?? "");
  return t.length > 10 && !t.includes("thinking");
}, 25000));
await clickText("End session");
check("early end is handled", await waitFor(async () => (await text()).includes("Stopped early"), 4000));
await page.keyboard.press("Escape");
await sleep(400);

// ---- grant points for redemption and browse rewards
const dev = await deviceId();
await page.evaluate(async (d) => {
  await fetch("/api/points/earn", { method: "POST", headers: { "content-type": "application/json", "x-device-id": d }, body: JSON.stringify({ deviceId: d, event: "demo_grant", amount: 500 }) });
}, dev);
await page.reload({ waitUntil: "networkidle2" });
await sleep(1200);
await nav("Rewards");
await sleep(1200);
check("rewards lists offers", (await count(".offer")) >= 3, String(await count(".offer")));
await page.evaluate(() => [...document.querySelectorAll(".offer")].find((o) => o.textContent.includes("Any latte"))?.querySelector("button")?.click());
check("redeem dialog opens", await waitFor(async () => (await text()).includes("Spend 250 pts"), 5000));
await clickText("Spend 250 pts");
check("code and QR issued", await waitFor(async () => (await page.$(".bigcode")) !== null && (await page.$(".qr")) !== null, 6000));
await page.screenshot({ path: path.join(OUT, "new-redeem.png") });
await page.keyboard.press("Escape");
await sleep(500);
await clickText("My codes");
check("redemption stored under My codes", (await count(".code-card")) === 1);
await page.screenshot({ path: path.join(OUT, "new-rewards.png"), fullPage: true });

// ---- cosmetics
await nav("Cosmetics");
await sleep(1200);
check("fur tab opens first with 7 colors", (await count(".store-item")) === 7, String(await count(".store-item")));
check("characters row: Tubby + 3 teasers", (await count(".character-slot")) === 4, String(await count(".character-slot")));
check("cosmetics stage previews Tubby", (await count(".cosmetics-stage .companion-2d, .cosmetics-stage canvas")) >= 1);
await clickText("Accessories", ".rewards-tabs button");
await sleep(400);
check("accessories tab lists 6 coming-soon props", (await count(".store-item.soon")) === 6 && (await page.$$eval(".store-item.soon button", (bs) => bs.every((b) => b.disabled))));
await clickText("Fur", ".rewards-tabs button");
await sleep(400);
await clickText("Unlock", ".store-item button");
check("fur purchase equips it", await waitFor(async () => {
  const id = await page.evaluate(() => localStorage.getItem("tubbybuddy.deviceId"));
  const me = await page.evaluate(async (d) => (await fetch("/api/me", { headers: { "x-device-id": d } })).json(), id);
  return me.equipped?.color === "color-mint";
}, 8000));
const canvasCount = await count(".cosmetics-stage canvas");
check("fur renders on the cat", canvasCount >= 1, `canvas=${canvasCount}`);
await page.screenshot({ path: path.join(OUT, "new-cosmetics.png"), fullPage: true });

// ---- achievements
await nav("Achievements");
await sleep(800);
check("11 achievement cards", (await count(".ach-card")) === 11, String(await count(".ach-card")));
check("progress bars rendered", (await count(".ach-card .progress")) === 11);
check("patterns card shows 14 days", (await count(".patterns-bars .bar")) === 14, String(await count(".patterns-bars .bar")));
await page.screenshot({ path: path.join(OUT, "new-achievements.png"), fullPage: true });

// ---- settings
await nav("Settings");
await sleep(900);
check("four coach tones", (await count(".tone-card")) === 4);
await clickText("Direct", ".tone-card");
check("tone selection updates", await page.evaluate(() => {
  const el = [...document.querySelectorAll(".tone-card")].find((e) => e.textContent?.includes("Direct"));
  return el?.getAttribute("aria-checked") === "true";
}));
await page.reload({ waitUntil: "networkidle2" });
await sleep(1200);
check("tone persists across reload", await page.evaluate(() => {
  const el = [...document.querySelectorAll(".tone-card")].find((e) => e.textContent?.includes("Direct"));
  return el?.getAttribute("aria-checked") === "true";
}));
check("no voice setting while voice is off", (await page.evaluate(() => document.body.innerText.includes("Speak to Tubby with the microphone"))) === false);
await clickText("Open preview");
check("block-screen preview opens", await waitFor(async () => (await count(".intercept-preview .app-icon")) >= 3, 5000));
await page.screenshot({ path: path.join(OUT, "new-settings-preview.png") });
await page.keyboard.press("Escape");
await sleep(400);
await page.screenshot({ path: path.join(OUT, "new-settings.png"), fullPage: true });

// ---- focus modes
check("six focus modes listed", (await count(".mode-card")) === 6, String(await count(".mode-card")));
await clickText("Night", ".mode-card");
await sleep(700);
check("night mode applies its app list", await page.evaluate(async () => {
  const id = localStorage.getItem("tubbybuddy.deviceId");
  const r = await fetch("/api/assistant/settings", { headers: { "x-device-id": id } });
  const j = await r.json();
  return j.settings?.apps?.includes("Netflix") && j.settings?.apps?.length === 5;
}));

// ---- mobile
await page.setViewport({ width: 390, height: 844 });
// "load" + an explicit element wait: networkidle can stall on this step while the 3D model streams from a blob URL.
await page.goto(BASE, { waitUntil: "load" });
await page.waitForSelector(".stage-actions", { timeout: 15000 });
await sleep(1800);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check("no mobile horizontal overflow", overflow === 0, `overflow=${overflow}`);
check("dock fits mobile", await page.evaluate(() => {
  const r = document.querySelector(".dock")?.getBoundingClientRect();
  return !!r && r.left >= 0 && r.right <= window.innerWidth;
}));
check("primary action clears the dock", await page.evaluate(() => {
  const a = document.querySelector(".stage-actions")?.getBoundingClientRect();
  const d = document.querySelector(".dock")?.getBoundingClientRect();
  return !!a && !!d && a.bottom <= d.top;
}), await page.evaluate(() => {
  const a = document.querySelector(".stage-actions")?.getBoundingClientRect();
  const d = document.querySelector(".dock")?.getBoundingClientRect();
  return `actions=${Math.round(a?.bottom ?? 0)} dock=${Math.round(d?.top ?? 0)}`;
}));
await page.screenshot({ path: path.join(OUT, "new-mobile.png") });

// Google rejects origins that are not on the client (e.g. 127.0.0.1 in CI); that is setup, not an app error.
const meaningful = errors.filter((e) => !/WebGL|THREE|Failed to load resource|GSI_LOGGER.*origin is not allowed/i.test(e));
check("no console/page errors", meaningful.length === 0, meaningful.slice(0, 3).join(" | "));

console.log("\nERRORS:", JSON.stringify(errors.slice(0, 10), null, 2));
fs.writeFileSync(path.join(OUT, "new-results.json"), JSON.stringify({ results, errors }, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
