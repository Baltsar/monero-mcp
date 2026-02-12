export type MoneroNetwork = "mainnet" | "stagenet" | "testnet";

export interface Config {
  rpcHost: string;
  rpcPort: string;
  rpcUser?: string;
  rpcPass?: string;
  allowTransfers: boolean;
  maxTransferAmountXmr?: number;
  dailyLimitXmr?: number;
  transferCooldownSeconds: number;
  allowedAddresses?: Set<string>;
  requireConfirmation: boolean;
  auditLogFile?: string;
  network: MoneroNetwork;
}

function parseBoolean(name: string, value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === "") {
    return defaultValue;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error(`${name} must be \"true\" or \"false\"`);
}

function parseOptionalNumber(name: string, value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }

  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const networkRaw = env.MONERO_NETWORK ?? "mainnet";
  if (networkRaw !== "mainnet" && networkRaw !== "stagenet" && networkRaw !== "testnet") {
    throw new Error("MONERO_NETWORK must be one of: mainnet, stagenet, testnet");
  }

  const cooldownRaw = env.MONERO_TRANSFER_COOLDOWN_SECONDS ?? "0";
  const cooldown = Number(cooldownRaw);
  if (!Number.isFinite(cooldown) || cooldown < 0) {
    throw new Error("MONERO_TRANSFER_COOLDOWN_SECONDS must be a non-negative number");
  }

  const allowlistRaw = env.MONERO_ALLOWED_ADDRESSES?.trim();
  const allowlist = allowlistRaw
    ? new Set(
        allowlistRaw
          .split(",")
          .map((address) => address.trim())
          .filter((address) => address.length > 0),
      )
    : undefined;

  return {
    rpcHost: env.MONERO_RPC_HOST ?? "127.0.0.1",
    rpcPort: env.MONERO_RPC_PORT ?? "18082",
    rpcUser: env.MONERO_RPC_USER || undefined,
    rpcPass: env.MONERO_RPC_PASS || undefined,
    allowTransfers: parseBoolean("MONERO_ALLOW_TRANSFERS", env.MONERO_ALLOW_TRANSFERS, false),
    maxTransferAmountXmr: parseOptionalNumber("MONERO_MAX_TRANSFER_AMOUNT", env.MONERO_MAX_TRANSFER_AMOUNT),
    dailyLimitXmr: parseOptionalNumber("MONERO_DAILY_LIMIT_XMR", env.MONERO_DAILY_LIMIT_XMR),
    transferCooldownSeconds: cooldown,
    allowedAddresses: allowlist,
    requireConfirmation: parseBoolean("MONERO_REQUIRE_CONFIRMATION", env.MONERO_REQUIRE_CONFIRMATION, true),
    auditLogFile: env.MONERO_AUDIT_LOG_FILE || undefined,
    network: networkRaw,
  };
}
