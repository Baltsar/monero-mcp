# Security Policy

This server can SEND MONEY. Treat configuration and deployment with the same care as wallet credentials.

## Operational requirements

- Never expose `monero-wallet-rpc` to the internet.
- Bind RPC locally and protect host access.
- Use view-only wallets for read-only deployments.

## Prompt injection threat model

AI agents ingest untrusted content (web pages, emails, chats). Attackers can try to inject instructions that make the agent invoke money-moving tools.

The MCP server is the last line of defense, not the AI agent. This project enforces multiple layers:

1. Address allowlist (`MONERO_ALLOWED_ADDRESSES`)
2. Two-step confirmation tokens (`MONERO_REQUIRE_CONFIRMATION=true`)
3. Transfer cooldown + daily limits (`MONERO_TRANSFER_COOLDOWN_SECONDS`, `MONERO_DAILY_LIMIT_XMR`)
4. Full audit logging (`MONERO_AUDIT_LOG_FILE`)
5. Strict local address validation + `validate_address` RPC checks

## Recommended production configuration

```bash
MONERO_ALLOW_TRANSFERS=true
MONERO_ALLOWED_ADDRESSES=<known destinations only>
MONERO_REQUIRE_CONFIRMATION=true
MONERO_DAILY_LIMIT_XMR=1.0
MONERO_TRANSFER_COOLDOWN_SECONDS=300
MONERO_AUDIT_LOG_FILE=./audit.jsonl
```

Dangerous setup for agent use: empty `MONERO_ALLOWED_ADDRESSES` combined with `MONERO_REQUIRE_CONFIRMATION=false`.

## Responsible disclosure

If you discover a vulnerability, report it privately to the maintainers before public disclosure. Include:

- impact
- reproducible steps
- affected versions/commit
- suggested remediation if available
