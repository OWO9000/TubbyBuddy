import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import brand from "../brand.json";

const api = process.env.API_URL ?? "http://localhost:8787";

export default defineConfig({
  plugins: [
    react(),
    { name: "brand-html", transformIndexHtml: (html) => html.replaceAll("%APP_NAME%", brand.name).replaceAll("%APP_TAGLINE%", brand.tagline) },
  ],
  server: { port: 5173, proxy: { "/api": api, "/media": api } },
});
