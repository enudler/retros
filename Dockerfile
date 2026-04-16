FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Runtime image ────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Only production deps
COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY public ./public

# SQLite data lives here; mount a volume to persist it
RUN mkdir -p /app/data
VOLUME ["/app/data"]

ENV NODE_ENV=production
ENV PORT=3333
ENV DB_PATH=/app/data/retro.db

EXPOSE 3333

CMD ["node", "dist/index.js"]
