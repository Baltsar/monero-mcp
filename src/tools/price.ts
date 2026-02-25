import { z } from "zod";

import type { Config } from "../config.js";
import type { ToolDefinition } from "./types.js";

const CACHE_TTL_MS = 60_000;

let cache:
  | {
      xmr_usd: number;
      xmr_eur: number;
      source: string;
      timestamp: string;
    }
  | undefined;
let cacheExpiry = 0;

async function fetchKraken(): Promise<{ xmr_usd: number; xmr_eur: number } | null> {
  const url = "https://api.kraken.com/0/public/Ticker?pair=XMRUSD,XMREUR";
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    result?: {
      XXMRZUSD?: { c?: [string] };
      XXMRZEUR?: { c?: [string] };
      XMRUSD?: { c?: [string] };
      XMREUR?: { c?: [string] };
    };
  };
  const result = data.result ?? {};
  const usdPair = result.XXMRZUSD ?? result.XMRUSD;
  const eurPair = result.XXMRZEUR ?? result.XMREUR;
  const usd = usdPair?.c?.[0] ? Number(usdPair.c[0]) : NaN;
  const eur = eurPair?.c?.[0] ? Number(eurPair.c[0]) : NaN;
  if (!Number.isFinite(usd) || !Number.isFinite(eur)) return null;
  return { xmr_usd: usd, xmr_eur: eur };
}

async function fetchCoinGecko(): Promise<{ xmr_usd: number; xmr_eur: number } | null> {
  const url = "https://api.coingecko.com/api/v3/simple/price?ids=monero&vs_currencies=usd,eur";
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  const data = (await res.json()) as { monero?: { usd?: number; eur?: number } };
  const monero = data.monero;
  if (!monero || typeof monero.usd !== "number" || typeof monero.eur !== "number") return null;
  return { xmr_usd: monero.usd, xmr_eur: monero.eur };
}

const EXCHANGE_RATE_DISABLED_MESSAGE =
  "Price feed disabled. Set MONERO_ENABLE_PRICE_FEED=true to enable. Note: this will make HTTP requests to external APIs which may leak timing metadata.";

export function buildPriceTools(config: Config): ToolDefinition[] {
  const schema = z.object({}).strict();

  return [
    {
      name: "get_exchange_rate",
      description:
        "Get current XMR/USD and XMR/EUR exchange rate from a public API. Only available when MONERO_ENABLE_PRICE_FEED=true. Makes HTTP requests to external APIs (Kraken, CoinGecko); consider privacy implications.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      schema,
      handler: async () => {
        if (!config.enablePriceFeed) {
          throw new Error(EXCHANGE_RATE_DISABLED_MESSAGE);
        }

        const now = Date.now();
        if (cache && cacheExpiry > now) {
          return cache;
        }

        let result = await fetchKraken();
        let source = "kraken";
        if (!result) {
          result = await fetchCoinGecko();
          source = "coingecko";
        }
        if (!result) {
          throw new Error("Failed to fetch exchange rate from Kraken and CoinGecko");
        }

        const timestamp = new Date().toISOString();
        cache = {
          xmr_usd: result.xmr_usd,
          xmr_eur: result.xmr_eur,
          source,
          timestamp,
        };
        cacheExpiry = now + CACHE_TTL_MS;
        return cache;
      },
    },
  ];
}

