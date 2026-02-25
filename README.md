# 🔒 Monero MCP Server

**The world's first MCP server for Monero. Give any AI agent a private wallet.**

---

## What is this?

This is a bridge between AI agents and the Monero network. It lets any AI agent –
OpenClaw, Agent Zero, Claude, or any MCP-compatible framework – check balances,
receive payments, and send XMR through a simple tool interface.

Think of it as: your AI agent gets its own Monero wallet.

## Wait, what's MCP?

MCP (Model Context Protocol) is a standard created by Anthropic that lets AI assistants use external tools. Instead of the AI just generating text, it can call real functions – read files, query databases, or in this case, interact with a Monero wallet.

If you've ever wanted your AI agent to autonomously receive and send XMR –
whether it's an OpenClaw agent running a service, an Agent Zero instance
managing its own budget, or just Claude checking your balance – that's what this does.

## Why Monero? Why not Ethereum or Bitcoin?

Because AI agents need privacy more than humans do.

When a human makes transactions, there's natural noise – you buy coffee at random times, pay rent irregularly, your patterns are chaotic. An AI agent is different. Every transaction follows logic. On a transparent blockchain, anyone can watch an agent's on-chain behavior and reverse-engineer its strategy, its triggers, and how to exploit it.

Monero's privacy-by-default design means an agent's transaction history, balance, and counterparties are hidden. That's not a nice-to-have – it's a security requirement for any autonomous agent handling real value.

**Privacy is not a feature for AI agents. It's infrastructure.**

## Features

**12 tools** covering everything an AI agent needs:

| Category | Tools |
|----------|-------|
| Balance & Info | `get_balance`, `get_address`, `get_height`, `get_version` |
| Transactions | `get_transfers`, `get_transfer_by_txid` |
| Receiving | `create_address`, `make_integrated_address` |
| Sending | `transfer`, `sweep_all`, `confirm_transfer` |
| Validation | `validate_address` |
| Optional (opt-in) | `get_exchange_rate` (XMR/USD, XMR/EUR; set `MONERO_ENABLE_PRICE_FEED=true`) |

**Read-only by default.** Sending XMR requires explicit opt-in via environment variable.

## Security: Built for a hostile world

This server assumes the AI agent will encounter prompt injection attacks – malicious text designed to trick the AI into sending funds to an attacker. The AI is not our security boundary. The MCP server is.

Five defense layers, all configurable:

🛡️ **Address Allowlist** – Lock transfers to known addresses only. Prompt injection can't send to unknown wallets.

🛡️ **Two-Step Confirmation** – Transfers return a preview + one-time token. Must call `confirm_transfer` to execute. Attackers can't predict the token.

🛡️ **Rate Limiting** – Cooldown between transfers + daily XMR limit. Limits damage even if everything else fails.

🛡️ **Audit Log** – Every tool call logged as JSONL. Rejected transfers are logged too – those are the interesting ones.

🛡️ **Input Sanitization** – Strict base58 validation before anything reaches the RPC.

> This is a tool that can move real money. We built the security for that reality.

## Quickstart (5 min)

Get a mainnet receive address and verify the MCP server without downloading the blockchain:

```bash
git clone <this-repo> && cd monero-mcp
npm install && npm run build
docker compose up -d
./test-connection.sh
```

You’ll see your **mainnet receive address**. Send XMR to it. To test the MCP handshake (stdio):

```bash
node test-mcp-stdio.mjs
```

Optional: run the full MCP test script (build + stdio test; runs `npm install` if needed):

```bash
./test-mcp.sh
```

## Claude Desktop Integration

