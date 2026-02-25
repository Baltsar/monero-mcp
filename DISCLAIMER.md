# Disclaimer

## No Warranty

This software is provided "as is", without warranty of any kind, express or
implied. Use it at your own risk. The author(s) accept no responsibility for
any loss of funds, data, or other damages arising from the use of this software.

## Not Financial Software

Monero MCP is a developer tool. It is a bridge between AI agent frameworks and
the Monero wallet RPC interface. It is not a wallet. It is not a payment
processor. It is not a financial product. It has not been reviewed, approved,
or endorsed by any financial regulatory body.

Do not treat this software as a substitute for professional financial,
legal, or tax advice.

## Not Audited

This software has **not** undergone a formal security audit. While the
codebase includes multiple defense layers against common attack vectors
(address allowlists, two-step transfer confirmation, rate limiting, audit
logging, and input sanitization), these are best-effort protections. They
reduce risk. They do not eliminate it.

If you are a security researcher, we welcome review. See SECURITY.md.

## Your Keys, Your Responsibility

Monero MCP connects to a `monero-wallet-rpc` instance that you configure and
control. The wallet's mnemonic seed phrase is the only way to recover your
funds if something goes wrong. The author(s) of this software:

- Do not have access to your seed phrase
- Do not have access to your wallet
- Do not have access to your funds
- Cannot recover lost funds under any circumstances
- Cannot reverse transactions under any circumstances

**Write down your seed phrase. Store it offline. Do not share it with anyone.
Do not store it on a computer connected to the internet.**

If you lose your seed phrase, your funds are gone. Permanently. No one can
help you.

## AI Agent Risk

This software is designed to be used by AI agents. AI agents can be
manipulated through prompt injection, adversarial inputs, and other attack
vectors. The security layers built into this server are designed to limit the
damage an attacker can cause, but they are not foolproof.

Specific risks when using this software with AI agents:

- An AI agent may be tricked into initiating transfers to unintended addresses
- An AI agent may misinterpret transaction data
- An AI agent may reveal wallet information in its responses
- An AI agent's behavior depends on the underlying language model, which is
  outside the control of this software

**Recommendations:**

- Always use address allowlists in production (`MONERO_ALLOWED_ADDRESSES`)
- Always enable two-step confirmation (`MONERO_REQUIRE_CONFIRMATION=true`)
- Set conservative daily limits (`MONERO_DAILY_LIMIT_XMR`)
- Set transfer cooldowns (`MONERO_TRANSFER_COOLDOWN_SECONDS`)
- Enable audit logging (`MONERO_AUDIT_LOG_FILE`)
- Start with `MONERO_ALLOW_TRANSFERS=false` (read-only mode)
- Test on stagenet before using mainnet
- Monitor audit logs regularly
- Never fund a wallet with more than you can afford to lose

## Mainnet Usage

If you choose to use this software on Monero mainnet with real funds, you do
so entirely at your own risk. The author(s) strongly recommend:

1. Testing thoroughly on stagenet first
2. Starting with small amounts
3. Using all available security features (see above)
4. Reviewing audit logs before and after enabling transfers
5. Understanding that bugs, vulnerabilities, and unexpected behavior may exist

**Do not use this software with funds you cannot afford to lose.**

## Third-Party Dependencies

This software depends on third-party libraries and services:

- `monero-wallet-rpc` (Monero Project)
- `monerod` (Monero Project)
- Node.js runtime and npm packages
- Optional: external price feed APIs (Kraken, CoinGecko)

The author(s) of Monero MCP do not control these dependencies and accept no
responsibility for vulnerabilities, outages, or breaking changes in upstream
software.

When the optional price feed is enabled (`MONERO_ENABLE_PRICE_FEED=true`),
HTTP requests are made to external APIs. These requests may reveal timing
metadata about your wallet activity. This is disabled by default for privacy
reasons.

## Network Privacy

Running your own Monero node (`monerod`) provides the strongest privacy.
Connecting to a remote node is more convenient but exposes transaction timing
metadata to the node operator. This is a well-documented tradeoff in the
Monero ecosystem and is not specific to this software.

The choice of node configuration is yours. This software does not make that
decision for you.

## Limitation of Liability

To the maximum extent permitted by applicable law, in no event shall the
author(s) or contributors be liable for any direct, indirect, incidental,
special, exemplary, or consequential damages (including, but not limited to,
loss of cryptocurrency, loss of data, loss of profits, business interruption,
or procurement of substitute services) however caused and on any theory of
liability, whether in contract, strict liability, or tort (including
negligence or otherwise) arising in any way out of the use of this software,
even if advised of the possibility of such damage.

## Acknowledgment

By using this software, you acknowledge that you have read this disclaimer,
understand the risks involved, and accept full responsibility for your use
of the software and any consequences thereof.
