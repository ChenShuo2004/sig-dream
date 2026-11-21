FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json .npmrc ./
COPY packages/canvas-agent ./packages/canvas-agent
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build:agent && npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/release/canvas-agent.tgz ./canvas-agent.tgz

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/healthz || exit 1

CMD ["node", "server/index.mjs"]
