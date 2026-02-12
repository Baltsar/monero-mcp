import { z } from "zod";

import type { Config } from "../config.js";
import type { MoneroRpcClient } from "../rpc-client.js";
import type { AuditLogger } from "../security/audit.js";
import type { ConfirmationStore } from "../security/confirm.js";
import type { TransferRateLimiter } from "../security/ratelimit.js";
import type { GetBalanceResult, SweepAllResult, TransferResult, ValidateAddressResult } from "../types.js";
import { atomicToXmrString, sumAtomic, xmrToAtomic } from "../utils/convert.js";
import { sanitizePotentialPromptInjection, validateMoneroAddressFormat } from "../utils/validate.js";
import { enforceAllowlist } from "../security/allowlist.js";
import type { ToolDefinition } from "./types.js";

interface WriteToolDependencies {
  config: Config;
  rpc: MoneroRpcClient;
  audit: AuditLogger;
  confirmation: ConfirmationStore;
  rateLimiter: TransferRateLimiter;
}

function ensureTransferEnabled(config: Config): void {
  if (!config.allowTransfers) {
    throw new Error("Transfers are disabled. Set MONERO_ALLOW_TRANSFERS=true to enable write operations.");
  }
}

async function validateAddressWithRpc(rpc: MoneroRpcClient, config: Config, address: string): Promise<void> {
  validateMoneroAddressFormat(address, config.network);
  const validation = await rpc.call<ValidateAddressResult>("validate_address", { address });
  if (!validation.valid) {
    throw new Error("Destination address failed monero-wallet-rpc validation");
  }

  if (validation.nettype && validation.nettype !== config.network) {
    throw new Error(`Destination address nettype (${validation.nettype}) does not match MONERO_NETWORK (${config.network})`);
  }
}

function parsePriority(value: number | undefined): number {
  if (value === undefined) {
    return 0;
  }

  if (!Number.isInteger(value) || value < 0 || value > 3) {
    throw new Error("priority must be an integer from 0 to 3");
  }

  return value;
}

function summarizeTransferResult(result: TransferResult, amountXmr: number) {
  return {
    tx_hash: result.tx_hash,
    tx_key: result.tx_key,
    fee_atomic: result.fee !== undefined ? String(result.fee) : undefined,
    fee_xmr: result.fee !== undefined ? atomicToXmrString(result.fee) : undefined,
    amount_xmr: amountXmr,
    amount_atomic: xmrToAtomic(amountXmr).toString(),
  };
}

function summarizeSweepResult(result: SweepAllResult) {
  const feeAtomic = result.fee_list ? sumAtomic(result.fee_list) : undefined;
  const amountAtomic = result.amount_list ? sumAtomic(result.amount_list) : undefined;

  return {
    tx_hash_list: result.tx_hash_list ?? [],
    fee_atomic: feeAtomic?.toString(),
    fee_xmr: feeAtomic !== undefined ? atomicToXmrString(feeAtomic) : undefined,
    amount_atomic: amountAtomic?.toString(),
    amount_xmr: amountAtomic !== undefined ? atomicToXmrString(amountAtomic) : undefined,
  };
}

