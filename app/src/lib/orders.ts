import { randomBytes, randomUUID } from "node:crypto";
import { readDb, withDb } from "./db";
import { getRates } from "./fx";
import { QUOTE_TTL_SECS, computeQuote } from "./quote";
import { supplierHash } from "./seed";
import { getChain, ProgramError, type TxResult } from "./chain";
import { orderPda, sha256, vaultPda } from "./chain/pda";
import type { Order, OrderEvent, OrderStatus, PayoutMethod, Quote, RailMethod } from "./types";
import { PAYOUT_LABELS, RAIL_LABELS } from "./format";

export class ServiceError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/** Push a fresh reference rate on-chain before pricing an order if the feed is older than this. */
const RATE_REFRESH_SECS = 120;
/** ...or if it has drifted this far from the market rate. */
const RATE_DRIFT_PUSH = 0.0025;

export const DISPUTE_REASONS: Record<number, string> = {
  1: "Goods not received",
  2: "Not as described / damaged",
  3: "Wrong quantity",
  4: "Other",
};

const RAIL_PREFIX: Record<RailMethod, string> = {
  esewa: "ESW",
  khalti: "KHL",
  connectips: "CIPS",
  fonepay_qr: "FPQR",
  bank_transfer: "NCHL",
};

const nowIso = () => new Date().toISOString();

export async function createQuote(
  userId: string,
  input: { supplierId: string; invoiceCny: number; invoiceRef: string; escrowMode: boolean },
): Promise<Quote> {
  const db = readDb();
  const supplier = db.suppliers.find((s) => s.id === input.supplierId && s.ownerId === userId);
  if (!supplier) throw new ServiceError("Supplier not found", 404);
  const invoiceCnyFen = Math.round(Number(input.invoiceCny) * 100);
  if (!Number.isFinite(invoiceCnyFen) || invoiceCnyFen < 100) throw new ServiceError("Enter an invoice amount of at least ¥1");
  if (invoiceCnyFen > 30_000_000) throw new ServiceError("Pilot limit is ¥300,000 per payment");

  const rates = await getRates();
  const breakdown = computeQuote({ invoiceCnyFen, usdCny: rates.usdCny, usdNpr: rates.usdNpr });
  const created = new Date();
  const quote: Quote = {
    ...breakdown,
    id: `qt_${randomBytes(6).toString("hex")}`,
    userId,
    supplierId: supplier.id,
    invoiceRef: input.invoiceRef.trim().slice(0, 64) || "Unreferenced invoice",
    escrowMode: input.escrowMode,
    rates,
    status: "open",
    createdAt: created.toISOString(),
    expiresAt: new Date(created.getTime() + QUOTE_TTL_SECS * 1000).toISOString(),
  };
  withDb((d) => {
    d.quotes.unshift(quote);
    d.quotes = d.quotes.slice(0, 200);
  });
  return quote;
}

export function getQuote(id: string) {
  return readDb().quotes.find((q) => q.id === id) ?? null;
}

async function ensureFreshRate() {
  const chain = getChain();
  const info = await chain.info();
  if (!info.ready) throw new ServiceError(info.error ?? "Chain not ready", 503);
  const now = Math.floor(Date.now() / 1000);
  const rates = await getRates();
  const usdCnyE6 = Math.round(rates.usdCny * 1e6);
  const feed = info.rateFeed;
  const drift = feed ? Math.abs(feed.usdCnyE6 - usdCnyE6) / usdCnyE6 : 1;
  if (feed && now - feed.updatedAt < RATE_REFRESH_SECS && drift < RATE_DRIFT_PUSH) return;
  const source = rates.source === "pyth" ? 1 : rates.source === "open.er-api" ? 2 : 0;
  await chain.pushRate(usdCnyE6, Math.round(rates.usdNpr * 1e6), source);
}

