/**
 * Real chain adapter: talks to the deployed payoo_escrow program through the
 * Anchor client, using the IDL generated from programs/payoo-escrow.
 * Used when PAYOO_CHAIN_MODE is "devnet" or "localnet".
 */
import fs from "node:fs";
import path from "node:path";
import bs58 from "bs58";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { withDb } from "../db";
import idlJson from "./payoo_escrow.json";
import {
  PROGRAM_ERRORS,
  PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  configPda,
  orderPda,
  rateFeedPda,
  uuidToBytes,
  vaultPda,
} from "./pda";
import {
  ProgramError,
  type ChainAdapter,
  type ChainInfo,
  type ChainMode,
  type CreateOrderArgs,
  type OnchainOrder,
  type OnchainStatus,
  type ReleaseSigner,
  type TxResult,
} from "./types";

const { BN } = anchor;

/** Written by `npm run devnet:setup`. */
export interface ChainKeysFile {
  cluster: string;
  rpcUrl: string;
  admin: string;
  operator: string;
  oracle: string;
  partner: string;
  usdcMint: string;
  treasury: string;
  settlementTokenAccount: string;
}

export const keysFilePath = () =>
  path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.PAYOO_KEYS_FILE || ".data/chain-keys.json");

const kp = (secret: string) => Keypair.fromSecretKey(bs58.decode(secret));

class KeypairWallet {
  constructor(readonly payer: Keypair) {}
  get publicKey() {
    return this.payer.publicKey;
  }
  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if (tx instanceof VersionedTransaction) tx.sign([this.payer]);
    else tx.partialSign(this.payer);
    return tx;
  }
  async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
    return Promise.all(txs.map((t) => this.signTransaction(t)));
  }
}

const STATUS_NAMES: Record<string, OnchainStatus> = {
  created: "Created",
  funded: "Funded",
  inTransit: "InTransit",
  delivered: "Delivered",
  released: "Released",
  settled: "Settled",
  disputed: "Disputed",
  refunded: "Refunded",
  cancelled: "Cancelled",
};

const num = (v: { toString(): string } | number) => Number(v.toString());

/** Normalizes Anchor / RPC errors into ProgramError with the IDL error name. */
function translate(e: unknown): Error {
  const err = e as { error?: { errorCode?: { code: string; number: number } }; logs?: string[]; message?: string };
  if (err?.error?.errorCode) {
    const { code, number } = err.error.errorCode;
    const known = PROGRAM_ERRORS.get(number);
    return new ProgramError(number, code, known?.msg ?? err.message ?? code);
  }
  const m = /custom program error: 0x([0-9a-f]+)/i.exec(err?.message ?? "");
  if (m) {
    const n = parseInt(m[1], 16);
    const known = PROGRAM_ERRORS.get(n);
    if (known) return new ProgramError(n, known.name, known.msg);
  }
  return e instanceof Error ? e : new Error(String(e));
}

export class AnchorChain implements ChainAdapter {
  cluster: string;
  private connection: Connection;
  private program: anchor.Program;
  private keys: ChainKeysFile;
  private operator: Keypair;
  private admin: Keypair;
  private oracle: Keypair;
  private partner: Keypair;

  constructor(readonly mode: Exclude<ChainMode, "simulated">) {
    const file = keysFilePath();
    if (!fs.existsSync(file)) {
      throw new Error(
        `Chain keys not found at ${file}. Run \`npm run devnet:setup\` (see README) or set PAYOO_CHAIN_MODE=simulated.`,
      );
    }
    this.keys = JSON.parse(fs.readFileSync(file, "utf8")) as ChainKeysFile;
    this.cluster = this.keys.cluster || mode;
    const rpc = process.env.SOLANA_RPC_URL || this.keys.rpcUrl;
    this.connection = new Connection(rpc, "confirmed");
    this.operator = kp(this.keys.operator);
    this.admin = kp(this.keys.admin);
    this.oracle = kp(this.keys.oracle);
    this.partner = kp(this.keys.partner);
    const provider = new anchor.AnchorProvider(this.connection, new KeypairWallet(this.operator), {
      commitment: "confirmed",
    });
    const idl = { ...(idlJson as anchor.Idl), address: PROGRAM_ID.toBase58() };
    this.program = new anchor.Program(idl, provider);
  }

