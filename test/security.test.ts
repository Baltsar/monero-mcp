import { afterEach, describe, expect, it, vi } from "vitest";

import type { Config } from "../src/config.js";
import type { MoneroRpcClient } from "../src/rpc-client.js";
import type { AuditLogger } from "../src/security/audit.js";
import { ConfirmationStore } from "../src/security/confirm.js";
import { TransferRateLimiter } from "../src/security/ratelimit.js";
import type { ToolDefinition } from "../src/tools/types.js";
import { buildWriteTools } from "../src/tools/write.js";

const MAINNET_ADDRESS_A = `4${"A".repeat(94)}`;
const MAINNET_ADDRESS_B = `8${"B".repeat(94)}`;

interface SecurityHarness {
  tools: ToolDefinition[];
  rpcCall: ReturnType<typeof vi.fn>;
  audit: { logTransferAttempt: ReturnType<typeof vi.fn> };
}

function baseConfig(overrides: Partial<Config> = {}): Config {
  return {
    rpcHost: "127.0.0.1",
    rpcPort: "18082",
    rpcUser: undefined,
    rpcPass: undefined,
    allowTransfers: true,
    maxTransferAmountXmr: undefined,
    dailyLimitXmr: undefined,
    transferCooldownSeconds: 0,
    allowedAddresses: undefined,
    requireConfirmation: false,
    auditLogFile: undefined,
    network: "mainnet",
    ...overrides,
  };
}

function getTool(tools: ToolDefinition[], name: string): ToolDefinition {
  const tool = tools.find((entry) => entry.name === name);
  if (!tool) {
    throw new Error(`Tool not found: ${name}`);
  }
  return tool;
}

function createHarness(configOverrides: Partial<Config> = {}): SecurityHarness {
  const config = baseConfig(configOverrides);

  const rpcCall = vi.fn(async (method: string) => {
    if (method === "validate_address") {
      return {
        valid: true,
        integrated: false,
        subaddress: false,
        nettype: config.network,
      };
    }

    if (method === "transfer") {
      return {
        tx_hash: "tx-hash-1",
        tx_key: "tx-key-1",
        fee: "1000000000",
      };
    }

    if (method === "get_balance") {
      return {
        balance: "5000000000000",
        unlocked_balance: "5000000000000",
      };
    }

    if (method === "sweep_all") {
      return {
        tx_hash_list: ["sweep-hash-1"],
        fee_list: ["1000000000"],
        amount_list: ["4000000000000"],
      };
    }

    throw new Error(`Unhandled RPC method in test: ${method}`);
  });

  const rpc = {
    call: rpcCall,
  } as unknown as MoneroRpcClient;

  const audit = {
    logTransferAttempt: vi.fn(async () => undefined),
  } as unknown as AuditLogger;

  const tools = buildWriteTools({
    config,
    rpc,
    audit,
    confirmation: new ConfirmationStore(),
    rateLimiter: new TransferRateLimiter(config.transferCooldownSeconds, config.dailyLimitXmr),
  });

  return {
    tools,
    rpcCall,
    audit: audit as unknown as { logTransferAttempt: ReturnType<typeof vi.fn> },
  };
}