export function buildWriteTools(deps: WriteToolDependencies): ToolDefinition[] {
  const transferSchema = z.object({
    address: z.string().min(1),
    amount_xmr: z.number().positive(),
    priority: z.number().int().min(0).max(3).optional(),
  }).strict();

  const sweepAllSchema = z.object({
    address: z.string().min(1),
    priority: z.number().int().min(0).max(3).optional(),
  }).strict();

  const confirmSchema = z.object({
    confirmation_token: z.string().uuid(),
  }).strict();

  return [
    {
      name: "transfer",
      description: "Send XMR to an address. Requires MONERO_ALLOW_TRANSFERS=true",
      inputSchema: {
        type: "object",
        properties: {
          address: { type: "string" },
          amount_xmr: { type: "number", exclusiveMinimum: 0 },
          priority: { type: "number", minimum: 0, maximum: 3, default: 0 },
        },
        required: ["address", "amount_xmr"],
        additionalProperties: false,
      },
      schema: transferSchema,
      handler: async (input) => {
        ensureTransferEnabled(deps.config);

        const address = sanitizePotentialPromptInjection(input.address);
        const amountXmr = input.amount_xmr;
        const priority = parsePriority(input.priority);

        try {
          validateMoneroAddressFormat(address, deps.config.network);
          enforceAllowlist(address, deps.config.allowedAddresses);
          await validateAddressWithRpc(deps.rpc, deps.config, address);

          if (deps.config.maxTransferAmountXmr !== undefined && amountXmr > deps.config.maxTransferAmountXmr) {
            throw new Error(`amount_xmr exceeds MONERO_MAX_TRANSFER_AMOUNT (${deps.config.maxTransferAmountXmr} XMR)`);
          }

          deps.rateLimiter.enforce(amountXmr);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown validation error";
          await deps.audit.logTransferAttempt({
            tool: "transfer",
            destination: address,
            amount_xmr: amountXmr,
            allowed: false,
            reason: message,
          });
          throw error;
        }

        const amountAtomic = xmrToAtomic(amountXmr);

        if (deps.config.requireConfirmation) {
          let feeEstimateXmr: string | undefined;
          try {
            const preview = await deps.rpc.call<TransferResult>("transfer", {
              destinations: [{ amount: amountAtomic.toString(), address }],
              priority,
              get_tx_key: true,
              do_not_relay: true,
            });
            if (preview.fee !== undefined) {
              feeEstimateXmr = atomicToXmrString(preview.fee);
            }
          } catch {
            // Keep preview optional if wallet-rpc does not support do_not_relay in this mode.
          }

          const previewTimestamp = new Date().toISOString();
          const created = deps.confirmation.create({
            type: "transfer",
            params: {
              address,
              amountAtomic: amountAtomic.toString(),
              amountXmr,
              priority,
            },
            preview: {
              to: address,
              amount_xmr: amountXmr,
              fee_estimate_xmr: feeEstimateXmr,
              timestamp: previewTimestamp,
            },
          });

          await deps.audit.logTransferAttempt({
            tool: "transfer",
            destination: address,
            amount_xmr: amountXmr,
            allowed: true,
          });

          return {
            status: "pending_confirmation",
            confirmation_token: created.token,
            preview: {
              to: address,
              amount_xmr: amountXmr,
              fee_estimate_xmr: feeEstimateXmr,
              timestamp: previewTimestamp,
            },
          };
        }

        const result = await deps.rpc.call<TransferResult>("transfer", {
          destinations: [{ amount: amountAtomic.toString(), address }],
          priority,
          get_tx_key: true,
        });

        deps.rateLimiter.recordSuccessfulTransfer(amountXmr);
        await deps.audit.logTransferAttempt({
          tool: "transfer",
          destination: address,
          amount_xmr: amountXmr,
          allowed: true,
        });
        return summarizeTransferResult(result, amountXmr);
      },
    },
    {
      name: "sweep_all",
      description: "Send ALL unlocked balance to an address. USE WITH CAUTION.",
      inputSchema: {
        type: "object",
        properties: {
          address: { type: "string" },
          priority: { type: "number", minimum: 0, maximum: 3, default: 0 },
        },
        required: ["address"],
        additionalProperties: false,
      },
      schema: sweepAllSchema,
      handler: async (input) => {
        ensureTransferEnabled(deps.config);

        const address = sanitizePotentialPromptInjection(input.address);
        const priority = parsePriority(input.priority);

        try {
          validateMoneroAddressFormat(address, deps.config.network);
          enforceAllowlist(address, deps.config.allowedAddresses);
          await validateAddressWithRpc(deps.rpc, deps.config, address);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown validation error";
          await deps.audit.logTransferAttempt({
            tool: "sweep_all",
            destination: address,
            allowed: false,
            reason: message,
          });
          throw error;
        }

        const balance = await deps.rpc.call<GetBalanceResult>("get_balance");
        const unlockedXmr = Number(atomicToXmrString(balance.unlocked_balance));
        if (!Number.isFinite(unlockedXmr) || unlockedXmr <= 0) {
          throw new Error("No unlocked balance available to sweep");
        }

        if (deps.config.maxTransferAmountXmr !== undefined && unlockedXmr > deps.config.maxTransferAmountXmr) {
          throw new Error(
            `Sweep amount (${unlockedXmr} XMR) exceeds MONERO_MAX_TRANSFER_AMOUNT (${deps.config.maxTransferAmountXmr} XMR)`,
          );
        }

        deps.rateLimiter.enforce(unlockedXmr);

        if (deps.config.requireConfirmation) {
          let feeEstimateXmr: string | undefined;
          try {
            const preview = await deps.rpc.call<SweepAllResult>("sweep_all", {
              address,
              priority,
              do_not_relay: true,
            });

            if (preview.fee_list && preview.fee_list.length > 0) {
              feeEstimateXmr = atomicToXmrString(sumAtomic(preview.fee_list));
            }
          } catch {
            // Keep preview optional if wallet-rpc does not support do_not_relay in this mode.
          }

          const previewTimestamp = new Date().toISOString();
          const created = deps.confirmation.create({
            type: "sweep_all",
            params: {
              address,
              priority,
            },
            preview: {
              to: address,
              estimated_amount_xmr: atomicToXmrString(balance.unlocked_balance),
              fee_estimate_xmr: feeEstimateXmr,
              timestamp: previewTimestamp,
            },
          });

          await deps.audit.logTransferAttempt({
            tool: "sweep_all",
            destination: address,
            amount_xmr: unlockedXmr,
            allowed: true,
          });

          return {
            status: "pending_confirmation",
            confirmation_token: created.token,
            preview: {
              to: address,
              estimated_amount_xmr: atomicToXmrString(balance.unlocked_balance),
              fee_estimate_xmr: feeEstimateXmr,
              timestamp: previewTimestamp,
            },
          };
        }

        const result = await deps.rpc.call<SweepAllResult>("sweep_all", {
          address,
          priority,
        });

        deps.rateLimiter.recordSuccessfulTransfer(unlockedXmr);
        await deps.audit.logTransferAttempt({
          tool: "sweep_all",
          destination: address,
          amount_xmr: unlockedXmr,
          allowed: true,
        });

        return summarizeSweepResult(result);
      },
    },
    {
      name: "confirm_transfer",
      description: "Confirm and execute a pending transfer. Required when MONERO_REQUIRE_CONFIRMATION=true.",
      inputSchema: {
        type: "object",
        properties: {
          confirmation_token: { type: "string", format: "uuid" },
        },
        required: ["confirmation_token"],
        additionalProperties: false,
      },
      schema: confirmSchema,
      handler: async (input) => {
        ensureTransferEnabled(deps.config);

        const pending = deps.confirmation.consume(input.confirmation_token);

        if (pending.type === "transfer") {
          await validateAddressWithRpc(deps.rpc, deps.config, pending.params.address);
          enforceAllowlist(pending.params.address, deps.config.allowedAddresses);

          if (
            deps.config.maxTransferAmountXmr !== undefined &&
            pending.params.amountXmr > deps.config.maxTransferAmountXmr
          ) {
            throw new Error(`amount_xmr exceeds MONERO_MAX_TRANSFER_AMOUNT (${deps.config.maxTransferAmountXmr} XMR)`);
          }

          deps.rateLimiter.enforce(pending.params.amountXmr);
          const result = await deps.rpc.call<TransferResult>("transfer", {
            destinations: [{ amount: pending.params.amountAtomic, address: pending.params.address }],
            priority: pending.params.priority,
            get_tx_key: true,
          });

          deps.rateLimiter.recordSuccessfulTransfer(pending.params.amountXmr);
          await deps.audit.logTransferAttempt({
            tool: "transfer",
            destination: pending.params.address,
            amount_xmr: pending.params.amountXmr,
            allowed: true,
          });
          return summarizeTransferResult(result, pending.params.amountXmr);
        }

        await validateAddressWithRpc(deps.rpc, deps.config, pending.params.address);
        enforceAllowlist(pending.params.address, deps.config.allowedAddresses);

        const balance = await deps.rpc.call<GetBalanceResult>("get_balance");
        const unlockedXmr = Number(atomicToXmrString(balance.unlocked_balance));
        if (!Number.isFinite(unlockedXmr) || unlockedXmr <= 0) {
          throw new Error("No unlocked balance available to sweep");
        }

        if (deps.config.maxTransferAmountXmr !== undefined && unlockedXmr > deps.config.maxTransferAmountXmr) {
          throw new Error(
            `Sweep amount (${unlockedXmr} XMR) exceeds MONERO_MAX_TRANSFER_AMOUNT (${deps.config.maxTransferAmountXmr} XMR)`,
          );
        }

        deps.rateLimiter.enforce(unlockedXmr);
        const result = await deps.rpc.call<SweepAllResult>("sweep_all", {
          address: pending.params.address,
          priority: pending.params.priority,
        });

        deps.rateLimiter.recordSuccessfulTransfer(unlockedXmr);
        await deps.audit.logTransferAttempt({
          tool: "sweep_all",
          destination: pending.params.address,
          amount_xmr: unlockedXmr,
          allowed: true,
        });

        return summarizeSweepResult(result);
      },
    },
  ];
}
