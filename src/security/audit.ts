import { appendFile } from "node:fs/promises";

export interface AuditEntry {
  timestamp: string;
  tool: string;
  params: unknown;
  result_summary: unknown;
  success: boolean;
}

export class AuditLogger {
  constructor(private readonly auditFile?: string) {}

  async logTool(entry: AuditEntry): Promise<void> {
    const line = JSON.stringify(entry);
    console.error(line);
    if (this.auditFile) {
      await appendFile(this.auditFile, `${line}\n`, { encoding: "utf8" });
    }
  }

  async logTransferAttempt(data: {
    tool?: "transfer" | "sweep_all";
    destination: string;
    amount_xmr?: number | string;
    allowed: boolean;
    reason?: string;
  }): Promise<void> {
    const entry = {
      timestamp: new Date().toISOString(),
      tool: data.tool ?? "transfer",
      destination: data.destination,
      amount_xmr: data.amount_xmr,
      allowed: data.allowed,
      reason: data.reason,
    };

    const line = JSON.stringify(entry);
    console.error(line);
    if (this.auditFile) {
      await appendFile(this.auditFile, `${line}\n`, { encoding: "utf8" });
    }
  }
}
