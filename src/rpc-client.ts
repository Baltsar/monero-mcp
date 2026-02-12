import DigestFetch from "digest-fetch";

import type { Config } from "./config.js";
import type { JsonRecord, RpcResponse } from "./types.js";

const REQUEST_TIMEOUT_MS = 30_000;

export class MoneroRpcClient {
  private readonly url: string;
  private readonly digestClient?: DigestFetch;

  constructor(config: Config) {
    this.url = `http://${config.rpcHost}:${config.rpcPort}/json_rpc`;

    if (config.rpcUser && config.rpcPass) {
      this.digestClient = new DigestFetch(config.rpcUser, config.rpcPass);
    }
  }

  async call<T>(method: string, params: JsonRecord = {}): Promise<T> {
    const payload = {
      jsonrpc: "2.0",
      id: "0",
      method,
      params,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await this.fetch(this.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`monero-wallet-rpc HTTP ${response.status}: ${response.statusText}`);
      }

      const body = (await response.json()) as RpcResponse<T>;
      if ("error" in body) {
        throw new Error(`RPC ${body.error.code}: ${body.error.message}`);
      }

      return body.result;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("monero-wallet-rpc request timed out after 30 seconds");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private fetch(url: string, init: RequestInit): Promise<Response> {
    if (this.digestClient) {
      return this.digestClient.fetch(url, init);
    }
    return fetch(url, init);
  }
}
