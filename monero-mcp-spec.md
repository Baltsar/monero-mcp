# Monero MCP Server – Codex Build Prompt & Specification

## Codex Prompt (copy-paste detta till Codex)

```
Build a Model Context Protocol (MCP) server in TypeScript that wraps monero-wallet-rpc,
enabling any MCP-compatible AI client (Claude, Cursor, etc.) to interact with a Monero wallet.

This is the WORLD'S FIRST Monero MCP server. No one has built this before.

## Tech Stack
- TypeScript with ES modules
- @modelcontextprotocol/sdk (latest) for MCP server
- zod for input validation
- node-fetch or native fetch for HTTP calls to monero-wallet-rpc
- StdioServerTransport (stdin/stdout communication)

## Architecture
The server is a thin proxy: MCP stdio ↔ JSON-RPC HTTP to monero-wallet-rpc.
monero-wallet-rpc already runs separately and exposes JSON-RPC on localhost.

All RPC calls go to: POST http://{host}:{port}/json_rpc
Request format:
{
  "jsonrpc": "2.0",
  "id": "0",
  "method": "<method_name>",
  "params": { ... }
}

If RPC auth is configured, use HTTP Digest Authentication (not Basic).
monero-wallet-rpc uses --rpc-login user:pass with Digest auth.

IMPORTANT: Monero uses "atomic units". 1 XMR = 1e12 atomic units (piconero).
The server should accept XMR amounts from the user and convert to atomic units internally.
Display results in XMR (human readable) with the raw atomic units available too.

## Environment Variables
- MONERO_RPC_HOST (default: "127.0.0.1")
- MONERO_RPC_PORT (default: "18082")  
- MONERO_RPC_USER (optional, for digest auth)
- MONERO_RPC_PASS (optional, for digest auth)
- MONERO_ALLOW_TRANSFERS (default: "false" – must be "true" to enable send operations)
- MONERO_MAX_TRANSFER_AMOUNT (optional, max XMR per single transfer, e.g. "1.0")
- MONERO_DAILY_LIMIT_XMR (optional, max total XMR sent per rolling 24h window)
- MONERO_TRANSFER_COOLDOWN_SECONDS (optional, default: "0", minimum seconds between transfers)
- MONERO_ALLOWED_ADDRESSES (optional, comma-separated allowlist of destination addresses. If set, transfers to ANY other address are rejected.)
- MONERO_REQUIRE_CONFIRMATION (default: "true" – if true, transfers use a two-step confirm flow)
- MONERO_AUDIT_LOG_FILE (optional, path to write persistent audit log, e.g. "./monero-mcp-audit.jsonl")
- MONERO_NETWORK (default: "mainnet", options: "mainnet", "stagenet", "testnet")

## CRITICAL: Prompt Injection Defense
This MCP server will be used by AI agents that process untrusted input.
An attacker can inject text that tricks the AI into calling transfer tools.
The AI agent is NOT our security boundary – the MCP server IS.

Defense layers (implement ALL of these):

### Layer 1: Address Allowlist
If MONERO_ALLOWED_ADDRESSES is set, the transfer and sweep_all tools MUST
reject any destination address not in the list. This is the single most
important defense. A prompt injection cannot send to an unknown address.
Error message: "Destination address not in allowlist. Add it to MONERO_ALLOWED_ADDRESSES to permit transfers to this address."

### Layer 2: Two-Step Confirmation Flow  
When MONERO_REQUIRE_CONFIRMATION is "true" (the default):
- Calling `transfer` does NOT send XMR. It validates everything, then returns:
  { status: "pending_confirmation", confirmation_token: "<random_uuid>", 
    preview: { to, amount_xmr, fee_estimate_xmr, timestamp } }
- The caller must then invoke `confirm_transfer` with the token to execute.
- Tokens expire after 60 seconds.
- Tokens are single-use and stored in-memory (Map<string, PendingTransfer>).
- This breaks prompt injection chains because the attacker cannot predict the token.
When MONERO_REQUIRE_CONFIRMATION is "false", transfer executes immediately (for automated agents that need it).

### Layer 3: Rate Limiting
- MONERO_TRANSFER_COOLDOWN_SECONDS: minimum gap between successful transfers.
  If a transfer is attempted before the cooldown expires, reject with:
  "Transfer cooldown active. Next transfer allowed in X seconds."
- MONERO_DAILY_LIMIT_XMR: track total XMR sent in a rolling 24h window.
  Store a simple in-memory array of { amount, timestamp }.
  If adding this transfer would exceed the daily limit, reject with:
  "Daily transfer limit (X XMR) would be exceeded. Sent today: Y XMR."

### Layer 4: Audit Logging
Log ALL tool calls (not just transfers) as JSONL to MONERO_AUDIT_LOG_FILE.
Each line: { timestamp, tool, params, result_summary, success: bool }
This enables post-incident analysis. Also log to stderr.
For transfer attempts specifically, log:
{ timestamp, tool: "transfer", destination, amount_xmr, allowed: bool, reason?: string }
Log REJECTED transfers too – these are the interesting ones for detecting attacks.

### Layer 5: Input Sanitization  
Before passing any string parameter to the RPC:
- Strip any content that looks like prompt injection (optional, best-effort)
- Validate address format strictly BEFORE making any RPC call
- Reject addresses that contain whitespace, newlines, or non-base58 characters
- Monero base58 alphabet: 123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz

## MCP Tools to Implement

### Read-Only Tools (always available)

1. **get_balance**
   - Description: "Get wallet balance in XMR"
   - Inputs: none
   - RPC method: "get_balance"
   - Returns: { balance_xmr, unlocked_balance_xmr, balance_atomic, unlocked_balance_atomic, blocks_to_unlock }

2. **get_address**
   - Description: "Get the wallet's primary address"
   - Inputs: optional { account_index: number }
   - RPC method: "get_address"
   - Returns: { address, addresses[] }

3. **get_height**
   - Description: "Get the wallet's current synced block height"
   - Inputs: none
   - RPC method: "get_height"
   - Returns: { height }

4. **get_transfers**
   - Description: "Get incoming and outgoing transfer history"
   - Inputs: {
       in?: boolean (default true),
       out?: boolean (default true),
       pending?: boolean (default true),
       pool?: boolean (default false),
       min_height?: number,
       max_height?: number
     }
   - RPC method: "get_transfers"
   - Returns: transfers array with amounts converted to XMR

5. **validate_address**
   - Description: "Check if a Monero address is valid"
   - Inputs: { address: string }
   - RPC method: "validate_address"
   - Returns: { valid, integrated, subaddress, nettype }

6. **get_version**
   - Description: "Get monero-wallet-rpc version"
   - Inputs: none
   - RPC method: "get_version"
   - Returns: { version }

7. **get_transfer_by_txid**
   - Description: "Look up a specific transaction by its hash"
   - Inputs: { txid: string }
   - RPC method: "get_transfer_by_txid"
   - Returns: transfer details with amount in XMR

8. **create_address**
   - Description: "Create a new subaddress for receiving payments"
   - Inputs: { account_index?: number, label?: string }
   - RPC method: "create_address"
   - Returns: { address, address_index }

9. **make_integrated_address**
   - Description: "Create an integrated address with a payment ID for identifying incoming payments"
   - Inputs: { payment_id?: string }
   - RPC method: "make_integrated_address"
   - Returns: { integrated_address, payment_id }

### Write Tools (gated behind MONERO_ALLOW_TRANSFERS=true)

10. **transfer**
    - Description: "Send XMR to an address. Requires MONERO_ALLOW_TRANSFERS=true"
    - Inputs: {
        address: string (must be valid Monero address),
        amount_xmr: number (in XMR, converted to atomic units internally),
        priority?: number (0-3, default 0. 0=default, 1=low, 2=normal, 3=high)
      }
    - SECURITY CHECKS before executing:
      a) MONERO_ALLOW_TRANSFERS must be "true" or reject
      b) Validate address format (starts with 4 or 8 for mainnet, length ~95 chars)
      c) Call validate_address RPC to confirm
      d) If MONERO_MAX_TRANSFER_AMOUNT is set, reject if amount exceeds it
      e) Amount must be > 0
    - RPC method: "transfer"
    - RPC params: { destinations: [{ amount: <atomic_units>, address }], priority, get_tx_key: true }
    - Returns: { tx_hash, tx_key, fee_xmr, amount_xmr }

11. **sweep_all**
    - Description: "Send ALL unlocked balance to an address. USE WITH CAUTION."
    - Inputs: { address: string, priority?: number }
    - Same security checks as transfer (except amount check)
    - Also uses two-step confirmation flow if MONERO_REQUIRE_CONFIRMATION=true
    - RPC method: "sweep_all"
    - Returns: { tx_hash_list, fee_xmr } or { status: "pending_confirmation", confirmation_token, preview }

12. **confirm_transfer**
    - Description: "Confirm and execute a pending transfer. Required when MONERO_REQUIRE_CONFIRMATION=true."
    - Inputs: { confirmation_token: string }
    - Validates token exists, not expired (60s TTL), not already used
    - Executes the stored transfer via RPC
    - Deletes the token after use (single-use)
    - Returns: { tx_hash, tx_key, fee_xmr, amount_xmr } or error if token invalid/expired

## Security Requirements
- NEVER expose private keys, seed phrases, or spend keys via any tool
- Default to read-only mode (MONERO_ALLOW_TRANSFERS=false)
- All transfer operations must check the env var gate FIRST
- Validate all addresses before sending
- Log all tool invocations to stderr (never stdout, that's MCP transport)
- Use console.error() for all logging (stdout is reserved for MCP JSON-RPC)
- If RPC connection fails, return clear error messages

## Monero Address Validation
- Mainnet standard address: starts with '4', 95 characters
- Mainnet subaddress: starts with '8', 95 characters  
- Stagenet: starts with '5' or '7'
- Testnet: starts with '9' or 'B'
- Integrated addresses: 106 characters
- Always also validate via the validate_address RPC call

## Project Structure
```
monero-mcp-server/
├── src/
│   ├── index.ts          # Entry point, MCP server setup + tool registration
│   ├── rpc-client.ts     # monero-wallet-rpc JSON-RPC HTTP client with Digest auth
│   ├── tools/
│   │   ├── read.ts       # Read-only tool handlers
│   │   └── write.ts      # Transfer tool handlers with security gates
│   ├── security/
│   │   ├── allowlist.ts  # Address allowlist validation
│   │   ├── confirm.ts    # Two-step confirmation token store (Map + TTL)
│   │   ├── ratelimit.ts  # Cooldown + daily limit tracking
│   │   └── audit.ts      # JSONL audit logger (file + stderr)
│   ├── utils/
│   │   ├── convert.ts    # Atomic units ↔ XMR conversion helpers
│   │   └── validate.ts   # Address validation helpers (format + base58 charset)
│   └── types.ts          # TypeScript type definitions for RPC responses
├── package.json
├── tsconfig.json
├── .env.example
├── LICENSE               # MIT
├── README.md
├── CONTRIBUTING.md
├── SECURITY.md
└── .github/
    └── ISSUE_TEMPLATE/
        ├── bug_report.md
        └── feature_request.md
