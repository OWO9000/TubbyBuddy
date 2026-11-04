const fs = require("fs");
const path = require("path");

const from = path.resolve(__dirname, "..", "..", "web", "dist");
const to = path.resolve(__dirname, "..", "web");

if (!fs.existsSync(path.join(from, "index.html"))) {
  console.error("web/dist/index.html is missing. Run `npm run build -w web` first.");
  process.exit(1);
}
fs.rmSync(to, { recursive: true, force: true });
fs.cpSync(from, to, { recursive: true });
console.log(`Copied ${from} -> ${to}`);
