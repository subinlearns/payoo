import type { BankWireEstimate, QuoteBreakdown } from "./types";

/** Platform fee, recorded on-chain per order (must match config.fee_bps). */
export const PLATFORM_FEE_BPS = 100;
/** FX spread over the mid NPR/USD rate. */
export const FX_SPREAD_BPS = 40;
/** How long a quote stays locked. */
export const QUOTE_TTL_SECS = 10 * 60;

/** Typical Nepali bank outward TT for imports, used for the comparison panel. */
export const BANK_WIRE = {
  localFeeNpr: 2_500,
  correspondentFeeUsd: 30,
  fxMarginBps: 250,
  days: "3–7 business days",
};

/**
 * USDC base units (6dp) that deliver `fen` CNY at `rateE6` CNY/USD, rounded up.
 * Mirrors `usdc_for_invoice` in the on-chain program exactly.
 */
export function usdcForInvoice(fen: number, rateE6: number): number {
  if (rateE6 <= 0) throw new Error("rate must be positive");
  const num = BigInt(fen) * 10_000_000_000n;
  const den = BigInt(rateE6);
  return Number((num + den - 1n) / den);
}

/** On-chain fee formula: floor(amount * bps / 10_000). */
export function feeForAmount(amountUsdc: number, feeBps: number): number {
  return Number((BigInt(amountUsdc) * BigInt(feeBps)) / 10_000n);
}

const usdcToNprPaisa = (usdc: number, usdNpr: number) => Math.ceil((usdc / 1e6) * usdNpr * 100);

export function bankWireEstimate(amountUsdc: number, midUsdNpr: number): BankWireEstimate {
  const principal = usdcToNprPaisa(amountUsdc, midUsdNpr);
  const localFeeNprPaisa = BANK_WIRE.localFeeNpr * 100;
  const correspondentFeeNprPaisa = Math.ceil(BANK_WIRE.correspondentFeeUsd * midUsdNpr * 100);
  const fxMarginNprPaisa = Math.ceil((principal * BANK_WIRE.fxMarginBps) / 10_000);
  return {
    totalNprPaisa: principal + localFeeNprPaisa + correspondentFeeNprPaisa + fxMarginNprPaisa,
    localFeeNprPaisa,
    correspondentFeeNprPaisa,
    fxMarginNprPaisa,
    days: BANK_WIRE.days,
  };
}

export interface QuoteInput {
  invoiceCnyFen: number;
  usdCny: number;
  usdNpr: number;
  feeBps?: number;
  spreadBps?: number;
}

export function computeQuote({
  invoiceCnyFen,
  usdCny,
  usdNpr,
  feeBps = PLATFORM_FEE_BPS,
  spreadBps = FX_SPREAD_BPS,
}: QuoteInput): QuoteBreakdown {
  if (!Number.isInteger(invoiceCnyFen) || invoiceCnyFen <= 0) throw new Error("invoice must be a positive amount");
  if (!(usdCny > 0) || !(usdNpr > 0)) throw new Error("rates must be positive");

  const quoteRateE6 = Math.round(usdCny * 1e6);
  const amountUsdc = usdcForInvoice(invoiceCnyFen, quoteRateE6);
  const feeUsdc = feeForAmount(amountUsdc, feeBps);

  const buyerUsdNpr = usdNpr * (1 + spreadBps / 10_000);
  const midPrincipal = usdcToNprPaisa(amountUsdc, usdNpr);
  const principalNprPaisa = usdcToNprPaisa(amountUsdc, buyerUsdNpr);
  const feeNprPaisa = usdcToNprPaisa(feeUsdc, buyerUsdNpr);
  const totalNprPaisa = principalNprPaisa + feeNprPaisa;

  const bankWire = bankWireEstimate(amountUsdc, usdNpr);

  return {
    invoiceCnyFen,
    quoteRateE6,
    buyerUsdNpr,
    amountUsdc,
    feeUsdc,
    feeBps,
    spreadBps,
    principalNprPaisa,
    feeNprPaisa,
    spreadNprPaisa: principalNprPaisa - midPrincipal,
    totalNprPaisa,
    effectiveCnyNpr: totalNprPaisa / invoiceCnyFen,
    bankWire,
    savingsNprPaisa: bankWire.totalNprPaisa - totalNprPaisa,
  };
}
