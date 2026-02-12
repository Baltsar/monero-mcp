const ATOMIC_UNITS_PER_XMR = 1_000_000_000_000n;

function normalizeAtomic(value: string | number | bigint): bigint {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Invalid numeric atomic amount");
    }
    return BigInt(Math.trunc(value));
  }

  return BigInt(value);
}

export function atomicToXmrString(value: string | number | bigint): string {
  const atomic = normalizeAtomic(value);
  const negative = atomic < 0n;
  const absValue = negative ? -atomic : atomic;
  const whole = absValue / ATOMIC_UNITS_PER_XMR;
  const fraction = absValue % ATOMIC_UNITS_PER_XMR;
  const fractionString = fraction.toString().padStart(12, "0").replace(/0+$/, "");
  const result = fractionString.length > 0 ? `${whole.toString()}.${fractionString}` : whole.toString();
  return negative ? `-${result}` : result;
}

export function xmrToAtomic(amountXmr: number): bigint {
  if (!Number.isFinite(amountXmr) || amountXmr < 0) {
    throw new Error("amount_xmr must be greater than or equal to 0");
  }

  const normalized = amountXmr.toFixed(12);
  const [wholePart, fractionPart = "0"] = normalized.split(".");
  const whole = BigInt(wholePart || "0") * ATOMIC_UNITS_PER_XMR;
  const fraction = BigInt(fractionPart);
  return whole + fraction;
}

export function sumAtomic(values: Array<string | number | bigint>): bigint {
  return values.reduce<bigint>((acc, value) => acc + normalizeAtomic(value), 0n);
}
