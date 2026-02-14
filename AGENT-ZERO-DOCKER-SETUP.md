# Agent Zero + Monero MCP (Docker)

Run Agent Zero in Docker and attach the Monero MCP server so the agent can read balance and (optionally) send XMR.

## Prerequisites

- Docker on host
- This repo cloned; `npm install` and `npm run build` run on host (or in a build step)
- wallet-rpc running (e.g. `docker compose up -d` in this repo), port **18083** on host

## Agent Zero container with MCP volume

Mount this repo into the Agent Zero container so it can spawn the MCP server:

```bash
docker run -d \
  --name agent-zero \
  -p 50001:50001 \
  -v /path/to/monero-mcp:/monero-mcp \
  -e MONERO_RPC_HOST=host.docker.internal \
  -e MONERO_RPC_PORT=18083 \
  <your-agent-zero-image>
```

Replace `/path/to/monero-mcp` with the absolute path to this repo. Ensure `build/index.js` exists (`npm run build`).

## MCP config (copy-paste)

In Agent Zero → Settings → MCP, add a server with:

| Field   | Value |
|--------|--------|
| Name   | `monero` (or any name) |
| Command | `node` |
| Args    | `/monero-mcp/build/index.js` |

**Environment** (in the same MCP server config):

```env
MONERO_RPC_HOST=host.docker.internal
MONERO_RPC_PORT=18083
MONERO_NETWORK=mainnet
MONERO_ALLOW_TRANSFERS=false
```

- `MONERO_ALLOW_TRANSFERS=false` → read-only (balance, address, height, transfers). Set to `true` only if you want the agent to send XMR (and configure allowlists/limits).

## Verify

- From host: `curl -s -X POST http://localhost:18083/json_rpc -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":"0","method":"get_height"}'`
- Inside container: `docker exec agent-zero ls /monero-mcp/build/index.js`
- In Agent Zero UI, ask the agent to check your Monero balance (it will use the MCP `get_balance` tool).

## Troubleshooting

- **"No connection to daemon"** – wallet-rpc can’t reach the remote node. Change `--daemon-address` in `docker-compose.yml` to a fallback node (see README → Remote nodes) and recreate: `docker compose up -d --force-recreate wallet-rpc`.
- **Balance 0 / wrong** – Ensure wallet-rpc is synced (check `get_height`) and that you’re on mainnet if you expect mainnet funds.