```

## README.md should include:
- What this is (world's first Monero MCP server)
- Why AI agents need privacy (the thesis about deterministic on-chain behavior)
- Quick start with stagenet for testing
- Configuration table with all env vars
- Claude Desktop config example:
  {
    "mcpServers": {
      "monero": {
        "command": "node",
        "args": ["path/to/monero-mcp-server/build/index.js"],
        "env": {
          "MONERO_RPC_HOST": "127.0.0.1",
          "MONERO_RPC_PORT": "18082",
          "MONERO_RPC_USER": "user",
          "MONERO_RPC_PASS": "pass",
          "MONERO_ALLOW_TRANSFERS": "false"
        }
      }
    }
  }
- Security considerations section
- How to set up stagenet for testing
- Contributing guidelines
- Link to MCP protocol docs

## CONTRIBUTING.md should include:
- Good first issues: rate limiting, better error messages, transaction memo support
- Help wanted: Tor proxy support, multisig operations, cold signing workflow
- Code style: use biome or eslint
- PR process: fork, branch, test on stagenet, PR

## SECURITY.md should include:
- This server can SEND MONEY, treat the config with same care as wallet credentials
- Never expose RPC port to the internet
- Use view-only wallets when possible for read-only use cases
- Responsible disclosure process
- PROMPT INJECTION THREAT MODEL section explaining:
  - AI agents process untrusted input (web pages, emails, user messages)
  - An attacker can craft text that tricks the AI into calling transfer tools
  - The MCP server is the LAST line of defense, not the AI agent
  - Why each defense layer exists and how to configure them
  - Recommended production config:
    MONERO_ALLOW_TRANSFERS=true
    MONERO_ALLOWED_ADDRESSES=<your known addresses only>
    MONERO_REQUIRE_CONFIRMATION=true
    MONERO_DAILY_LIMIT_XMR=1.0
    MONERO_TRANSFER_COOLDOWN_SECONDS=300
    MONERO_AUDIT_LOG_FILE=./audit.jsonl
  - Explain that running with MONERO_ALLOWED_ADDRESSES empty + MONERO_REQUIRE_CONFIRMATION=false is dangerous for production agent use

## .env.example:
MONERO_RPC_HOST=127.0.0.1
MONERO_RPC_PORT=18082
MONERO_RPC_USER=
MONERO_RPC_PASS=
MONERO_ALLOW_TRANSFERS=false
MONERO_MAX_TRANSFER_AMOUNT=
MONERO_DAILY_LIMIT_XMR=
MONERO_TRANSFER_COOLDOWN_SECONDS=60
MONERO_ALLOWED_ADDRESSES=
MONERO_REQUIRE_CONFIRMATION=true
MONERO_AUDIT_LOG_FILE=./monero-mcp-audit.jsonl
MONERO_NETWORK=stagenet

## Testing Instructions
To test without real XMR:
1. Run monerod --stagenet --detach
2. Run monero-wallet-rpc --stagenet --rpc-bind-port 38082 --wallet-dir ./wallets --disable-rpc-login
3. Create a wallet via RPC: curl -X POST http://127.0.0.1:38082/json_rpc -d '{"jsonrpc":"2.0","id":"0","method":"create_wallet","params":{"filename":"test","password":"test","language":"English"}}' -H 'Content-Type: application/json'
4. Get stagenet XMR from a faucet
5. Set MONERO_RPC_PORT=38082 and MONERO_NETWORK=stagenet
6. Run the MCP server and test with MCP Inspector: npx @modelcontextprotocol/inspector

## Important Implementation Notes
- Use HTTP Digest auth (not Basic) when MONERO_RPC_USER/PASS are set
  monero-wallet-rpc uses Digest authentication
  You can use the 'digest-fetch' npm package or implement digest auth manually
- All amounts from RPC are in atomic units (piconero), always convert for display
- 1 XMR = 1_000_000_000_000 atomic units
- get_transfers returns different arrays: "in", "out", "pending", "pool"
- The RPC might be slow if wallet is syncing – add reasonable timeouts (30s)
- For transfer, the "destinations" param is an array (supports multi-output but we expose single for simplicity)
```

