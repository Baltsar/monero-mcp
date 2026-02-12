import { describe, expect, it } from "vitest";

import { atomicToXmrString, xmrToAtomic } from "../src/utils/convert.js";

describe("conversion utilities", () => {
  it("converts atomic units to XMR strings", () => {
    expect(atomicToXmrString(0n)).toBe("0");
    expect(atomicToXmrString(1n)).toBe("0.000000000001");
    expect(atomicToXmrString(1_000_000_000_000n)).toBe("1");
    expect(atomicToXmrString(1_234_567_890_123n)).toBe("1.234567890123");
  });

  it("converts XMR numbers to atomic units", () => {
    expect(xmrToAtomic(0)).toBe(0n);
    expect(xmrToAtomic(0.000000000001)).toBe(1n);
    expect(xmrToAtomic(1)).toBe(1_000_000_000_000n);
    expect(xmrToAtomic(1.234567890123)).toBe(1_234_567_890_123n);
  });

  it("handles very large amounts", () => {
    expect(atomicToXmrString(123_456_789_012_345_678_901_234_567_890n)).toBe("123456789012345678.90123456789");
    expect(xmrToAtomic(1_000_000_000_000)).toBe(1_000_000_000_000_000_000_000_000n);
  });

  it("rejects negative XMR", () => {
    expect(() => xmrToAtomic(-0.1)).toThrow("amount_xmr must be greater than or equal to 0");
  });

  it("rejects more than 12 decimal places", () => {
    expect(() => xmrToAtomic(0.1234567890123)).toThrow("amount_xmr has too many decimal places (max 12)");
  });
});
