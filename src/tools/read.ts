import { z } from "zod";

import { atomicToXmrString } from "../utils/convert.js";
import { sanitizePotentialPromptInjection } from "../utils/validate.js";
import type { MoneroRpcClient } from "../rpc-client.js";
import type { GetBalanceResult, JsonRecord, TransferLike } from "../types.js";
import type { ToolDefinition } from "./types.js";

/** Static guidance for where the wallet lives when using this MCP server (wallet-rpc). No user input, no env, no RPC. */
const WALLET_SETUP_HELP_TEXT = `Where the Monero wallet lives (when using this MCP server)

The wallet is NOT created or stored by MCP or by Agent Zero. It is created and stored by monero-wallet-rpc wherever that process runs, in the directory set by its --wallet-dir. This MCP server only sends RPC calls to wallet-rpc.

Do NOT run monero-wallet-rpc inside the Agent Zero container. If you do, the wallet lives in that container's filesystem and is lost when the container stops or is recreated.

Where to look:
- If wallet-rpc runs on the host: the wallet is in the directory you passed as --wallet-dir when starting wallet-rpc (e.g. ~/monero-wallet/). It is NOT necessarily in the standard Monero GUI paths (e.g. ~/Library/Application Support/monero-project/wallets/ on macOS).
- If wallet-rpc runs in Docker: the wallet is in that container's wallet directory. Use a persistent volume (e.g. wallet-data:/wallet) or a host bind mount (e.g. ./wallet-data:/wallet). Never run "docker compose down -v" if you want to keep the wallet (-v removes volumes).

Backup (required): Write down and securely store the 25-word seed. Back up the wallet file and its .keys file to another location. To restore from seed: monero-wallet-cli --restore-deterministic-wallet.

Verification: If the wallet "disappeared" after a container was recreated, it was likely created inside that container (or in a volume that was removed). For next time, run wallet-rpc on the host or in a separate container with a persistent volume.`;

function formatTransfer(transfer: TransferLike): Record<string, unknown> {
  const formatted: Record<string, unknown> = { ...transfer };
  if (transfer.amount !== undefined) {
    formatted.amount_atomic = String(transfer.amount);
    formatted.amount_xmr = atomicToXmrString(transfer.amount);
  }
  if (transfer.fee !== undefined) {
    formatted.fee_atomic = String(transfer.fee);
    formatted.fee_xmr = atomicToXmrString(transfer.fee);
  }
  return formatted;
}

