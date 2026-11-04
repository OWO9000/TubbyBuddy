const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
  ".ico": "image/x-icon",
};

/**
 * Serves the built web app and proxies /api and /media to the configured backend.
 * This keeps the React app on one origin, so its relative fetch("/api/...") calls work
 * in the packaged desktop app exactly like they do on the web.
 */
function startDesktopServer({ webDir, getBackendUrl, getSessionToken = () => null, port = 0 }) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (url.pathname.startsWith("/api") || url.pathname.startsWith("/media")) {
        // Only the dashboard itself may use this proxy: a page on another origin never gets the signed-in session.
        const own = `http://127.0.0.1:${server.address().port}`;
        const origin = req.headers.origin;
        if (origin && origin !== own) {
          res.writeHead(403, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "forbidden_origin" }));
          return;
        }
        proxy(req, res, url, getBackendUrl(), getSessionToken());
        return;
      }
      serveStatic(res, url.pathname, webDir);
    });
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

function proxy(req, res, url, backendUrl, sessionToken) {
  let base;
  try {
    base = new URL(backendUrl);
  } catch {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Desktop backend URL is invalid" }));
    return;
  }
  const lib = base.protocol === "https:" ? https : http;
  const targetPath = base.pathname.replace(/\/$/, "") + req.url;
  const headers = { ...req.headers, host: base.host };
  // The dashboard never holds the session token; the desktop app adds it on the way out.
  if (sessionToken && !headers.authorization) headers.authorization = `Bearer ${sessionToken}`;
  const upstream = lib.request(
    {
      hostname: base.hostname,
      port: base.port || (base.protocol === "https:" ? 443 : 80),
      path: targetPath,
      method: req.method,
      headers,
    },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json" });
    }
    res.end(JSON.stringify({ error: `Backend unreachable: ${err.message}` }));
  });
  req.pipe(upstream);
}

function serveStatic(res, pathname, webDir) {
  let decoded = "/";
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    /* keep / */
  }
  const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  let file = path.join(webDir, normalized);
  if (!file.startsWith(path.normalize(webDir))) file = path.join(webDir, "index.html");
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(webDir, "index.html");
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("Could not load the web app. Run `npm run build -w web` first.");
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      "content-type": MIME[ext] || "application/octet-stream",
      "cache-control": ext === ".html" ? "no-store" : "public, max-age=3600",
    });
    res.end(data);
  });
}

module.exports = { startDesktopServer };