---

## Stagenet Quick Reference

| Network   | monerod port | wallet-rpc port | Address prefix |
|-----------|-------------|-----------------|----------------|
| Mainnet   | 18081       | 18082           | 4 / 8          |
| Stagenet  | 38081       | 38082           | 5 / 7          |
| Testnet   | 28081       | 28082           | 9 / B          |

## Key RPC Endpoints Reference

| Tool               | RPC Method              | Auth Required | Write Op |
|--------------------|------------------------|---------------|----------|
| get_balance        | get_balance            | Yes (if set)  | No       |
| get_address        | get_address            | Yes (if set)  | No       |
| get_height         | get_height             | Yes (if set)  | No       |
| get_transfers      | get_transfers          | Yes (if set)  | No       |
| validate_address   | validate_address       | Yes (if set)  | No       |
| get_version        | get_version            | Yes (if set)  | No       |
| get_transfer_by_txid | get_transfer_by_txid | Yes (if set)  | No       |
| create_address     | create_address         | Yes (if set)  | No*      |
| make_integrated_address | make_integrated_address | Yes (if set) | No  |
| transfer           | transfer               | Yes (if set)  | **YES**  |
| sweep_all          | sweep_all              | Yes (if set)  | **YES**  |

*create_address creates a subaddress but doesn't spend funds

