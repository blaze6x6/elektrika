FROM node:22-alpine AS base

# ── 1. Vse odvisnosti (za gradnjo) ──
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json* ./
# Z lockfilom so gradnje ponovljive (npm ci). Brez njega (prvi zagon) pade nazaj na npm install.
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# ── 2. Samo produkcijske odvisnosti (za runtime in skripte) ──
FROM base AS proddeps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi \
 && npm cache clean --force

# ── 3. Gradnja aplikacije ──
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
# Next.js ob gradnji uvozi db modul; pravi URL se uporabi šele ob zagonu.
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"

RUN npm run build

# ── 4. Produkcijska slika ──
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# samo produkcijski node_modules (brez eslint, typescript, drizzle-kit ...)
COPY --from=proddeps --chown=nextjs:nodejs /app/node_modules ./node_modules

COPY --chown=nextjs:nodejs db/migrations ./db/migrations
COPY --chown=nextjs:nodejs scripts ./scripts
COPY --chown=nextjs:nodejs docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/api/health" >/dev/null 2>&1 || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
