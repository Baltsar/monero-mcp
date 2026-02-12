export function enforceAllowlist(address: string, allowlist?: Set<string>): void {
  if (!allowlist || allowlist.size === 0) {
    return;
  }

  if (!allowlist.has(address)) {
    throw new Error(
      "Destination address not in allowlist. Add it to MONERO_ALLOWED_ADDRESSES to permit transfers to this address.",
    );
  }
}
