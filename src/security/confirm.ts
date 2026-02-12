import { randomUUID } from "node:crypto";

export type PendingOperation =
  | {
      type: "transfer";
      params: {
        address: string;
        amountAtomic: string;
        amountXmr: number;
        priority: number;
      };
      preview: {
        to: string;
        amount_xmr: number;
        fee_estimate_xmr?: string;
        timestamp: string;
      };
      createdAt: number;
      expiresAt: number;
    }
  | {
      type: "sweep_all";
      params: {
        address: string;
        priority: number;
      };
      preview: {
        to: string;
        estimated_amount_xmr?: string;
        fee_estimate_xmr?: string;
        timestamp: string;
      };
      createdAt: number;
      expiresAt: number;
    };

const TOKEN_TTL_MS = 60_000;
type NewPendingOperation = Omit<PendingOperation, "createdAt" | "expiresAt">;

export class ConfirmationStore {
  private readonly store = new Map<string, PendingOperation>();

  create(operation: NewPendingOperation): { token: string; expiresAt: number } {
    const now = Date.now();
    const expiresAt = now + TOKEN_TTL_MS;
    const token = randomUUID();
    const pending: PendingOperation = {
      ...operation,
      createdAt: now,
      expiresAt,
    } as PendingOperation;
    this.store.set(token, pending);
    return { token, expiresAt };
  }

  consume(token: string): PendingOperation {
    const pending = this.store.get(token);
    if (!pending) {
      throw new Error("Invalid confirmation token");
    }

    if (pending.expiresAt <= Date.now()) {
      this.store.delete(token);
      throw new Error("Confirmation token expired");
    }

    this.store.delete(token);
    return pending;
  }
}
