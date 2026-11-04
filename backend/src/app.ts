import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { APP_NAME, APP_TAGLINE, config } from "./config.js";
import { seed } from "./seed.js";
import { errorHandler } from "./http.js";
import { isAiConfigured } from "./meta.js";
import { nudges } from "./routes/nudges.js";
import { merchant } from "./routes/merchant.js";
import { points } from "./routes/points.js";
import { agent } from "./routes/agent.js";
import { assistant } from "./routes/assistant.js";
import { report } from "./routes/report.js";
import { auth } from "./routes/auth.js";
import { googleConfigured, requireProfileAccess } from "./auth.js";
import { aiLimit, writeLimit } from "./rateLimit.js";

/**
 * True when the server's own files on disk are newer than the running process: someone updated the app but this
 * server window is still running the old code. The apps show a "restart the server" note.
 */
const STARTED_AT = Date.now();
const CODE_DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
function serverIsStale(): boolean {
  try {
    const stack = [CODE_DIR];
    while (stack.length) {
      const dir = stack.pop()!;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) stack.push(p);
        else if (e.name.endsWith(".js") && fs.statSync(p).mtimeMs > STARTED_AT + 2000) return true;
      }
    }
  } catch {
    /* unreadable: assume current */
  }
  return false;
}

export function createApp() {
  seed();
  const app = express();
  app.disable("x-powered-by");
  // Set TRUST_PROXY=true when hosted behind a reverse proxy so rate limits key on the real client IP.
  if (process.env.TRUST_PROXY === "true") app.set("trust proxy", 1);
  app.use(cors());
  app.use(express.json({ limit: "12mb" }));

  app.get("/api/health", (_req, res) =>
    res.json({
      ok: true,
      app: APP_NAME,
      tagline: APP_TAGLINE,
      model: config.textModel,
      imageModel: config.imageModel,
      metaConfigured: isAiConfigured(),
      aiMode: isAiConfigured() ? "live" : "demo",
      assistantConfigured: isAiConfigured(),
      assistantMode: isAiConfigured() ? "live" : "demo",
      assistantModel: config.textModel,
      googleSignIn: googleConfigured(),
      stale: serverIsStale(),
    }),
  );
  // Every route that can call a Meta model also gets a per-IP hourly cap.
  app.use(
    ["/api/assistant/chat", "/api/assistant/hello", "/api/nudge", "/api/nudges/batch", "/api/cosmetic/generate",
      "/api/merchant/offer-from-photo", "/api/agent/discover-merchants", /^\/api\/redemptions\/[^/]+\/verify-proof/],
    aiLimit(),
  );
  app.use("/api", auth);
  // Signed-in profiles need their session token; guest and demo profiles keep working with the id alone.
  app.use("/api", requireProfileAccess);
  app.use("/api", writeLimit(), nudges, merchant, points, agent, assistant, report);
  app.use("/api", (_req, res) => res.status(404).json({ error: "not_found" }));

  app.use("/media", express.static(config.mediaDir, { maxAge: "1d" }));

  // Serve the built web app (single URL hosts everything).
  if (fs.existsSync(config.webDist)) {
    app.use(express.static(config.webDist));
    app.get(/^\/(?!api|media).*/, (_req, res) => res.sendFile(path.join(config.webDist, "index.html")));
  }
  app.use(errorHandler);
  return app;
}
