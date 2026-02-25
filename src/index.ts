#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { loadConfig } from "./config.js";
import { MoneroRpcClient } from "./rpc-client.js";
import { AuditLogger } from "./security/audit.js";
import { ConfirmationStore } from "./security/confirm.js";
import { TransferRateLimiter } from "./security/ratelimit.js";
import { buildPriceTools } from "./tools/price.js";
import { buildReadTools } from "./tools/read.js";
import type { ToolDefinition } from "./tools/types.js";
import { buildWriteTools } from "./tools/write.js";

function summarizeResult(result: unknown): unknown {
  if (result === null || result === undefined) {
    return result;
  }

  if (typeof result === "string" || typeof result === "number" || typeof result === "boolean") {
    return result;
  }

  try {
    const text = JSON.stringify(result);
    if (text.length <= 500) {
      return JSON.parse(text) as unknown;
    }
    return `${text.slice(0, 500)}...`;
  } catch {
    return "[unserializable result]";
  }
}

function formatToolOutput(result: unknown): string {
  if (typeof result === "string") {
    return result;
  }

  return JSON.stringify(result, null, 2);
}

async function main(): Promise<void> {
  // ── Startup warnings ──────────────────────────────────────────────
  const network = process.env.MONERO_NETWORK || "mainnet";
  const transfersEnabled = process.env.MONERO_ALLOW_TRANSFERS === "true";
  const confirmationRequired = process.env.MONERO_REQUIRE_CONFIRMATION !== "false";
  const hasAllowlist = !!process.env.MONERO_ALLOWED_ADDRESSES;
  const hasDailyLimit = !!process.env.MONERO_DAILY_LIMIT_XMR;

  if (network === "mainnet") {
    console.error("");
    console.error("╔══════════════════════════════════════════════════════════╗");
    console.error("║  WARNING: Running on MAINNET with REAL funds.           ║");
    console.error("║  This software is NOT audited. Use at your own risk.    ║");
    console.error("║  See DISCLAIMER.md for details.                         ║");
    console.error("╚══════════════════════════════════════════════════════════╝");
    console.error("");

    if (transfersEnabled && !hasAllowlist) {
      console.error("⚠  TRANSFERS ENABLED without address allowlist.");
      console.error("   Set MONERO_ALLOWED_ADDRESSES to restrict destinations.");
    }

    if (transfersEnabled && !confirmationRequired) {
      console.error("⚠  TRANSFERS ENABLED without two-step confirmation.");
      console.error("   Set MONERO_REQUIRE_CONFIRMATION=true for safety.");
    }

    if (transfersEnabled && !hasDailyLimit) {
      console.error("⚠  TRANSFERS ENABLED without daily limit.");
      console.error("   Set MONERO_DAILY_LIMIT_XMR to cap exposure.");
    }
  }

  if (transfersEnabled) {
    console.error(
      `Network: ${network} | Transfers: ENABLED | Confirmation: ${confirmationRequired ? "ON" : "OFF"} | Allowlist: ${hasAllowlist ? "SET" : "NONE"}`,
    );
  } else {
    console.error(`Network: ${network} | Transfers: DISABLED (read-only)`);
  }
  // ──────────────────────────────────────────────────────────────────

  const config = loadConfig();
  const rpc = new MoneroRpcClient(config);
  const audit = new AuditLogger(config.auditLogFile);
  const confirmation = new ConfirmationStore();
  const rateLimiter = new TransferRateLimiter(config.transferCooldownSeconds, config.dailyLimitXmr);

  const tools: ToolDefinition[] = [
    ...buildReadTools(rpc),
    ...buildPriceTools(config),
    ...buildWriteTools({
      config,
      rpc,
      audit,
      confirmation,
      rateLimiter,
    }),
  ];

  const toolMap = new Map(tools.map((tool) => [tool.name, tool]));

  const server = new Server(
    {
      name: "monero-mcp-server",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const tool = toolMap.get(toolName);

    if (!tool) {
      const message = `Unknown tool: ${toolName}`;
      await audit.logTool({
        timestamp: new Date().toISOString(),
        tool: toolName,
        params: request.params.arguments ?? {},
        result_summary: message,
        success: false,
      });

      return {
        content: [{ type: "text", text: message }],
        isError: true,
      };
    }

    const args = request.params.arguments ?? {};

    try {
      const input = tool.schema.parse(args);
      const result = await tool.handler(input);

      await audit.logTool({
        timestamp: new Date().toISOString(),
        tool: tool.name,
        params: args,
        result_summary: summarizeResult(result),
        success: true,
      });

      return {
        content: [{ type: "text", text: formatToolOutput(result) }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown tool error";

      await audit.logTool({
        timestamp: new Date().toISOString(),
        tool: tool.name,
        params: args,
        result_summary: message,
        success: false,
      });

      return {
        content: [{ type: "text", text: message }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      event: "server_started",
      rpc_host: config.rpcHost,
      rpc_port: config.rpcPort,
      transfers_enabled: config.allowTransfers,
      network: config.network,
      confirmation_required: config.requireConfirmation,
    }),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      event: "fatal_error",
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
