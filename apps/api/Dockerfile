FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl

# ─── Dependencies ─────────────────────────────────────────────────────────────
FROM base AS deps
COPY package*.json ./
RUN npm ci --omit=dev

# ─── Builder ──────────────────────────────────────────────────────────────────
FROM base AS builder
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

# ─── Production ───────────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/prisma ./prisma
COPY package*.json ./

EXPOSE 3001
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
