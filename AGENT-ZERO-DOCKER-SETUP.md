# Agent Zero + Monero MCP (Docker)

Run Agent Zero in Docker and attach the Monero MCP server so the agent can read balance and (optionally) send XMR.

## Wallet persistence (critical)

If the Agent Zero or wallet-rpc container is recreated or removed, the wallet can be lost unless it lives on the host or on a **persistent volume**. Plan for this up front.

**Where the wallet actually lives**

The wallet is **not** created or stored by MCP or Agent Zero. It is created and stored by **monero-wallet-rpc** wherever that process runs, in the directory set by its `--wallet-dir`. MCP only sends RPC calls (e.g. get_balance, get_address) to wallet-rpc. So: if wallet-rpc was running inside the Agent Zero container, the wallet was created in that container’s filesystem and is lost when that container stops or is recreated.

**Do not run monero-wallet-rpc inside the Agent Zero container.** Run wallet-rpc on the host or in a **separate** container with a persistent volume.

**Option A – Wallet on host (recommended, most robust)**

- Run `monero-wallet-rpc` on the host machine (not in Docker). Store wallet files in a normal directory, e.g. `~/monero-wallet/`.
- Run Agent Zero in Docker as usual. Point MCP at `host.docker.internal:18083`.
- **Effect:** Containers can be recreated or removed without affecting the wallet. The wallet does not depend on Docker.

**Option B – Wallet in Docker**

- If you run wallet-rpc in Docker, **always** use a persistent volume for the wallet directory (e.g. `wallet-data:/wallet` in this repo’s `docker-compose.yml`). Optionally use a host bind mount (e.g. `./wallet-data:/wallet`) so files sit in a visible folder on the host.
- **Never** run `docker compose down -v` if you want to keep the wallet; `-v` removes volumes.
- **Effect:** The same volume is reused when the container is recreated, so the wallet survives.

**Backup (required either way)**

- Write down and securely store the 25-word seed.
- Back up the wallet file and its `.keys` file to another location (another disk, backup storage).
- To restore from seed: `monero-wallet-cli --restore-deterministic-wallet`.

**Verification (e.g. on the host Mac)**

- If you run wallet-rpc on the host: confirm wallet files exist in the directory you use for `--wallet-dir` (e.g. `~/monero-wallet/`). If that directory is empty or missing after a “wallet disappeared” incident, the wallet was never on the host (it was created elsewhere, e.g. inside a container).
- If you use this repo’s `docker compose`: the wallet lives in the **wallet-rpc** service’s volume `wallet-data`, not in the Agent Zero container. Do not run wallet-rpc inside the Agent Zero container.

---

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
- **Wallet disappeared after container was recreated** – The wallet was not on a persistent volume or on the host. Often this means wallet-rpc was running inside the Agent Zero container (so the wallet lived only in that container’s filesystem). See [Wallet persistence (critical)](#wallet-persistence-critical) above. Prefer running wallet-rpc on the host, or always use a separate container with a volume for the wallet directory and avoid `docker compose down -v`.
- **Verify where your wallet is** – On the host, check for wallet files in the directory where wallet-rpc was started (e.g. `~/monero-wallet/` or the path passed to `--wallet-dir`). If you use this repo’s `docker compose`, the wallet lives in the **wallet-rpc** container’s volume `wallet-data`, not in the Agent Zero container. If you did not start wallet-rpc on the host and did not use a separate container with a volume, the wallet may have been created inside the Agent Zero container and is lost if that container was removed.
