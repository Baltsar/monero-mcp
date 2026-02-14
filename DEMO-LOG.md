# Monero MCP — Demo / push log

## Push 2026-02-14 (mainnet docker, Agent Zero, docs)

**Timestamp:** 2026-02-14 (UTC)

**Branch:** main

**Security scan before push:**
- `grep seed|mnemonic|private_key|secret_key`: Only doc (monero-mcp-spec.md) and transcripts (gitignored) — no real secrets.
- `grep 100.|192.168.|10.0.`: Only package-lock.json (npm package ip-address 10.0.1) — no private IPs.
- `grep api_key|apikey|token|password`: Only code (confirmation_token, MONERO_RPC_PASS in .env.example empty) — no real secrets.

**.gitignore:** node_modules, .env, wallets/, .keys, audit.jsonl confirmed.

**Commit:** feat: mainnet docker setup, Agent Zero integration, improved docs

**Pushed:** origin main
