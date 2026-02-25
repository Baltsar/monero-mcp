FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:20-alpine

WORKDIR /app
COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
COPY .env.example ./

# MCP server communicates over stdio
# Environment variables configure the connection to monero-wallet-rpc
ENV NODE_ENV=production

ENTRYPOINT ["node", "build/index.js"]
