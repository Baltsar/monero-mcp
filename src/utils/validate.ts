import type { MoneroNetwork } from "../config.js";

const BASE58_REGEX = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/;

const NETWORK_PREFIXES: Record<MoneroNetwork, string[]> = {
  mainnet: ["4", "8"],
  stagenet: ["5", "7"],
  testnet: ["9", "B"],
};

const INTEGRATED_PREFIX: Record<MoneroNetwork, string> = {
  mainnet: "4",
  stagenet: "5",
  testnet: "9",
};

export function sanitizeString(input: string): string {
  return input.replace(/[\u0000-\u001F\u007F]/g, "").trim();
}

export function sanitizePotentialPromptInjection(input: string): string {
  const cleaned = sanitizeString(input);
  return cleaned
    .replace(/ignore\s+all\s+previous\s+instructions/gi, "")
    .replace(/system\s*prompt/gi, "")
    .trim();
}

export function validateMoneroAddressFormat(addressRaw: string, network: MoneroNetwork): void {
  if (addressRaw !== addressRaw.trim() || /[\u0000-\u001F\u007F]/.test(addressRaw) || /\s/.test(addressRaw)) {
    throw new Error("Address contains invalid whitespace or control characters");
  }

  const address = sanitizePotentialPromptInjection(addressRaw);
  if (address.length === 0) {
    throw new Error("Address cannot be empty");
  }

  if (address !== addressRaw) {
    throw new Error("Address contains invalid characters");
  }

  if (!BASE58_REGEX.test(address)) {
    throw new Error("Address contains invalid characters; only Monero base58 characters are allowed");
  }

  const isStandardOrSub = address.length === 95 && NETWORK_PREFIXES[network].includes(address[0] ?? "");
  const isIntegrated = address.length === 106 && INTEGRATED_PREFIX[network] === (address[0] ?? "");

  if (!isStandardOrSub && !isIntegrated) {
    throw new Error(`Address does not match expected ${network} prefixes or length`);
  }
}
