#!/usr/bin/env node
/**
 * MCP stdio handshake test: initialize → tools/list → tools/call get_balance.
 * Run with wallet-rpc up and env for mainnet (e.g. MONERO_RPC_HOST=localhost MONERO_RPC_PORT=18083).
 * Usage: node test-mcp-stdio.mjs
 */
import { spawn } from "child_process";
import { createInterface } from "readline";

const env = {
  ...process.env,
  MONERO_RPC_HOST: process.env.MONERO_RPC_HOST || "127.0.0.1",
  MONERO_RPC_PORT: process.env.MONERO_RPC_PORT || "18083",
  MONERO_NETWORK: process.env.MONERO_NETWORK || "mainnet",
};

const server = spawn("node", ["build/index.js"], {
  env,
  stdio: ["pipe", "pipe", "inherit"],
});

const rl = createInterface({ input: server.stdout, crlfDelay: Infinity });
const out = [];
rl.on("line", (line) => out.push(line));

function send(obj) {
  const msg = JSON.stringify(obj) + "\n";
  server.stdin.write(msg);
}

function nextLine() {
  return new Promise((resolve) => {
    const check = () => {
      if (out.length) return resolve(out.shift());
      setTimeout(check, 50);
    };
    check();
  });
}

async function readResponse() {
  const line = await nextLine();
  return JSON.parse(line);
}

async function main() {
  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0.1" } },
  });
  const init = await readResponse();
  if (!init.result?.capabilities?.tools) throw new Error("initialize missing tools capability");
  console.log("Step 1 (initialize): OK – serverInfo:", init.result.serverInfo?.name);

  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const list = await readResponse();
  const tools = list.result?.tools?.map((t) => t.name) || [];
  if (!tools.includes("get_balance")) throw new Error("get_balance not in tools list");
  console.log("Step 2 (tools/list): OK –", tools.length, "tools");

  send({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "get_balance", arguments: {} },
  });
  const balance = await readResponse();
  const content = balance.result?.content?.[0];
  if (!content?.text) throw new Error("get_balance returned no content");
  const data = JSON.parse(content.text);
  console.log("Step 3 (tools/call get_balance): OK – balance_xmr:", data.balance_xmr, "unlocked:", data.unlocked_balance_xmr);

  server.kill();
  console.log("All steps passed.");
}

main().catch((err) => {
  console.error(err);
  server.kill();
  process.exit(1);
});