  explorerTx(sig: string) {
    return `https://explorer.solana.com/tx/${sig}${this.explorerSuffix()}`;
  }
  explorerAddress(address: string) {
    return `https://explorer.solana.com/address/${address}${this.explorerSuffix()}`;
  }
  private explorerSuffix() {
    if (this.mode === "devnet") return "?cluster=devnet";
    return `?cluster=custom&customUrl=${encodeURIComponent(this.connection.rpcEndpoint)}`;
  }

  // Anchor's generated namespaces are untyped when the IDL is loaded from JSON.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private get m(): any {
    return this.program.methods;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private get accounts(): any {
    return this.program.account;
  }

  /** Extra signers besides the operator (fee payer); duplicates of the operator are dropped. */
  private cosigners(...signers: Keypair[]) {
    return signers.filter((s) => !s.publicKey.equals(this.operator.publicKey));
  }

  private async send(
    ixs: string[],
    orderId: string | undefined,
    signer: PublicKey,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    build: () => any,
  ): Promise<TxResult> {
    let sig: string;
    try {
      sig = await build().rpc({ commitment: "confirmed" });
    } catch (e) {
      throw translate(e);
    }
    const tx = await this.connection
      .getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })
      .catch(() => null);
    const slot = tx?.slot ?? 0;
    withDb((db) => {
      db.txs.unshift({
        sig,
        slot,
        instructions: ixs,
        orderId,
        signer: signer.toBase58(),
        at: new Date().toISOString(),
        cluster: this.cluster,
        simulated: false,
        logs: tx?.meta?.logMessages ?? [],
      });
    });
    return { sig, slot };
  }

  private async tokenBalance(address: string | PublicKey) {
    try {
      const b = await this.connection.getTokenAccountBalance(new PublicKey(address));
      return Number(b.value.amount);
    } catch {
      return 0;
    }
  }

  async info(): Promise<ChainInfo> {
    const base = {
      mode: this.mode,
      cluster: this.cluster,
      programId: PROGRAM_ID.toBase58(),
      configPda: configPda().toBase58(),
      rateFeedPda: rateFeedPda().toBase58(),
      usdcMint: this.keys.usdcMint,
      treasury: this.keys.treasury,
      settlementTokenAccount: this.keys.settlementTokenAccount,
    };
    try {
      const [cfg, rate, treasuryUsdc, settlementUsdc, lamports] = await Promise.all([
        this.accounts.config.fetchNullable(configPda()),
        this.accounts.rateFeed.fetchNullable(rateFeedPda()),
        this.tokenBalance(this.keys.treasury),
        this.tokenBalance(this.keys.settlementTokenAccount),
        this.connection.getBalance(this.operator.publicKey),
      ]);
      if (!cfg) {
        return {
          ...base,
          ...emptyInfo(),
          ready: false,
          error: "Program config not initialized. Run `npm run devnet:setup`.",
        };
      }
      return {
        ...base,
        ready: true,
        admin: cfg.admin.toBase58(),
        operator: cfg.operator.toBase58(),
        oracleAuthority: cfg.oracleAuthority.toBase58(),
        settlementPartner: cfg.settlementPartner.toBase58(),
        treasuryUsdc,
        settlementUsdc,
        operatorSol: lamports / 1e9,
        feeBps: cfg.feeBps,
        maxQuoteDeviationBps: cfg.maxQuoteDeviationBps,
        maxRateStalenessSecs: cfg.maxRateStalenessSecs,
        disputeWindowSecs: cfg.disputeWindowSecs,
        maxOrderUsdc: num(cfg.maxOrderUsdc),
        paused: cfg.paused,
        orderCount: num(cfg.orderCount),
        totalVolumeUsdc: num(cfg.totalVolumeUsdc),
        totalSettledUsdc: num(cfg.totalSettledUsdc),
        totalRefundedUsdc: num(cfg.totalRefundedUsdc),
        rateFeed: rate
          ? {
              usdCnyE6: num(rate.usdCnyE6),
              usdNprE6: num(rate.usdNprE6),
              updatedAt: num(rate.updatedAt),
              source: rate.source,
            }
          : null,
      };
    } catch (e) {
      return { ...base, ...emptyInfo(), ready: false, error: (e as Error).message };
    }
  }

  async pushRate(usdCnyE6: number, usdNprE6: number, source: number) {
    return this.send(["push_rate"], undefined, this.oracle.publicKey, () =>
      this.m
        .pushRate(new BN(usdCnyE6), new BN(usdNprE6), source)
        .accountsPartial({
          oracleAuthority: this.oracle.publicKey,
          config: configPda(),
          rateFeed: rateFeedPda(),
        })
        .signers(this.cosigners(this.oracle)),
    );
  }

  async createAndFund(a: CreateOrderArgs) {
    const order = orderPda(a.orderId);
    const vault = vaultPda(order);
    const usdcMint = new PublicKey(this.keys.usdcMint);
    const fundIx = await this.m
      .fundOrder()
      .accountsPartial({
        operator: this.operator.publicKey,
        config: configPda(),
        order,
        vault,
        treasury: new PublicKey(this.keys.treasury),
        usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    return this.send(["create_order", "fund_order"], a.orderId, this.operator.publicKey, () =>
      this.m
        .createOrder({
          orderId: [...uuidToBytes(a.orderId)],
          supplierHash: [...a.supplierHash],
          invoiceCnyFen: new BN(a.invoiceCnyFen),
          quoteRateE6: new BN(a.quoteRateE6),
          amountUsdc: new BN(a.amountUsdc),
          nprPaidPaisa: new BN(a.nprPaidPaisa),
          quoteExpiresAt: new BN(a.quoteExpiresAt),
          escrowMode: a.escrowMode,
        })
        .accountsPartial({
          operator: this.operator.publicKey,
          config: configPda(),
          rateFeed: rateFeedPda(),
          buyer: new PublicKey(a.buyer),
          order,
          vault,
          usdcMint,
          systemProgram: SYSTEM_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .postInstructions([fundIx]),
    );
  }

  async markInTransit(orderId: string, deliveryWindowSecs: number) {
    return this.send(["mark_in_transit"], orderId, this.operator.publicKey, () =>
      this.m.markInTransit(deliveryWindowSecs).accountsPartial({
        operator: this.operator.publicKey,
        config: configPda(),
        order: orderPda(orderId),
      }),
    );
  }

  async confirmDelivery(orderId: string, buyerSecretKey: string) {
    const buyer = kp(buyerSecretKey);
    return this.send(["confirm_delivery"], orderId, buyer.publicKey, () =>
      this.m
        .confirmDelivery()
        .accountsPartial({ buyer: buyer.publicKey, order: orderPda(orderId) })
        .signers([buyer]),
    );
  }

  async openDispute(orderId: string, buyerSecretKey: string, reason: number) {
    const buyer = kp(buyerSecretKey);
    return this.send(["open_dispute"], orderId, buyer.publicKey, () =>
      this.m
        .openDispute(reason)
        .accountsPartial({ buyer: buyer.publicKey, order: orderPda(orderId) })
        .signers([buyer]),
    );
  }

  async release(orderId: string, by: ReleaseSigner) {
    const authority = by.kind === "buyer" ? kp(by.secretKey) : this.operator;
    const order = orderPda(orderId);
    return this.send(["release_to_settlement"], orderId, authority.publicKey, () =>
      this.m
        .releaseToSettlement()
        .accountsPartial({
          authority: authority.publicKey,
          config: configPda(),
          order,
          vault: vaultPda(order),
          settlementTokenAccount: new PublicKey(this.keys.settlementTokenAccount),
          usdcMint: new PublicKey(this.keys.usdcMint),
          operator: this.operator.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers(this.cosigners(authority)),
    );
  }

  async markSettled(orderId: string, payoutRef: Buffer) {
    return this.send(["mark_settled"], orderId, this.partner.publicKey, () =>
      this.m
        .markSettled([...payoutRef])
        .accountsPartial({
          settlementPartner: this.partner.publicKey,
          config: configPda(),
          order: orderPda(orderId),
        })
        .signers(this.cosigners(this.partner)),
    );
  }

  async refund(orderId: string) {
    const order = orderPda(orderId);
    return this.send(["refund"], orderId, this.operator.publicKey, () =>
      this.m.refund().accountsPartial({
        authority: this.operator.publicKey,
        config: configPda(),
        order,
        vault: vaultPda(order),
        treasury: new PublicKey(this.keys.treasury),
        usdcMint: new PublicKey(this.keys.usdcMint),
        operator: this.operator.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      }),
    );
  }

  async resolveDispute(orderId: string, refundBuyer: boolean) {
    const order = orderPda(orderId);
    return this.send(["resolve_dispute"], orderId, this.admin.publicKey, () =>
      this.m
        .resolveDispute(refundBuyer)
        .accountsPartial({
          admin: this.admin.publicKey,
          config: configPda(),
          order,
          vault: vaultPda(order),
          treasury: new PublicKey(this.keys.treasury),
          settlementTokenAccount: new PublicKey(this.keys.settlementTokenAccount),
          usdcMint: new PublicKey(this.keys.usdcMint),
          operator: this.operator.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers(this.cosigners(this.admin)),
    );
  }

  async fetchOrder(orderId: string): Promise<OnchainOrder | null> {
    const address = orderPda(orderId);
    const o = await this.accounts.order.fetchNullable(address);
    if (!o) return null;
    const vault = vaultPda(address);
    const statusKey = Object.keys(o.status)[0];
    return {
      address: address.toBase58(),
      vault: vault.toBase58(),
      buyer: o.buyer.toBase58(),
      status: STATUS_NAMES[statusKey] ?? (statusKey as OnchainStatus),
      invoiceCnyFen: num(o.invoiceCnyFen),
      quoteRateE6: num(o.quoteRateE6),
      amountUsdc: num(o.amountUsdc),
      feeUsdc: num(o.feeUsdc),
      nprPaidPaisa: num(o.nprPaidPaisa),
      escrowMode: o.escrowMode,
      createdAt: num(o.createdAt),
      quoteExpiresAt: num(o.quoteExpiresAt),
      fundedAt: num(o.fundedAt),
      shippedAt: num(o.shippedAt),
      deliveryDeadline: num(o.deliveryDeadline),
      releasedAt: num(o.releasedAt),
      settledAt: num(o.settledAt),
      payoutRef: Buffer.from(o.payoutRef).toString("hex"),
      disputeReason: o.disputeReason,
      vaultBalance: await this.tokenBalance(vault),
    };
  }
}

function emptyInfo() {
  return {
    admin: "",
    operator: "",
    oracleAuthority: "",
    settlementPartner: "",
    treasuryUsdc: 0,
    settlementUsdc: 0,
    feeBps: 0,
    maxQuoteDeviationBps: 0,
    maxRateStalenessSecs: 0,
    disputeWindowSecs: 0,
    maxOrderUsdc: 0,
    paused: false,
    orderCount: 0,
    totalVolumeUsdc: 0,
    totalSettledUsdc: 0,
    totalRefundedUsdc: 0,
    rateFeed: null,
  };
}
