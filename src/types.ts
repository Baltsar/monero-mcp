export interface RpcSuccess<T> {
  id: string;
  jsonrpc: "2.0";
  result: T;
}

export interface RpcFailure {
  id: string;
  jsonrpc: "2.0";
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type RpcResponse<T> = RpcSuccess<T> | RpcFailure;

export interface GetBalanceResult {
  balance: string | number;
  unlocked_balance: string | number;
  blocks_to_unlock?: number;
}

export interface ValidateAddressResult {
  valid: boolean;
  integrated: boolean;
  subaddress: boolean;
  nettype?: "mainnet" | "testnet" | "stagenet" | string;
}

export interface TransferResult {
  tx_hash?: string;
  tx_key?: string;
  fee?: string | number;
  amount?: string | number;
}

export interface SweepAllResult {
  tx_hash_list?: string[];
  fee_list?: Array<string | number>;
  amount_list?: Array<string | number>;
}

export interface TransferLike {
  amount?: string | number;
  fee?: string | number;
  [key: string]: unknown;
}

export type JsonRecord = Record<string, unknown>;
