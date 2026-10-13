/**
 * In-process replica of the payoo_escrow program.
 *
 * Enforces the same state machine, validations and error codes as
 * programs/payoo-escrow so the full product can be demoed without a validator,
 * a funded wallet or network access. Switch PAYOO_CHAIN_MODE to devnet/localnet
 * to run the identical flow against the real program.
 */
import { randomBytes } from "node:crypto";
import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { readDb, withDb } from "../db";
import { usdcForInvoice } from "../quote";
import { PROGRAM_ID, configPda, orderPda, programError, rateFeedPda, vaultPda } from "./pda";
import {
  ProgramError,
  type ChainAdapter,
  type ChainInfo,
  type CreateOrderArgs,
  type OnchainOrder,
  type OnchainStatus,
  type ReleaseSigner,
  type TxResult,
} from "./types";

const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SYSTEM = "11111111111111111111111111111111";
const BPS = 10_000;
const MAX_QUOTE_TTL_SECS = 3600;
const MAX_DELIVERY_WINDOW_SECS = 90 * 24 * 3600;

export interface SimChainState {
  slot: number;
  config: {
    admin: string;
    operator: string;
    oracleAuthority: string;
    settlementPartner: string;
    usdcMint: string;
    treasury: string;
    settlementTokenAccount: string;
    feeBps: number;
    maxQuoteDeviationBps: number;
    maxRateStalenessSecs: number;
    disputeWindowSecs: number;
    maxOrderUsdc: number;
    paused: boolean;
    orderCount: number;
    totalVolumeUsdc: number;
    totalSettledUsdc: number;
    totalRefundedUsdc: number;
  };
  rateFeed: { usdCnyE6: number; usdNprE6: number; updatedAt: number; source: number };
  /** token account -> USDC base units */
  balances: Record<string, number>;
  orders: Record<string, OnchainOrder>;
}

export function initialSimState(nowSecs: number, usdCnyE6: number, usdNprE6: number): SimChainState {
  const operator = Keypair.generate().publicKey;
  const partner = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const treasury = getAssociatedTokenAddressSync(mint, operator).toBase58();
  const settlementTokenAccount = getAssociatedTokenAddressSync(mint, partner).toBase58();
  return {
    slot: 318_400_000,
    config: {
      admin: Keypair.generate().publicKey.toBase58(),
      operator: operator.toBase58(),
      oracleAuthority: Keypair.generate().publicKey.toBase58(),
      settlementPartner: partner.toBase58(),
      usdcMint: mint.toBase58(),
      treasury,
      settlementTokenAccount,
      feeBps: 100,
      maxQuoteDeviationBps: 100,
      maxRateStalenessSecs: 900,
      disputeWindowSecs: 3 * 24 * 3600,
      maxOrderUsdc: 50_000 * 1e6,
      paused: false,
      orderCount: 0,
      totalVolumeUsdc: 0,
      totalSettledUsdc: 0,
      totalRefundedUsdc: 0,
    },
    rateFeed: { usdCnyE6, usdNprE6, updatedAt: nowSecs, source: 2 },
    balances: { [treasury]: 250_000 * 1e6, [settlementTokenAccount]: 0 },
    orders: {},
  };
}

function fail(name: string): never {
  const e = programError(name);
  if (!e) throw new Error(name);
  throw new ProgramError(
    e.code,
    e.name,
    `AnchorError: Error Code: ${e.name}. Error Number: ${e.code}. Error Message: ${e.msg}.`,
  );
}

const require_ = (cond: boolean, name: string) => {
  if (!cond) fail(name);
};

const ixName = (snake: string) => snake.replace(/(^|_)([a-z])/g, (_, __, c: string) => c.toUpperCase());

function buildLogs(ixs: string[], extra: Record<string, string[]> = {}) {
  const pid = PROGRAM_ID.toBase58();
  const logs: string[] = [];
  for (const ix of ixs) {
    logs.push(`Program ${pid} invoke [1]`, `Program log: Instruction: ${ixName(ix)}`);
    for (const inner of extra[ix] ?? []) {
      const prog = inner === "CreateAccount" ? SYSTEM : TOKEN;
      logs.push(`Program ${prog} invoke [2]`);
      if (prog === TOKEN) logs.push(`Program log: Instruction: ${inner}`);
      logs.push(`Program ${prog} success`);
    }
    const cu = 9_000 + Math.floor(Math.random() * 30_000);
    logs.push(`Program ${pid} consumed ${cu} of 200000 compute units`, `Program ${pid} success`);
  }
  return logs;
}

export class SimulatedChain implements ChainAdapter {
  mode = "simulated" as const;
  cluster = "simulated";

  explorerTx(sig: string) {
    return `/ledger/${sig}`;
  }
  explorerAddress(address: string) {
    return `/ledger?address=${address}`;
  }