function friendlyChainError(e: unknown): ServiceError {
  if (e instanceof ProgramError) {
    const map: Record<string, string> = {
      RateDeviation: "The market rate moved more than 1% since your quote. Please request a new quote.",
      StaleRate: "The on-chain FX reference is stale. Please retry in a moment.",
      QuoteExpired: "This quote has expired. Please request a new one.",
      OrderTooLarge: "This payment exceeds the per-order limit.",
      Paused: "Payments are temporarily paused by the platform.",
    };
    return new ServiceError(map[e.errorName] ?? `Program rejected the transaction: ${e.errorName}`, 409);
  }
  if (e instanceof ServiceError) return e;
  return new ServiceError(`Transaction failed: ${(e as Error).message}`, 502);
}

function event(type: string, label: string, actor: OrderEvent["actor"], tx?: TxResult, note?: string): OrderEvent {
  return { type, label, actor, at: nowIso(), txSig: tx?.sig, note };
}

/** Mock NPR collection, then lock USDC in the on-chain escrow (and release immediately for direct payments). */
export async function payQuote(quoteId: string, userId: string, method: RailMethod): Promise<Order> {
  const db = readDb();
  const quote = db.quotes.find((q) => q.id === quoteId && q.userId === userId);
  if (!quote) throw new ServiceError("Quote not found", 404);
  if (quote.status === "paid" && quote.orderId) throw new ServiceError("Quote already paid", 409);
  if (new Date(quote.expiresAt).getTime() < Date.now()) {
    withDb((d) => {
      const q = d.quotes.find((x) => x.id === quoteId);
      if (q) q.status = "expired";
    });
    throw new ServiceError("This quote has expired. Please request a new one.", 410);
  }
  const user = db.users.find((u) => u.id === userId)!;
  const supplier = db.suppliers.find((s) => s.id === quote.supplierId)!;
  if (!RAIL_PREFIX[method]) throw new ServiceError("Unsupported payment method");

  // 1. NPR collected through the local rail (simulated gateway callback).
  const rail = {
    method,
    reference: `${RAIL_PREFIX[method]}${Date.now().toString().slice(-10)}`,
    paidAt: nowIso(),
  };

  // 2. Lock USDC in the escrow PDA.
  const chain = getChain();
  const orderId = randomUUID();
  const hash = supplierHash(supplier);
  let funded: TxResult;
  try {
    await ensureFreshRate();
    funded = await chain.createAndFund({
      orderId,
      buyer: user.wallet.publicKey,
      supplierHash: Buffer.from(hash, "hex"),
      invoiceCnyFen: quote.invoiceCnyFen,
      quoteRateE6: quote.quoteRateE6,
      amountUsdc: quote.amountUsdc,
      nprPaidPaisa: quote.totalNprPaisa,
      quoteExpiresAt: Math.floor(new Date(quote.expiresAt).getTime() / 1000),
      escrowMode: quote.escrowMode,
    });
  } catch (e) {
    throw friendlyChainError(e);
  }

  const pda = orderPda(orderId);
  const order: Order = {
    id: orderId,
    quoteId: quote.id,
    userId,
    supplierId: supplier.id,
    invoiceRef: quote.invoiceRef,
    escrowMode: quote.escrowMode,
    invoiceCnyFen: quote.invoiceCnyFen,
    quoteRateE6: quote.quoteRateE6,
    amountUsdc: quote.amountUsdc,
    feeUsdc: quote.feeUsdc,
    totalNprPaisa: quote.totalNprPaisa,
    savingsNprPaisa: quote.savingsNprPaisa,
    status: "FUNDED",
    orderPda: pda.toBase58(),
    vaultPda: vaultPda(pda).toBase58(),
    buyerWallet: user.wallet.publicKey,
    supplierHash: hash,
    rail,
    events: [
      { type: "QUOTE_LOCKED", label: "Quote locked", at: quote.createdAt, actor: "platform" },
      { type: "NPR_RECEIVED", label: `NPR received via ${RAIL_LABELS[method]}`, at: rail.paidAt, actor: "rail", note: rail.reference },
      event("FUNDED", "USDC locked in escrow", "program", funded),
    ],
    createdAt: quote.createdAt,
    updatedAt: nowIso(),
  };

  withDb((d) => {
    d.orders.unshift(order);
    const q = d.quotes.find((x) => x.id === quoteId);
    if (q) {
      q.status = "paid";
      q.orderId = orderId;
    }
  });

  // 3. Direct payments go straight to the settlement partner.
  if (!quote.escrowMode) {
    return applyTx(orderId, () => chain.release(orderId, { kind: "operator" }), (o, tx) => {
      o.status = "RELEASED";
      o.events.push(event("RELEASED", "Released to settlement partner", "program", tx));
    });
  }
  return order;
}

