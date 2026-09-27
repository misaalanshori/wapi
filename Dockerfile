FROM node:24-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts=false
COPY tsconfig.json tsconfig.build.json ./
COPY src/ ./src/
RUN npm run build

FROM node:24-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       bash ca-certificates git python3 make g++ sqlite3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts=false
COPY --from=builder /app/dist/ ./dist/
COPY pi-agent-home/ ./pi-agent-home/

ENTRYPOINT ["node", "dist/index.js"]
