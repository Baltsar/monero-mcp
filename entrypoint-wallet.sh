#!/bin/sh
# Entrypoint for monero-wallet-rpc in Docker.
# We only prepend --non-interactive and --confirm-external-bind.
# Binding (--rpc-bind-ip, --rpc-bind-port) MUST come from docker-compose
# so they are not specified more than once. For 0.0.0.0, both
# --rpc-bind-ip=0.0.0.0 (in compose) and --confirm-external-bind (here) are required.
#
# Then we start wallet-rpc in background, create/open "default" wallet so get_address works, and keep it running.
set -e

WALLET_NAME="default"
RPC="http://127.0.0.1:18083"

monero-wallet-rpc --non-interactive --confirm-external-bind "$@" &
PID=$!

# Wait for RPC
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if command -v curl >/dev/null 2>&1 && curl -s -X POST "$RPC/json_rpc" -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":"0","method":"get_height"}' >/dev/null 2>&1; then
    break
  fi
  if [ "$i" -eq 20 ]; then
    kill $PID 2>/dev/null || true
    exit 1
  fi
  sleep 1
done

# Create wallet if /wallet is empty, then open (requires curl in image; else run ./init-wallet.sh from host once)
if command -v curl >/dev/null 2>&1; then
  if [ -z "$(ls -A /wallet 2>/dev/null)" ]; then
    curl -s -X POST "$RPC/json_rpc" -H "Content-Type: application/json" \
      -d "{\"jsonrpc\":\"2.0\",\"id\":\"0\",\"method\":\"create_wallet\",\"params\":{\"filename\":\"$WALLET_NAME\",\"language\":\"English\"}}" >/dev/null
  fi
  curl -s -X POST "$RPC/json_rpc" -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":\"0\",\"method\":\"open_wallet\",\"params\":{\"filename\":\"$WALLET_NAME\"}}" >/dev/null
fi

wait $PID
