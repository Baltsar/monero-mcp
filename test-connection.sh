#!/usr/bin/env bash
# Wait for wallet-rpc and print mainnet receive address.
# Requires: curl. For reliable address parsing, install jq (optional).
set -e

MONEROD_URL="${MONEROD_URL:-http://localhost:18081}"
WALLET_RPC_URL="${WALLET_RPC_URL:-http://localhost:18083}"
MAX_WAIT="${MAX_WAIT:-60}"

echo "Waiting for wallet-rpc at $WALLET_RPC_URL (max ${MAX_WAIT}s)..."
for i in $(seq 1 "$MAX_WAIT"); do
  if curl -s -X POST "$WALLET_RPC_URL/json_rpc" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":"0","method":"get_height"}' >/dev/null 2>&1; then
    echo "wallet-rpc is up."
    break
  fi
  if [ "$i" -eq "$MAX_WAIT" ]; then
    echo "Timeout waiting for wallet-rpc." >&2
    exit 1
  fi
  sleep 1
done

echo ""
echo "--- Mainnet receive address ---"
RESP=$(curl -s -X POST "$WALLET_RPC_URL/json_rpc" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"0","method":"get_address","params":{"address_index":[0]}}')

# Robust extraction: works with multiline JSON. Prefer jq if available.
if command -v jq >/dev/null 2>&1; then
  ADDR=$(echo "$RESP" | jq -r '.result.address // empty')
else
  ADDR=$(echo "$RESP" | grep -o '"address"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/^.*"address"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
fi

if [ -z "$ADDR" ]; then
  echo "(could not parse address; raw response below)" >&2
  echo "$RESP" >&2
  exit 1
fi
echo "$ADDR"
echo ""
echo "Send XMR to this address. Use docker compose (or your wallet-rpc) for receiving."
