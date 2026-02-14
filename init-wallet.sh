#!/usr/bin/env bash
# Create default wallet if none exists. Run once after first 'docker compose up -d'.
# Usage: ./init-wallet.sh  (uses WALLET_RPC_URL=http://localhost:18083)
set -e
WALLET_RPC_URL="${WALLET_RPC_URL:-http://localhost:18083}"
WALLET_NAME="${WALLET_NAME:-default}"

echo "Creating wallet '$WALLET_NAME' at $WALLET_RPC_URL if needed..."
CREATED=$(curl -s -X POST "$WALLET_RPC_URL/json_rpc" \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":\"0\",\"method\":\"create_wallet\",\"params\":{\"filename\":\"$WALLET_NAME\",\"language\":\"English\"}}")
if echo "$CREATED" | grep -q '"result"'; then
  echo "Wallet created or already exists."
else
  # May already exist (open_wallet for subsequent use)
  curl -s -X POST "$WALLET_RPC_URL/json_rpc" \
    -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":\"0\",\"method\":\"open_wallet\",\"params\":{\"filename\":\"$WALLET_NAME\"}}" >/dev/null
  echo "Wallet opened."
fi
