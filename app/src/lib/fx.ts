import type { Rates } from "./types";

const CACHE_MS = 60_000;
/** Last-resort rates if every live source is unreachable (demo must still run offline). */
const FALLBACK = { usdCny: 6.71, usdNpr: 153.4 };

const g = globalThis as unknown as { __payooRates?: { at: number; rates: Rates } };

async function fetchJson(url: string, timeoutMs = 4000): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

/** USD/CNH from Pyth Hermes (requires PYTH_HERMES_URL, since Hermes now needs an API key). */
async function fromPyth(): Promise<{ usdCny: number; publishTime: string } | null> {
  const base = process.env.PYTH_HERMES_URL;
  const feed = process.env.PYTH_USDCNH_FEED_ID;
  if (!base || !feed) return null;
  const url = `${base.replace(/\/$/, "")}/v2/updates/price/latest?ids[]=${feed}&parsed=true`;
  const data = (await fetchJson(url)) as {
    parsed?: { price: { price: string; expo: number; publish_time: number } }[];
  };
  const p = data.parsed?.[0]?.price;
  if (!p) return null;
  const usdCny = Number(p.price) * 10 ** p.expo;
  if (!(usdCny > 0)) return null;
  return { usdCny, publishTime: new Date(p.publish_time * 1000).toISOString() };
}

async function fromOpenEr(): Promise<{ usdCny: number; usdNpr: number } | null> {
  const data = (await fetchJson("https://open.er-api.com/v6/latest/USD")) as {
    result?: string;
    rates?: Record<string, number>;
  };
  if (data.result !== "success" || !data.rates?.CNY || !data.rates?.NPR) return null;
  return { usdCny: data.rates.CNY, usdNpr: data.rates.NPR };
}

export async function getRates(force = false): Promise<Rates> {
  const cached = g.__payooRates;
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.rates;

  const [pyth, market] = await Promise.all([
    fromPyth().catch(() => null),
    fromOpenEr().catch(() => null),
  ]);

  let rates: Rates;
  if (pyth) {
    const usdNpr = market?.usdNpr ?? FALLBACK.usdNpr;
    rates = {
      usdCny: pyth.usdCny,
      usdNpr,
      cnyNpr: usdNpr / pyth.usdCny,
      source: "pyth",
      fetchedAt: new Date().toISOString(),
      pythPublishTime: pyth.publishTime,
    };
  } else if (market) {
    rates = {
      ...market,
      cnyNpr: market.usdNpr / market.usdCny,
      source: "open.er-api",
      fetchedAt: new Date().toISOString(),
    };
  } else {
    rates = {
      ...FALLBACK,
      cnyNpr: FALLBACK.usdNpr / FALLBACK.usdCny,
      source: "fallback",
      fetchedAt: new Date().toISOString(),
    };
  }
  g.__payooRates = { at: Date.now(), rates };
  return rates;
}
