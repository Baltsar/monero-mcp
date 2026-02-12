interface TransferEntry {
  amountXmr: number;
  timestamp: number;
}

export class TransferRateLimiter {
  private readonly history: TransferEntry[] = [];
  private lastSuccessfulTransferAt?: number;

  constructor(
    private readonly cooldownSeconds: number,
    private readonly dailyLimitXmr?: number,
  ) {}

  enforce(amountXmr: number, now = Date.now()): void {
    if (this.cooldownSeconds > 0 && this.lastSuccessfulTransferAt) {
      const nextAllowedAt = this.lastSuccessfulTransferAt + this.cooldownSeconds * 1000;
      if (nextAllowedAt > now) {
        const seconds = Math.ceil((nextAllowedAt - now) / 1000);
        throw new Error(`Transfer cooldown active. Next transfer allowed in ${seconds} seconds.`);
      }
    }

    if (this.dailyLimitXmr === undefined) {
      return;
    }

    const dayAgo = now - 24 * 60 * 60 * 1000;
    while (this.history.length > 0 && this.history[0]!.timestamp < dayAgo) {
      this.history.shift();
    }

    const sentToday = this.history.reduce((sum, transfer) => sum + transfer.amountXmr, 0);
    if (sentToday + amountXmr > this.dailyLimitXmr) {
      throw new Error(
        `Daily transfer limit (${this.dailyLimitXmr} XMR) would be exceeded. Sent today: ${sentToday} XMR.`,
      );
    }
  }

  recordSuccessfulTransfer(amountXmr: number, now = Date.now()): void {
    this.lastSuccessfulTransferAt = now;

    if (this.dailyLimitXmr !== undefined) {
      this.history.push({ amountXmr, timestamp: now });
    }
  }
}
