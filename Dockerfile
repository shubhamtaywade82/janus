# ─── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (layer-cached unless package.json changes)
COPY package*.json ./
RUN npm ci --ignore-scripts

# Copy source and build
COPY . .
RUN npm run build

# ─── Stage 2: Production image ───────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy build artifacts
COPY --from=builder /app/dist ./dist

# Non-root user for least-privilege execution
RUN addgroup -S janus && adduser -S janus -G janus

# Create writable log directory owned by the non-root user
RUN mkdir -p /app/logs && chown janus:janus /app/logs

USER janus

EXPOSE 3010

# Longer start-period: CoinDCX WS + reconciler + LLM init can take ~20s
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3010/health || exit 1

CMD ["node", "dist/boot.js"]
