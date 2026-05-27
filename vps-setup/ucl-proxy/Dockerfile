# SFR Motor — UCL Leasing Proxy
# Node 20 LTS Alpine — malý image, dostatečně rychlý start.
FROM node:20-alpine

WORKDIR /app

# Install deps prvně — Docker cache layer
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Pak kód
COPY server.js ./

# Healthcheck — Docker monitoruje sám
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

EXPOSE 3001

# Spouštěj jako non-root (security)
USER node

CMD ["node", "server.js"]
