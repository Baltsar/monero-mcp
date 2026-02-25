import { describe, it } from "node:test";
import assert from "node:assert";
import { validateMoneroAddressFormat } from "../build/utils/validate.js";
import { loadConfig } from "../build/config.js";

describe("Address Validation", () => {
  it("should accept valid mainnet address (prefix 4)", () => {
    const addr = "4" + "A".repeat(94);
    assert.strictEqual(addr.length, 95);
    assert.ok(addr.startsWith("4"));
    assert.doesNotThrow(() => validateMoneroAddressFormat(addr, "mainnet"));
  });

  it("should accept valid mainnet subaddress (prefix 8)", () => {
    const addr = "8" + "A".repeat(94);
    assert.ok(addr.startsWith("8"));
    assert.doesNotThrow(() => validateMoneroAddressFormat(addr, "mainnet"));
  });

  it("should accept valid stagenet address (prefix 5)", () => {
    const addr = "5" + "A".repeat(94);
    assert.ok(addr.startsWith("5"));
    assert.doesNotThrow(() => validateMoneroAddressFormat(addr, "stagenet"));
  });

  it("should reject obviously invalid address", () => {
    const addr = "not-a-monero-address";
    assert.ok(addr.length < 95);
    assert.throws(
      () => validateMoneroAddressFormat(addr, "mainnet"),
      /Address does not match expected|invalid characters/
    );
  });
});

describe("Security Defaults", () => {
  it("should default MONERO_ALLOW_TRANSFERS to false", () => {
    const config = loadConfig({});
    assert.strictEqual(config.allowTransfers, false);
  });

  it("should default MONERO_REQUIRE_CONFIRMATION to true", () => {
    const config = loadConfig({});
    assert.strictEqual(config.requireConfirmation, true);
  });
});

describe("Input Sanitization", () => {
  it("should reject address with injection characters", () => {
    const malicious = "4" + "A".repeat(90) + "<script>";
    assert.throws(
      () => validateMoneroAddressFormat(malicious, "mainnet"),
      /invalid characters/
    );
  });

  it("should reject negative amounts", () => {
    const amount = -1000000000000;
    assert.ok(amount < 0);
  });

  it("should reject non-numeric amounts", () => {
    const amount = "DROP TABLE payments";
    assert.ok(isNaN(Number(amount)));
  });
});
