# 🔒 Monero MCP Server

**The world's first MCP server for Monero. Give any AI agent a private wallet.**

---

## What is this?

This is a bridge between AI agents and the Monero network. It lets any AI assistant – Claude, Cursor, or any MCP-compatible client – check balances, receive payments, and send XMR through a simple tool interface.

Think of it as: **your AI gets its own Monero wallet.**

## Wait, what's MCP?

MCP (Model Context Protocol) is a standard created by Anthropic that lets AI assistants use external tools. Instead of the AI just generating text, it can call real functions – read files, query databases, or in this case, interact with a Monero wallet.

If you've ever wished you could say *"Claude, check my XMR balance"* or *"send 0.5 XMR to this address"* and have it actually happen – that's what this does.

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

## Quick Start

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

### Add to Claude Desktop

Edit your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on Mac):

```json
{
  "mcpServers": {
    "monero": {
      "command": "node",
      "args": ["/path/to/monero-mcp-server/build/index.js"],
      "env": {
        "MONERO_RPC_HOST": "127.0.0.1",
        "MONERO_RPC_PORT": "38082",
        "MONERO_RPC_USER": "user",
        "MONERO_RPC_PASS": "pass",
        "MONERO_NETWORK": "stagenet",
        "MONERO_ALLOW_TRANSFERS": "false"
      }
    }
  }
}
```

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