  /** Executes `mutate` atomically against simulated state and records a transaction. */
  private exec(
    ixs: string[],
    signer: string,
    orderId: string | undefined,
    mutate: (s: SimChainState, now: number) => void,
    inner: Record<string, string[]> = {},
  ): TxResult {
    return withDb((db) => {
      const now = Math.floor(Date.now() / 1000);
      // Work on a copy so a failed validation leaves state untouched (tx atomicity).
      const draft: SimChainState = structuredClone(db.sim);
      mutate(draft, now);
      draft.slot += 1 + Math.floor(Math.random() * 3);
      db.sim = draft;
      const sig = bs58.encode(randomBytes(64));
      db.txs.unshift({
        sig,
        slot: draft.slot,
        instructions: ixs,
        orderId,
        signer,
        at: new Date().toISOString(),
        cluster: "simulated",
        simulated: true,
        logs: buildLogs(ixs, inner),
      });
      return { sig, slot: draft.slot };
    });
  }

  private order(s: SimChainState, orderId: string) {
    const o = s.orders[orderPda(orderId).toBase58()];
    if (!o) throw new ProgramError(3012, "AccountNotInitialized", "AnchorError: The program expected this account to be already initialized.");
    return o;
  }

  private drain(s: SimChainState, o: OnchainOrder, to: string) {
    const amount = s.balances[o.vault] ?? 0;
    s.balances[to] = (s.balances[to] ?? 0) + amount;
    delete s.balances[o.vault];
    o.vaultBalance = 0;
    return amount;
  }

  async info(): Promise<ChainInfo> {
    const s = readDb().sim;
    return {
      mode: this.mode,
      cluster: this.cluster,
      ready: true,
      programId: PROGRAM_ID.toBase58(),
      configPda: configPda().toBase58(),
      rateFeedPda: rateFeedPda().toBase58(),
      ...s.config,
      treasuryUsdc: s.balances[s.config.treasury] ?? 0,
      settlementUsdc: s.balances[s.config.settlementTokenAccount] ?? 0,
      rateFeed: s.rateFeed,
    };
  }

  async pushRate(usdCnyE6: number, usdNprE6: number, source: number) {
    const signer = readDb().sim.config.oracleAuthority;
    return this.exec(["push_rate"], signer, undefined, (s, now) => {
      require_(usdCnyE6 > 0 && usdNprE6 > 0, "InvalidParam");
      s.rateFeed = { usdCnyE6, usdNprE6, updatedAt: now, source };
    });
  }

  async createAndFund(a: CreateOrderArgs) {
    const signer = readDb().sim.config.operator;
    const order = orderPda(a.orderId);
    const vault = vaultPda(order).toBase58();
    return this.exec(
      ["create_order", "fund_order"],
      signer,
      a.orderId,
      (s, now) => {
        const c = s.config;
        // create_order
        require_(!c.paused, "Paused");
        require_(a.invoiceCnyFen > 0 && a.amountUsdc > 0, "ZeroAmount");
        require_(a.amountUsdc <= c.maxOrderUsdc, "OrderTooLarge");
        require_(a.quoteExpiresAt > now, "QuoteExpired");
        require_(a.quoteExpiresAt <= now + MAX_QUOTE_TTL_SECS, "InvalidParam");
        require_(now - s.rateFeed.updatedAt <= c.maxRateStalenessSecs, "StaleRate");
        const diff = Math.abs(a.quoteRateE6 - s.rateFeed.usdCnyE6);
        require_(diff * BPS <= c.maxQuoteDeviationBps * s.rateFeed.usdCnyE6, "RateDeviation");
        const expected = usdcForInvoice(a.invoiceCnyFen, a.quoteRateE6);
        require_(a.amountUsdc >= expected && a.amountUsdc <= expected + 1, "AmountMismatch");
        if (s.orders[order.toBase58()]) {
          throw new ProgramError(0, "AccountInUse", "Allocate: account already in use");
        }
        const feeUsdc = Math.floor((a.amountUsdc * c.feeBps) / BPS);
        // fund_order
        const treasuryBal = s.balances[c.treasury] ?? 0;
        if (treasuryBal < a.amountUsdc) {
          throw new ProgramError(1, "InsufficientFunds", "Program log: Error: insufficient funds");
        }
        s.balances[c.treasury] = treasuryBal - a.amountUsdc;
        s.balances[vault] = a.amountUsdc;
        c.orderCount += 1;
        c.totalVolumeUsdc += a.amountUsdc;
        s.orders[order.toBase58()] = {
          address: order.toBase58(),
          vault,
          buyer: a.buyer,
          status: "Funded",
          invoiceCnyFen: a.invoiceCnyFen,
          quoteRateE6: a.quoteRateE6,
          amountUsdc: a.amountUsdc,
          feeUsdc,
          nprPaidPaisa: a.nprPaidPaisa,
          escrowMode: a.escrowMode,
          createdAt: now,
          quoteExpiresAt: a.quoteExpiresAt,
          fundedAt: now,
          shippedAt: 0,
          deliveryDeadline: 0,
          releasedAt: 0,
          settledAt: 0,
          payoutRef: "",
          disputeReason: 0,
          vaultBalance: a.amountUsdc,
        };
      },
      { create_order: ["CreateAccount", "CreateAccount", "InitializeAccount3"], fund_order: ["TransferChecked"] },
    );
  }