## Example RPC Calls (for implementation reference)

### get_balance
```bash
curl -X POST http://127.0.0.1:18082/json_rpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"0","method":"get_balance"}'
# Response: { "balance": 140000000000, "unlocked_balance": 50000000000 }
```

### transfer
```bash
curl -X POST http://127.0.0.1:18082/json_rpc \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc":"2.0","id":"0","method":"transfer",
    "params":{
      "destinations":[{"amount":1000000000000,"address":"4..."}],
      "priority":0,
      "get_tx_key":true
    }
  }'
# Response: { "tx_hash": "...", "tx_key": "...", "fee": 48958481211 }
```

### get_transfers
```bash
curl -X POST http://127.0.0.1:18082/json_rpc \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc":"2.0","id":"0","method":"get_transfers",
    "params":{"in":true,"out":true,"pending":true}
  }'
```

### validate_address
```bash
curl -X POST http://127.0.0.1:18082/json_rpc \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc":"2.0","id":"0","method":"validate_address",
    "params":{"address":"4..."}
  }'
# Response: { "valid": true, "integrated": false, "subaddress": false, "nettype": "mainnet" }
```

## Digest Auth Implementation Note

monero-wallet-rpc uses HTTP Digest Authentication (RFC 2617).
Use the `digest-fetch` npm package:

```typescript
import DigestFetch from 'digest-fetch';

const client = new DigestFetch(username, password);
const response = await client.fetch(`http://${host}:${port}/json_rpc`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: '0',
    method: rpcMethod,
    params: rpcParams
  })
});
```

If no user/pass is set, use regular fetch without auth.
