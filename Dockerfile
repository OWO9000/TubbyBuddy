# Backend + built web app in one image. Mount a volume at /data for the SQLite database and uploads.
FROM node:22-bookworm-slim AS build
# Toolchain for native modules (better-sqlite3) when no prebuilt binary matches.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json brand.json ./
COPY backend/package.json backend/
COPY web/package.json web/
RUN npm ci --no-audit --no-fund
COPY backend backend
COPY web web
RUN npm run build && npm prune --omit=dev && mkdir -p backend/node_modules

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data MEDIA_DIR=/data/media TRUST_PROXY=true
COPY --from=build /app/package.json /app/brand.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/backend/package.json backend/
COPY --from=build /app/backend/node_modules backend/node_modules
COPY --from=build /app/backend/dist backend/dist
# The demo business directory is read from source JSON at runtime.
COPY --from=build /app/backend/src/data backend/src/data
COPY --from=build /app/web/dist web/dist
EXPOSE 8787
CMD ["node", "backend/dist/server.js"]