  async markInTransit(orderId: string, windowSecs: number) {
    const signer = readDb().sim.config.operator;
    return this.exec(["mark_in_transit"], signer, orderId, (s, now) => {
      require_(windowSecs > 0 && windowSecs <= MAX_DELIVERY_WINDOW_SECS, "InvalidParam");
      const o = this.order(s, orderId);
      require_(o.escrowMode, "NotEscrowMode");
      require_(o.status === "Funded", "InvalidStatus");
      o.status = "InTransit";
      o.shippedAt = now;
      o.deliveryDeadline = now + windowSecs;
    });
  }

  private buyerAction(orderId: string, secretKey: string, ix: string, next: OnchainStatus, reason = 0) {
    const buyer = Keypair.fromSecretKey(bs58.decode(secretKey)).publicKey.toBase58();
    return this.exec([ix], buyer, orderId, (s) => {
      const o = this.order(s, orderId);
      require_(o.buyer === buyer, "Unauthorized");
      require_(o.escrowMode, "NotEscrowMode");
      require_(o.status === "Funded" || o.status === "InTransit", "InvalidStatus");
      o.status = next;
      if (next === "Disputed") o.disputeReason = reason;
    });
  }

  async confirmDelivery(orderId: string, buyerSecretKey: string) {
    return this.buyerAction(orderId, buyerSecretKey, "confirm_delivery", "Delivered");
  }

  async openDispute(orderId: string, buyerSecretKey: string, reason: number) {
    return this.buyerAction(orderId, buyerSecretKey, "open_dispute", "Disputed", reason);
  }

  async release(orderId: string, by: ReleaseSigner) {
    const cfg = readDb().sim.config;
    const authority =
      by.kind === "buyer" ? Keypair.fromSecretKey(bs58.decode(by.secretKey)).publicKey.toBase58() : cfg.operator;
    return this.exec(
      ["release_to_settlement"],
      authority,
      orderId,
      (s, now) => {
        const c = s.config;
        const o = this.order(s, orderId);
        const isPlatform = authority === c.operator || authority === c.admin;
        if (!o.escrowMode && o.status === "Funded") {
          require_(isPlatform, "Unauthorized");
        } else if (o.escrowMode && o.status === "Delivered") {
          require_(isPlatform || authority === o.buyer, "Unauthorized");
        } else if (o.escrowMode && o.status === "InTransit") {
          require_(now > o.deliveryDeadline + c.disputeWindowSecs, "ReleaseWindowOpen");
        } else {
          fail("InvalidStatus");
        }
        this.drain(s, o, c.settlementTokenAccount);
        o.status = "Released";
        o.releasedAt = now;
      },
      { release_to_settlement: ["TransferChecked", "CloseAccount"] },
    );
  }

  async markSettled(orderId: string, payoutRef: Buffer) {
    const signer = readDb().sim.config.settlementPartner;
    return this.exec(["mark_settled"], signer, orderId, (s, now) => {
      const o = this.order(s, orderId);
      require_(o.status === "Released", "InvalidStatus");
      o.status = "Settled";
      o.settledAt = now;
      o.payoutRef = payoutRef.toString("hex");
      s.config.totalSettledUsdc += o.amountUsdc;
      // The partner converts USDC -> CNY off-chain; model the USDC leaving its account.
      const acct = s.config.settlementTokenAccount;
      s.balances[acct] = Math.max(0, (s.balances[acct] ?? 0) - o.amountUsdc);
    });
  }

  async refund(orderId: string) {
    const signer = readDb().sim.config.operator;
    return this.exec(
      ["refund"],
      signer,
      orderId,
      (s) => {
        const o = this.order(s, orderId);
        require_(o.status === "Funded" || o.status === "InTransit", "InvalidStatus");
        s.config.totalRefundedUsdc += this.drain(s, o, s.config.treasury);
        o.status = "Refunded";
      },
      { refund: ["TransferChecked", "CloseAccount"] },
    );
  }

  async resolveDispute(orderId: string, refundBuyer: boolean) {
    const signer = readDb().sim.config.admin;
    return this.exec(
      ["resolve_dispute"],
      signer,
      orderId,
      (s, now) => {
        const o = this.order(s, orderId);
        require_(o.status === "Disputed", "InvalidStatus");
        if (refundBuyer) {
          s.config.totalRefundedUsdc += this.drain(s, o, s.config.treasury);
          o.status = "Refunded";
        } else {
          this.drain(s, o, s.config.settlementTokenAccount);
          o.status = "Released";
          o.releasedAt = now;
        }
      },
      { resolve_dispute: ["TransferChecked", "CloseAccount"] },
    );
  }

  async fetchOrder(orderId: string) {
    return readDb().sim.orders[orderPda(orderId).toBase58()] ?? null;
  }
}
