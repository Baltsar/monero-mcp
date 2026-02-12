import { describe, expect, it } from "vitest";

import { validateMoneroAddressFormat } from "../src/utils/validate.js";

function makeAddress(prefix: string, length: number): string {
  return `${prefix}${"A".repeat(length - 1)}`;
}

describe("address validation", () => {
  it("accepts valid prefixes for each network", () => {
    expect(() => validateMoneroAddressFormat(makeAddress("4", 95), "mainnet")).not.toThrow();
    expect(() => validateMoneroAddressFormat(makeAddress("8", 95), "mainnet")).not.toThrow();
    expect(() => validateMoneroAddressFormat(makeAddress("5", 95), "stagenet")).not.toThrow();
    expect(() => validateMoneroAddressFormat(makeAddress("7", 95), "stagenet")).not.toThrow();
    expect(() => validateMoneroAddressFormat(makeAddress("9", 95), "testnet")).not.toThrow();
    expect(() => validateMoneroAddressFormat(makeAddress("B", 95), "testnet")).not.toThrow();
  });

  it("accepts integrated addresses with expected length and prefix", () => {
    expect(() => validateMoneroAddressFormat(makeAddress("4", 106), "mainnet")).not.toThrow();
    expect(() => validateMoneroAddressFormat(makeAddress("5", 106), "stagenet")).not.toThrow();
    expect(() => validateMoneroAddressFormat(makeAddress("9", 106), "testnet")).not.toThrow();
  });

  it("rejects wrong prefix for selected network", () => {
    expect(() => validateMoneroAddressFormat(makeAddress("4", 95), "stagenet")).toThrow(
      "Address does not match expected stagenet prefixes or length",
    );

    expect(() => validateMoneroAddressFormat(makeAddress("5", 95), "testnet")).toThrow(
      "Address does not match expected testnet prefixes or length",
    );
  });

  it("rejects non-base58 characters", () => {
    const invalid = `4${"A".repeat(93)}0`;
    expect(() => validateMoneroAddressFormat(invalid, "mainnet")).toThrow(
      "Address contains invalid characters; only Monero base58 characters are allowed",
    );
  });

  it("rejects whitespace and malformed lengths", () => {
    expect(() => validateMoneroAddressFormat(`${makeAddress("4", 95)} `, "mainnet")).toThrow(
      "Address contains invalid whitespace or control characters",
    );

    expect(() => validateMoneroAddressFormat(makeAddress("4", 94), "mainnet")).toThrow(
      "Address does not match expected mainnet prefixes or length",
    );
  });
});
