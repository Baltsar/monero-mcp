# Analysis: MCP tool `get_wallet_setup_help`

When adding a tool that returns guidance on where the Monero wallet lives (wallet-rpc + MCP), under which situations it is useful and where it could cause real failures.

---

## 1. Situations where the tool is useful

| Situation | What happens | Outcome |
|-----------|--------------|--------|
| User asks "Where is my wallet?" / "Var ligger min wallet?" | Agent can call the tool and return the correct explanation (wallet-rpc, not MCP; host vs Docker; never in Agent Zero container). | User gets accurate guidance instead of wrong GUI paths. |
| User says "I lost my wallet when the container crashed" | Tool text explains that the wallet was likely inside a container and suggests host or persistent volume for next time. | User understands cause and how to avoid it. |
| User asks "How do I back up my wallet?" | Tool includes backup guidance (seed + wallet files). | Consistent message with AGENT-ZERO-DOCKER-SETUP. |
| User runs wallet on host | Tool text covers "if wallet-rpc runs on host, wallet is in --wallet-dir there". | No wrong assumption about Docker. |
| User runs wallet in Docker with volume | Tool text covers "if in Docker, wallet is in the container's volume or host mount". | User knows where to look (volume / bind mount). |
| First-time setup | User or agent calls tool during setup to confirm where the wallet will live. | Fewer "wallet disappeared" incidents. |

---

## 2. Situations where it could fail or backfire

| Risk | What could go wrong | Severity | Mitigation |
|------|----------------------|----------|------------|
| **Agent never calls the tool** | User asks in a way that doesn't trigger the tool (e.g. "var finns min XMR?", "how do I restore?"). Agent answers from training with wrong paths (e.g. ~/Library/...). | High (wrong answer) | Clear tool name and description: "Call when user asks **where** their wallet is stored or **how to find** wallet files." Cannot guarantee calls; we maximize likelihood. |
| **Agent over-uses the tool** | Agent calls it on every Monero question (e.g. "what's my balance?" -> get_balance + get_wallet_setup_help). Noisy, slower, irrelevant. | Medium (bad UX) | Description: "Call **only** when the user asks about wallet **location**, **where files are stored**, or **host vs Docker**." Not "for any Monero question". |
| **Wrong or single path** | Tool returns one path (e.g. "wallet is in ~/monero-wallet/"). User actually used Docker volume; they look in wrong place. | High (wrong guidance) | Tool returns one block covering **all** cases: host --wallet-dir, Docker volume, host mount, and "never in Agent Zero container". No single path. No parameter needed (we don't know user's deployment). |
| **Security leak** | Tool returns something that reveals user-specific paths, hostnames, or config. | High | Tool returns **static** guidance only. No reading MONERO_RPC_HOST/PORT or filesystem. No user data in response. |
| **Tool throws** | Exception in handler (e.g. accidental I/O). Agent gets error and may say "I couldn't get wallet info." | Medium | Implementation: **no RPC call**, **no file read**. Return a constant string (or string from a constant template). No I/O = no throw. |
| **Stale advice** | Docs change (e.g. new default path) but tool text is not updated. | Low | Treat tool content like docs: update when we change AGENT-ZERO-DOCKER-SETUP / README. |
| **Language** | User asks in Swedish; tool returns English. Agent might answer in English. | Low | Keep tool text in English; agent can translate. Optional: add one line in tool description for the agent to answer in the user's language. |
| **Other MCP server** | User has multiple MCPs; another server has no such tool. Agent tries "get_wallet_setup_help" there -> unknown tool. | Low | Tool exists only in our server. When our MCP is attached, it's available. No conflict. |
| **No wallet yet** | User hasn't created a wallet; asks "where is my wallet?". Tool says "wherever wallet-rpc runs, in --wallet-dir". | None | Still correct; they may not have created one yet. No failure. |
| **Agent misquotes** | Agent summarizes tool output and turns it into one wrong path. | Medium | Keep text clear and explicit: "The wallet is **wherever** wallet-rpc was started with --wallet-dir. It is **not** necessarily in the standard GUI paths." Reduce over-simplification. |

---

## 3. Design decisions to avoid real failures

1. **No input parameters** – We don't know deployment (host vs Docker) in MCP. One response that covers all cases avoids wrong scenario.
2. **Static content only** – No env, no RPC, no filesystem. Prevents leaks and exceptions.
3. **Single, comprehensive block** – Host, Docker volume, host mount, "do not run wallet-rpc inside Agent Zero container", backup (seed + files). No single path.
4. **Clear tool description** – So the agent calls it when appropriate and doesn't call it for every Monero question.
5. **Same message as docs** – Align text with AGENT-ZERO-DOCKER-SETUP.md so we don't contradict ourselves.

---

## 4. Conclusion

- **Useful in:** Any situation where the user (or agent) needs correct guidance on where the wallet lives and how to avoid losing it (host vs Docker, volume, backup).
- **Real failure modes:** Wrong or single-path guidance (mitigated by covering all cases), agent not calling the tool (mitigated by description), over-use (mitigated by description), security/stability (mitigated by static, no-I/O implementation).
- **Implementation:** One read-only tool, no RPC, no file access, returns one static (or constant-template) string. Safe and maintainable.