export function buildReadTools(rpc: MoneroRpcClient): ToolDefinition[] {
  const getBalanceSchema = z.object({}).strict();
  const getAddressSchema = z.object({ account_index: z.number().int().nonnegative().optional() }).strict();
  const getHeightSchema = z.object({}).strict();
  const getTransfersSchema = z.object({
    in: z.boolean().optional().default(true),
    out: z.boolean().optional().default(true),
    pending: z.boolean().optional().default(true),
    pool: z.boolean().optional().default(false),
    min_height: z.number().int().nonnegative().optional(),
    max_height: z.number().int().nonnegative().optional(),
  }).strict();
  const validateAddressSchema = z.object({ address: z.string().min(1) }).strict();
  const getVersionSchema = z.object({}).strict();
  const getTransferByTxidSchema = z.object({ txid: z.string().min(1) }).strict();
  const createAddressSchema = z.object({
    account_index: z.number().int().nonnegative().optional(),
    label: z.string().min(1).optional(),
  }).strict();
  const makeIntegratedAddressSchema = z.object({ payment_id: z.string().min(1).optional() }).strict();
  const getWalletSetupHelpSchema = z.object({}).strict();

  const tools: ToolDefinition[] = [
    {
      name: "get_balance",
      description: "Get wallet balance in XMR",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      schema: getBalanceSchema,
      handler: async () => {
        const result = await rpc.call<GetBalanceResult>("get_balance");
        return {
          balance_xmr: atomicToXmrString(result.balance),
          unlocked_balance_xmr: atomicToXmrString(result.unlocked_balance),
          balance_atomic: String(result.balance),
          unlocked_balance_atomic: String(result.unlocked_balance),
          blocks_to_unlock: result.blocks_to_unlock ?? 0,
        };
      },
    },
    {
      name: "get_address",
      description: "Get the wallet's primary address",
      inputSchema: {
        type: "object",
        properties: {
          account_index: { type: "number", minimum: 0 },
        },
        additionalProperties: false,
      },
      schema: getAddressSchema,
      handler: async (input) => rpc.call("get_address", input.account_index !== undefined ? { account_index: input.account_index } : {}),
    },
    {
      name: "get_height",
      description: "Get the wallet's current synced block height",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      schema: getHeightSchema,
      handler: async () => rpc.call("get_height"),
    },
    {
      name: "get_transfers",
      description: "Get incoming and outgoing transfer history",
      inputSchema: {
        type: "object",
        properties: {
          in: { type: "boolean", default: true },
          out: { type: "boolean", default: true },
          pending: { type: "boolean", default: true },
          pool: { type: "boolean", default: false },
          min_height: { type: "number", minimum: 0 },
          max_height: { type: "number", minimum: 0 },
        },
        additionalProperties: false,
      },
      schema: getTransfersSchema,
      handler: async (input) => {
        const params: JsonRecord = {
          in: input.in,
          out: input.out,
          pending: input.pending,
          pool: input.pool,
        };
        if (input.min_height !== undefined) {
          params.min_height = input.min_height;
        }
        if (input.max_height !== undefined) {
          params.max_height = input.max_height;
        }

        const result = await rpc.call<Record<string, unknown>>("get_transfers", params);

        const formatGroup = (value: unknown): unknown => {
          if (!Array.isArray(value)) {
            return value;
          }
          return value.map((item) => {
            if (item && typeof item === "object") {
              return formatTransfer(item as TransferLike);
            }
            return item;
          });
        };

        return {
          in: formatGroup(result.in),
          out: formatGroup(result.out),
          pending: formatGroup(result.pending),
          pool: formatGroup(result.pool),
        };
      },
    },
    {
      name: "validate_address",
      description: "Check if a Monero address is valid",
      inputSchema: {
        type: "object",
        properties: {
          address: { type: "string" },
        },
        required: ["address"],
        additionalProperties: false,
      },
      schema: validateAddressSchema,
      handler: async (input) => rpc.call("validate_address", { address: sanitizePotentialPromptInjection(input.address) }),
    },
    {
      name: "get_version",
      description: "Get monero-wallet-rpc version",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      schema: getVersionSchema,
      handler: async () => rpc.call("get_version"),
    },
    {
      name: "get_transfer_by_txid",
      description: "Look up a specific transaction by its hash",
      inputSchema: {
        type: "object",
        properties: {
          txid: { type: "string" },
        },
        required: ["txid"],
        additionalProperties: false,
      },
      schema: getTransferByTxidSchema,
      handler: async (input) => {
        const result = await rpc.call<Record<string, unknown>>("get_transfer_by_txid", {
          txid: sanitizePotentialPromptInjection(input.txid),
        });

        if (!result.transfer || typeof result.transfer !== "object") {
          return result;
        }

        return {
          ...result,
          transfer: formatTransfer(result.transfer as TransferLike),
        };
      },
    },
    {
      name: "create_address",
      description: "Create a new subaddress for receiving payments",
      inputSchema: {
        type: "object",
        properties: {
          account_index: { type: "number", minimum: 0 },
          label: { type: "string" },
        },
        additionalProperties: false,
      },
      schema: createAddressSchema,
      handler: async (input) => {
        const params: JsonRecord = {};
        if (input.account_index !== undefined) {
          params.account_index = input.account_index;
        }
        if (input.label !== undefined) {
          params.label = sanitizePotentialPromptInjection(input.label);
        }
        return rpc.call("create_address", params);
      },
    },
    {
      name: "make_integrated_address",
      description: "Create an integrated address with a payment ID for identifying incoming payments",
      inputSchema: {
        type: "object",
        properties: {
          payment_id: { type: "string" },
        },
        additionalProperties: false,
      },
      schema: makeIntegratedAddressSchema,
      handler: async (input) => {
        const params: JsonRecord = {};
        if (input.payment_id !== undefined) {
          params.payment_id = sanitizePotentialPromptInjection(input.payment_id);
        }
        return rpc.call("make_integrated_address", params);
      },
    },
    {
      name: "get_wallet_setup_help",
      description:
        "Return guidance on where the Monero wallet is stored when using this MCP server (wallet-rpc). Call this only when the user asks where their wallet is, how to find wallet files, or whether the wallet is on the host or in Docker. Do not call for other Monero questions (e.g. balance or address).",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      schema: getWalletSetupHelpSchema,
      handler: async () => WALLET_SETUP_HELP_TEXT,
    },
  ];

  return tools;
}
