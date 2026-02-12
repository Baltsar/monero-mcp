# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog,
and this project follows Semantic Versioning.

## 0.1.0 - 2026-02-12

### Added
- Initial Monero MCP server implementation in TypeScript with stdio transport.
- Read tools: `get_balance`, `get_address`, `get_height`, `get_transfers`, `validate_address`, `get_version`, `get_transfer_by_txid`, `create_address`, `make_integrated_address`.
- Write tools: `transfer`, `sweep_all`, `confirm_transfer`.
- Security layers: transfer env-gate, address allowlist, confirmation token flow, cooldown/daily limit rate limiting, and JSONL audit logging.
- Unit test suite with mocked RPC client for security, conversion, and validation behavior.

### Changed
- README updated for agent-first MCP usage and broader framework compatibility examples.
- Donation address added to README.
- Amount handling tightened to enforce strict XMR precision (reject >12 decimals).
- Transfer address handling tightened to validate raw input and reject whitespace/control-character addresses.

### Security
- Hardened transfer path against prompt-injection-style address mutation via pre-validation sanitization bypass.
- Prevented silent amount rounding before atomic conversion in transfer-related flows.
