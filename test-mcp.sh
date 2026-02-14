#!/usr/bin/env bash
# Build and run MCP-related checks. Ensures node_modules exist before build.
set -e
cd "$(dirname "$0")"

if [ ! -d "node_modules" ] || [ ! -f "node_modules/.bin/tsc" ]; then
  echo "node_modules missing or tsc not found. Running npm install..."
  npm install
fi

echo "Building..."
npm run build

echo "Running MCP stdio handshake test..."
node test-mcp-stdio.mjs
