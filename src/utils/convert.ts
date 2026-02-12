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

  const normalized = expandScientific(amountXmr.toString());
  const [wholePart = "0", fractionPartRaw = ""] = normalized.split(".");

  if (fractionPartRaw.length > 12) {
    throw new Error("amount_xmr has too many decimal places (max 12)");
  }

  const fractionPart = fractionPartRaw.padEnd(12, "0");
  const whole = BigInt(wholePart || "0") * ATOMIC_UNITS_PER_XMR;
  const fraction = BigInt(fractionPart);
  return whole + fraction;
}

export function sumAtomic(values: Array<string | number | bigint>): bigint {
  return values.reduce<bigint>((acc, value) => acc + normalizeAtomic(value), 0n);
}

function expandScientific(value: string): string {
  const lower = value.toLowerCase();
  if (!lower.includes("e")) {
    return lower;
  }

  const [base, exponentRaw] = lower.split("e");
  const exponent = Number(exponentRaw);
  if (!Number.isInteger(exponent)) {
    throw new Error("Invalid scientific notation amount");
  }

  const sign = base.startsWith("-") ? "-" : "";
  const absBase = sign ? base.slice(1) : base;
  const [wholeRaw = "0", fractionRaw = ""] = absBase.split(".");
  let whole = wholeRaw;
  let fraction = fractionRaw;

  if (exponent >= 0) {
    if (exponent >= fraction.length) {
      whole = `${whole}${fraction}${"0".repeat(exponent - fraction.length)}`;
      fraction = "";
    } else {
      whole = `${whole}${fraction.slice(0, exponent)}`;
      fraction = fraction.slice(exponent);
    }
  } else {
    const shift = -exponent;
    if (shift >= whole.length) {
      fraction = `${"0".repeat(shift - whole.length)}${whole}${fraction}`;
      whole = "0";
    } else {
      fraction = `${whole.slice(whole.length - shift)}${fraction}`;
      whole = whole.slice(0, whole.length - shift);
    }
  }

  const normalizedWhole = whole.replace(/^0+(?=\d)/, "") || "0";
  const normalizedFraction = fraction.replace(/0+$/, "");
  return normalizedFraction.length > 0 ? `${sign}${normalizedWhole}.${normalizedFraction}` : `${sign}${normalizedWhole}`;
}