async function applyTx(
  orderId: string,
  send: () => Promise<TxResult>,
  update: (o: Order, tx: TxResult) => void,
): Promise<Order> {
  let tx: TxResult;
  try {
    tx = await send();
  } catch (e) {
    throw friendlyChainError(e);
  }
  return withDb((d) => {
    const o = d.orders.find((x) => x.id === orderId)!;
    update(o, tx);
    o.updatedAt = nowIso();
    return o;
  });
}

export type OrderAction =
  | { action: "ship"; carrier: string; trackingNumber: string; windowDays: number }
  | { action: "confirm_delivery" }
  | { action: "dispute"; reason: number; note: string }
  | { action: "resolve"; refund: boolean }
  | { action: "settle"; reference?: string }
  | { action: "refund" }
  | { action: "release" };

export type Actor = "buyer" | "supplier" | "partner" | "admin";

const ALLOWED: Record<OrderAction["action"], { actors: Actor[]; from: OrderStatus[] }> = {
  ship: { actors: ["supplier", "admin"], from: ["FUNDED"] },
  confirm_delivery: { actors: ["buyer"], from: ["FUNDED", "IN_TRANSIT"] },
  dispute: { actors: ["buyer"], from: ["FUNDED", "IN_TRANSIT"] },
  resolve: { actors: ["admin"], from: ["DISPUTED"] },
  settle: { actors: ["partner"], from: ["RELEASED"] },
  refund: { actors: ["admin"], from: ["FUNDED", "IN_TRANSIT"] },
  release: { actors: ["admin"], from: ["FUNDED", "DELIVERED"] },
};