Add to your Claude Desktop config
(`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "monero": {
      "command": "npx",
      "args": ["-y", "monero-mcp@latest"],
      "env": {
        "MONERO_RPC_HOST": "127.0.0.1",
        "MONERO_RPC_PORT": "18082",
        "MONERO_NETWORK": "mainnet",
        "MONERO_ALLOW_TRANSFERS": "false"
      }
    }
  }
}
```

Restart Claude Desktop. Ask: "What's my Monero balance?" to verify.

### Cursor / Claude Code Integration

Add to `.cursor/mcp.json` or Claude Code MCP config:

```json
{
  "mcpServers": {
    "monero": {
      "command": "npx",
      "args": ["-y", "monero-mcp@latest"],
      "env": {
        "MONERO_RPC_HOST": "127.0.0.1",
        "MONERO_RPC_PORT": "18082",
        "MONERO_NETWORK": "stagenet",
        "MONERO_ALLOW_TRANSFERS": "false"
      }
    }
  }
}
```

## Docker

```bash
docker run -e MONERO_RPC_HOST=host.docker.internal \
           -e MONERO_RPC_PORT=18082 \
           -e MONERO_NETWORK=stagenet \
           ghcr.io/baltsar/monero-mcp:latest
```

---

## Agent Zero integration

To use this MCP server with [Agent Zero](https://github.com/agent-zero) in Docker:

1. See **[AGENT-ZERO-DOCKER-SETUP.md](AGENT-ZERO-DOCKER-SETUP.md)** for the container run command and volume mount.
2. **Wallet persistence:** If containers are recreated, the wallet can be lost unless it runs on the host or uses a persistent volume. For the most robust setup, run `monero-wallet-rpc` on the host and point MCP at `host.docker.internal:18083`. Details and backup steps: [AGENT-ZERO-DOCKER-SETUP.md#wallet-persistence-critical](AGENT-ZERO-DOCKER-SETUP.md#wallet-persistence-critical).
3. **Verification (Agent Zero + Docker):** Before relying on your wallet: (1) Confirm wallet-rpc is **not** running inside the Agent Zero container. (2) Confirm wallet files exist on the host (e.g. `~/monero-wallet/`) or that you use this repo’s `docker compose` (wallet lives in the `wallet-data` volume). Full checklist: [AGENT-ZERO-DOCKER-SETUP.md](AGENT-ZERO-DOCKER-SETUP.md) → Verification.
4. In Agent Zero → Settings → MCP, add a server:

| Field   | Value |
|--------|--------|
| Name   | `monero` |
| Command | `node` |
| Args    | `/monero-mcp/build/index.js` |

**Env:** `MONERO_RPC_HOST=host.docker.internal`, `MONERO_RPC_PORT=18083`, `MONERO_NETWORK=mainnet`, `MONERO_ALLOW_TRANSFERS=false` (read-only).

Copy-paste config and troubleshooting: [AGENT-ZERO-DOCKER-SETUP.md](AGENT-ZERO-DOCKER-SETUP.md).

---

## Remote nodes

The default stack uses a **remote node** (no local blockchain sync). Default daemon in `docker-compose.yml`:

- **Default:** `rucknium.me:18081`

If you get "no connection to daemon", change `--daemon-address` in `docker-compose.yml` to one of these and recreate `wallet-rpc`:

- `xmr-node.cakewallet.com:18081`
- `node.moneroworld.com:18089`

To run your own node and download the chain: `docker compose --profile local-node up -d`.

---

## Troubleshooting

| Problem | What to do |
|--------|------------|
| **"no connection to daemon"** | Switch remote node in `docker-compose.yml` (see Remote nodes above) and run `docker compose up -d --force-recreate wallet-rpc`. |
| **Wallet disappeared after container recreated** | Run wallet-rpc on the host, or use a persistent volume for the wallet dir and never run `docker compose down -v`. See [AGENT-ZERO-DOCKER-SETUP.md](AGENT-ZERO-DOCKER-SETUP.md) → Wallet persistence. |
| **Empty address in test-connection.sh** | Install `jq` for reliable JSON parsing, or use the script’s built-in grep fallback (ensure wallet-rpc is up and has an open wallet). |
| **wallet-rpc won’t start** | Check that `entrypoint-wallet.sh` does not add `--rpc-bind-ip` (compose already passes it). You must have `--confirm-external-bind` in the entrypoint for binding to 0.0.0.0. |
| **test-mcp.sh: "tsc: command not found"** | Run `npm install` in the repo first; the script will also run it automatically if `node_modules` is missing. |

---

## Manual setup (no Docker)

### Prerequisites

You need a running `monero-wallet-rpc` instance. If you're just testing:

```bash
# Download Monero CLI from https://getmonero.org/downloads
# Start the daemon on stagenet (test network, no real money)
monerod --stagenet --detach

# Start wallet RPC on stagenet
monero-wallet-rpc --stagenet \
  --rpc-bind-port 38082 \
  --wallet-dir ./wallets \
  --disable-rpc-login
```

### Install & Build

```bash
# From this repo root:
npm install
npm run build
```

### Configure

Copy `.env.example` and edit:

```bash
cp .env.example .env
```

```env
MONERO_RPC_HOST=127.0.0.1
MONERO_RPC_PORT=38082
MONERO_NETWORK=stagenet

# Safety defaults – read only
MONERO_ALLOW_TRANSFERS=false
MONERO_REQUIRE_CONFIRMATION=true
MONERO_TRANSFER_COOLDOWN_SECONDS=60
MONERO_AUDIT_LOG_FILE=./monero-mcp-audit.jsonl
```

### Connect to your agent

This is a standard MCP server using stdio transport.
Connect it to any MCP-compatible agent or framework.

Example – start the server manually:
```bash
node build/index.js
```

The server communicates over stdin/stdout using JSON-RPC (MCP protocol).
Point your agent framework's MCP client config at the binary and you're good.

Works with OpenClaw, Agent Zero, Claude Code, Cursor,
any local LLM setup with MCP support – whatever you run.

### Test with MCP Inspector

```bash
npx @modelcontextprotocol/inspector
```

### MCP Docs

- Protocol: [Model Context Protocol](https://modelcontextprotocol.io)
- TypeScript SDK: [modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk)

## Configuration Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `MONERO_RPC_HOST` | `127.0.0.1` | Wallet RPC host |
| `MONERO_RPC_PORT` | `18082` | Wallet RPC port |
| `MONERO_RPC_USER` | – | RPC username (digest auth) |
| `MONERO_RPC_PASS` | – | RPC password (digest auth) |
| `MONERO_NETWORK` | `mainnet` | `mainnet`, `stagenet`, or `testnet` |
| `MONERO_ALLOW_TRANSFERS` | `false` | Enable send operations |
| `MONERO_MAX_TRANSFER_AMOUNT` | – | Max XMR per single transfer |
| `MONERO_DAILY_LIMIT_XMR` | – | Max XMR sent per rolling 24h |
| `MONERO_TRANSFER_COOLDOWN_SECONDS` | `0` | Min seconds between transfers |
| `MONERO_ALLOWED_ADDRESSES` | – | Comma-separated address allowlist |
| `MONERO_REQUIRE_CONFIRMATION` | `true` | Two-step transfer confirmation |
| `MONERO_AUDIT_LOG_FILE` | – | Path for JSONL audit log |
| `MONERO_ENABLE_PRICE_FEED` | `false` | Enable `get_exchange_rate` (external API; see privacy note in .env.example) |

## Recommended Production Config

```env
MONERO_ALLOW_TRANSFERS=true
MONERO_ALLOWED_ADDRESSES=4YourTrustedAddress1,4YourTrustedAddress2
MONERO_REQUIRE_CONFIRMATION=true
MONERO_DAILY_LIMIT_XMR=1.0
MONERO_TRANSFER_COOLDOWN_SECONDS=300
MONERO_AUDIT_LOG_FILE=./audit.jsonl
```

## Networks

| Network | Daemon Port | Wallet RPC Port | Address Prefix | Real Money? |
|---------|------------|-----------------|----------------|-------------|
| Mainnet | 18081 | 18082 | `4` / `8` | ✅ Yes |
| Stagenet | 38081 | 38082 | `5` / `7` | ❌ No – use this for testing |
| Testnet | 28081 | 28082 | `9` / `B` | ❌ No |

## ⚠️ Status: Early Alpha

This is v0.1 – built in a night before heading to Monerotopia.

It compiles, the security layers are in place, but it has NOT been audited.
Do not use with mainnet funds you can't afford to lose.

If you're a Monero developer or security researcher: tear it apart.
That's how we make it production-ready.

## ⚠️ Important Warnings

**This software is not audited.** It is early-stage, open-source software that
interacts with real money. Use at your own risk.

**Your seed phrase is your responsibility.** Write it down. Store it offline.
If you lose it, your funds are gone permanently. No one can help you.

**AI agents can be manipulated.** The security layers in this server (address
allowlists, two-step confirmation, rate limiting, audit logging) reduce risk
but do not eliminate it. Always use all available protections in production.

**Do not use with funds you cannot afford to lose.**

**Start on stagenet.** Test everything there before going near mainnet. Free
test XMR is available via faucets.

See [DISCLAIMER.md](DISCLAIMER.md) for full details.

## Contributing

We need help. This is v0.1 and there's a lot to do. See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

**Good first issues:**
- Better error messages for common RPC failures
- Transaction memo/note support
- Multiple destination transfers

**Help wanted:**
- Tor proxy support for RPC connection
- Multisig wallet operations
- Cold signing workflow
- Hardware wallet integration via RPC
- Integration test suite with stagenet

## License

MIT – do whatever you want with it.

## Acknowledgments

Built with love for the Monero community.

Inspired by [Monerotopia 2026](https://monerotopia.com) and the simple idea that if AI agents are going to handle money, they should do it privately.

---

*If you find this useful, consider donating XMR to support development:*

`45CGtczedKaT6gLHUd2FDebFjGpzio3FzB2AKtx82NxWPF99cfTMeJcCs1XhF9zJTLNVmd6chvMHSNb2symioZkp2f24nfK`