describe("security: write tools", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("rejects transfer when MONERO_ALLOW_TRANSFERS=false", async () => {
    const { tools, rpcCall } = createHarness({ allowTransfers: false });
    const transfer = getTool(tools, "transfer");

    await expect(
      transfer.handler({
        address: MAINNET_ADDRESS_A,
        amount_xmr: 0.1,
      }),
    ).rejects.toThrow("Transfers are disabled. Set MONERO_ALLOW_TRANSFERS=true to enable write operations.");

    expect(rpcCall).not.toHaveBeenCalled();
  });

  it("blocks destination not present in allowlist", async () => {
    const { tools, rpcCall } = createHarness({
      allowedAddresses: new Set([MAINNET_ADDRESS_B]),
    });
    const transfer = getTool(tools, "transfer");

    await expect(
      transfer.handler({
        address: MAINNET_ADDRESS_A,
        amount_xmr: 0.1,
      }),
    ).rejects.toThrow(
      "Destination address not in allowlist. Add it to MONERO_ALLOWED_ADDRESSES to permit transfers to this address.",
    );

    expect(rpcCall).not.toHaveBeenCalled();
  });

  it("rejects addresses with whitespace before any RPC call", async () => {
    const { tools, rpcCall } = createHarness();
    const transfer = getTool(tools, "transfer");

    await expect(
      transfer.handler({
        address: `${MAINNET_ADDRESS_A} `,
        amount_xmr: 0.1,
      }),
    ).rejects.toThrow("Address contains invalid whitespace or control characters");

    expect(rpcCall).not.toHaveBeenCalled();
  });

  it("rejects rapid transfers when cooldown is active", async () => {
    const { tools, rpcCall } = createHarness({
      transferCooldownSeconds: 120,
      requireConfirmation: false,
    });
    const transfer = getTool(tools, "transfer");

    await expect(
      transfer.handler({
        address: MAINNET_ADDRESS_A,
        amount_xmr: 0.25,
      }),
    ).resolves.toMatchObject({ tx_hash: "tx-hash-1" });

    await expect(
      transfer.handler({
        address: MAINNET_ADDRESS_A,
        amount_xmr: 0.25,
      }),
    ).rejects.toThrow(/Transfer cooldown active\./);

    const transferRpcCalls = rpcCall.mock.calls.filter(([method]) => method === "transfer");
    expect(transferRpcCalls).toHaveLength(1);
  });

  it("rejects transfer when daily limit would be exceeded", async () => {
    const { tools } = createHarness({
      dailyLimitXmr: 1,
      requireConfirmation: false,
    });
    const transfer = getTool(tools, "transfer");

    await expect(
      transfer.handler({
        address: MAINNET_ADDRESS_A,
        amount_xmr: 0.75,
      }),
    ).resolves.toMatchObject({ tx_hash: "tx-hash-1" });

    await expect(
      transfer.handler({
        address: MAINNET_ADDRESS_A,
        amount_xmr: 0.5,
      }),
    ).rejects.toThrow("Daily transfer limit (1 XMR) would be exceeded. Sent today: 0.75 XMR.");
  });

  it("supports confirmation token create, use, and reuse rejection", async () => {
    const { tools } = createHarness({
      requireConfirmation: true,
    });
    const transfer = getTool(tools, "transfer");
    const confirmTransfer = getTool(tools, "confirm_transfer");

    const pending = (await transfer.handler({
      address: MAINNET_ADDRESS_A,
      amount_xmr: 0.2,
    })) as {
      status: string;
      confirmation_token: string;
    };

    expect(pending.status).toBe("pending_confirmation");

    await expect(
      confirmTransfer.handler({
        confirmation_token: pending.confirmation_token,
      }),
    ).resolves.toMatchObject({ tx_hash: "tx-hash-1" });

    await expect(
      confirmTransfer.handler({
        confirmation_token: pending.confirmation_token,
      }),
    ).rejects.toThrow("Invalid confirmation token");
  });

  it("rejects expired confirmation tokens", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const { tools } = createHarness({
      requireConfirmation: true,
    });
    const transfer = getTool(tools, "transfer");
    const confirmTransfer = getTool(tools, "confirm_transfer");

    const pending = (await transfer.handler({
      address: MAINNET_ADDRESS_A,
      amount_xmr: 0.2,
    })) as {
      confirmation_token: string;
    };

    vi.setSystemTime(new Date("2026-01-01T00:01:01.000Z"));

    await expect(
      confirmTransfer.handler({
        confirmation_token: pending.confirmation_token,
      }),
    ).rejects.toThrow("Confirmation token expired");
  });
});