export async function performAction(orderId: string, actor: Actor, userId: string, a: OrderAction): Promise<Order> {
  const db = readDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) throw new ServiceError("Order not found", 404);
  if (order.seeded) throw new ServiceError("Historical demo orders are read-only", 409);
  const rule = ALLOWED[a.action];
  if (!rule) throw new ServiceError("Unknown action");
  if (!rule.actors.includes(actor)) throw new ServiceError("Not allowed for this role", 403);
  if (actor === "buyer" && order.userId !== userId) throw new ServiceError("Not your order", 403);
  if (!rule.from.includes(order.status)) throw new ServiceError(`Cannot ${a.action} an order that is ${order.status}`, 409);

  const chain = getChain();
  const buyer = db.users.find((u) => u.id === order.userId)!;
  const supplier = db.suppliers.find((s) => s.id === order.supplierId)!;

  switch (a.action) {
    case "ship": {
      const days = Math.min(Math.max(Math.round(a.windowDays) || 21, 1), 90);
      return applyTx(orderId, () => chain.markInTransit(orderId, days * 86_400), (o, tx) => {
        const shippedAt = nowIso();
        o.status = "IN_TRANSIT";
        o.tracking = {
          carrier: a.carrier || "China Post EMS",
          number: a.trackingNumber || `EE${Date.now().toString().slice(-9)}CN`,
          shippedAt,
          deliveryDeadline: new Date(Date.now() + days * 86_400_000).toISOString(),
        };
        o.events.push(event("IN_TRANSIT", `Shipped via ${o.tracking.carrier}`, "supplier", tx, o.tracking.number));
      });
    }
    case "confirm_delivery": {
      await applyTx(orderId, () => chain.confirmDelivery(orderId, buyer.wallet.secretKey), (o, tx) => {
        o.status = "DELIVERED";
        o.events.push(event("DELIVERED", "Buyer confirmed delivery", "buyer", tx));
      });
      return applyTx(
        orderId,
        () => chain.release(orderId, { kind: "buyer", secretKey: buyer.wallet.secretKey }),
        (o, tx) => {
          o.status = "RELEASED";
          o.events.push(event("RELEASED", "Released to settlement partner", "program", tx));
        },
      );
    }
    case "dispute": {
      const reason = DISPUTE_REASONS[a.reason] ? a.reason : 4;
      return applyTx(orderId, () => chain.openDispute(orderId, buyer.wallet.secretKey, reason), (o, tx) => {
        o.status = "DISPUTED";
        o.dispute = { reason: DISPUTE_REASONS[reason], note: (a.note || "").slice(0, 500), openedAt: nowIso() };
        o.events.push(event("DISPUTED", `Dispute opened: ${DISPUTE_REASONS[reason]}`, "buyer", tx));
      });
    }
    case "resolve": {
      return applyTx(orderId, () => chain.resolveDispute(orderId, a.refund), (o, tx) => {
        o.status = a.refund ? "REFUNDED" : "RELEASED";
        if (o.dispute) {
          o.dispute.resolution = a.refund ? "refunded" : "released";
          o.dispute.resolvedAt = nowIso();
        }
        o.events.push(
          event(
            a.refund ? "REFUNDED" : "RELEASED",
            a.refund ? "Dispute upheld: refunded to buyer" : "Dispute rejected: released to settlement partner",
            "admin",
            tx,
            a.refund ? `${(o.totalNprPaisa / 100).toFixed(2)} NPR returned via ${o.rail.method}` : undefined,
          ),
        );
      });
    }
    case "settle": {
      const method: PayoutMethod = supplier.payoutMethod;
      const reference =
        a.reference?.trim() || `${method === "bank" ? "CNAPS" : method.toUpperCase()}${Date.now().toString().slice(-12)}`;
      return applyTx(orderId, () => chain.markSettled(orderId, sha256(reference)), (o, tx) => {
        o.status = "SETTLED";
        o.payout = { method, reference, cnyFen: o.invoiceCnyFen, paidAt: nowIso() };
        o.events.push(event("SETTLED", `CNY paid to supplier via ${PAYOUT_LABELS[method]}`, "partner", tx, reference));
      });
    }
    case "refund": {
      return applyTx(orderId, () => chain.refund(orderId), (o, tx) => {
        o.status = "REFUNDED";
        o.events.push(event("REFUNDED", "Refunded by platform", "admin", tx));
      });
    }
    case "release": {
      return applyTx(orderId, () => chain.release(orderId, { kind: "operator" }), (o, tx) => {
        o.status = "RELEASED";
        o.events.push(event("RELEASED", "Released to settlement partner", "admin", tx));
      });
    }
  }
}

export function addSupplier(
  userId: string,
  input: {
    name: string;
    nameZh?: string;
    marketplace: string;
    storeUrl?: string;
    city?: string;
    payoutMethod: PayoutMethod;
    payoutName: string;
    payoutAccount: string;
  },
) {
  const name = input.name?.trim();
  if (!name) throw new ServiceError("Supplier name is required");
  if (!["alipay", "wechat", "bank"].includes(input.payoutMethod)) throw new ServiceError("Choose a payout method");
  if (!input.payoutAccount?.trim() || !input.payoutName?.trim()) throw new ServiceError("Payout details are required");
  const acct = input.payoutAccount.trim();
  const supplier = {
    id: `sup_${randomBytes(4).toString("hex")}`,
    ownerId: userId,
    name,
    nameZh: input.nameZh?.trim() || undefined,
    marketplace: (["Alibaba", "1688", "AliExpress", "Taobao", "Direct"].includes(input.marketplace)
      ? input.marketplace
      : "Direct") as never,
    storeUrl: input.storeUrl?.trim() || "",
    city: input.city?.trim() || "China",
    payoutMethod: input.payoutMethod,
    payoutName: input.payoutName.trim(),
    payoutAccount: acct.length > 4 ? `•••• ${acct.slice(-4)}` : acct,
    verified: false,
    createdAt: nowIso(),
  };
  withDb((d) => d.suppliers.push(supplier));
  return supplier;
}
