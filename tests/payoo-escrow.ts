import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { expect } from "chai";
import { createHash, randomUUID } from "crypto";
import idl from "../target/idl/payoo_escrow.json";

export type PayooEscrowIdl = typeof idl;

const USDC = 1_000_000n; // 6 decimals
const TREASURY_FUNDING = 1_000_000n * USDC;

const CONFIG = {
  feeBps: 50,
  maxQuoteDeviationBps: 200, // 2%
  maxRateStalenessSecs: 300,
  disputeWindowSecs: 3 * 24 * 60 * 60,
  maxOrderUsdc: 50_000n * USDC,
  usdCnyE6: 7_100_000,
  usdNprE6: 133_500_000,
};

const DEFAULT_INVOICE_FEN = 1_000_000n; // ¥10,000.00

type Status =
  | "created"
  | "funded"
  | "inTransit"
  | "delivered"
  | "released"
  | "settled"
  | "disputed"
  | "refunded"
  | "cancelled";

/** USDC base units needed for `fen` at `rateE6`, rounded up (mirrors the program). */
function usdcForInvoice(fen: bigint, rateE6: bigint): bigint {
  return (fen * 10_000_000_000n + rateE6 - 1n) / rateE6;
}

function uuidBytes(): number[] {
  return Array.from(Buffer.from(randomUUID().replace(/-/g, ""), "hex"));
}

function bytes32(text: string): number[] {
  const buf = Buffer.alloc(32);
  buf.write(text);
  return Array.from(buf);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("payoo_escrow", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;
  const program = new anchor.Program(idl as anchor.Idl, provider);
  const payer = (provider.wallet as anchor.Wallet).payer;
  const admin = provider.wallet.publicKey;

  const operator = Keypair.generate();
  const oracle = Keypair.generate();
  const partner = Keypair.generate();
  const buyer = Keypair.generate();
  const outsider = Keypair.generate();

  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);
  const [rateFeedPda] = PublicKey.findProgramAddressSync([Buffer.from("rate")], program.programId);

  let usdcMint: PublicKey;
  let treasury: PublicKey;
  let partnerAta: PublicKey;
  let feedRateE6 = BigInt(CONFIG.usdCnyE6);

  // ---------- helpers ----------

  const orderPda = (orderId: number[]) =>
    PublicKey.findProgramAddressSync([Buffer.from("order"), Buffer.from(orderId)], program.programId)[0];
  const vaultPda = (order: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("vault"), order.toBuffer()], program.programId)[0];

  // No generated camelCase IDL types, so decoded accounts are loosely typed.
  const accounts = program.account as unknown as Record<string, anchor.AccountClient>;
  const fetchOrder = (order: PublicKey): Promise<any> => accounts.order.fetch(order);
  const fetchConfig = (): Promise<any> => accounts.config.fetch(configPda);
  const fetchRateFeed = (): Promise<any> => accounts.rateFeed.fetch(rateFeedPda);
  const tokenBalance = async (ata: PublicKey) => (await getAccount(connection, ata)).amount;

  async function expectStatus(order: PublicKey, status: Status) {
    const acc = await fetchOrder(order);
    expect(acc.status).to.deep.equal({ [status]: {} });
  }

  async function expectClosed(account: PublicKey) {
    expect(await connection.getAccountInfo(account)).to.be.null;
  }

  async function expectError(promise: Promise<unknown>, code: string) {
    try {
      await promise;
    } catch (e: any) {
      const actual =
        e?.error?.errorCode?.code ??
        (e?.logs ? anchor.AnchorError.parse(e.logs)?.error.errorCode.code : undefined);
      expect(actual, `unexpected error: ${e}`).to.equal(code);
      return;
    }
    expect.fail(`expected transaction to fail with ${code}`);
  }

  /**
   * Validator clock (unix seconds) from the Clock sysvar. Read at "confirmed" so that any
   * bank a later transaction is simulated or executed against is at least this far along.
   */
  async function chainNow(): Promise<number> {
    const info = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY, "confirmed");
    return Number(info!.data.readBigInt64LE(32));
  }

  async function waitForChainTime(target: number) {
    while ((await chainNow()) < target) await sleep(400);
  }

  async function airdrop(to: PublicKey, sol = 10) {
    const signature = await connection.requestAirdrop(to, sol * LAMPORTS_PER_SOL);
    const latest = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature, ...latest }, "confirmed");
  }

  /** Sends a method call with `signer` as both the only signer and the fee payer. */
  async function sendAs(builder: any, signer: Keypair) {
    const tx = await builder.transaction();
    tx.feePayer = signer.publicKey;
    return sendAndConfirmTransaction(connection, tx, [signer], {
      commitment: "confirmed",
      preflightCommitment: "processed",
    });
  }

  function updateConfig(params: Record<string, unknown>, signer?: Keypair) {
    const full = {
      operator: null,
      oracleAuthority: null,
      settlementPartner: null,
      treasury: null,
      feeBps: null,
      maxQuoteDeviationBps: null,
      maxRateStalenessSecs: null,
      disputeWindowSecs: null,
      maxOrderUsdc: null,
      paused: null,
      newAdmin: null,
      ...params,
    };
    const builder = program.methods
      .updateConfig(full)
      .accountsPartial({ admin: signer?.publicKey ?? admin, config: configPda });
    return (signer ? builder.signers([signer]) : builder).rpc();
  }

  function pushRate(usdCnyE6: bigint, signer = oracle) {
    return program.methods
      .pushRate(new BN(usdCnyE6.toString()), new BN(CONFIG.usdNprE6), 1)
      .accountsPartial({ oracleAuthority: signer.publicKey, config: configPda, rateFeed: rateFeedPda })
      .signers([signer])
      .rpc();
  }

  interface OrderOpts {
    escrow?: boolean;
    fund?: boolean;
    invoiceFen?: bigint;
    quoteRateE6?: bigint;
    amountUsdc?: bigint;
    expiresInSecs?: number;
    signer?: Keypair;
  }

  interface TestOrder {
    orderId: number[];
    order: PublicKey;
    vault: PublicKey;
    amount: bigint;
  }

  function fundIx(o: TestOrder): Promise<TransactionInstruction> {
    return program.methods
      .fundOrder()
      .accountsPartial({
        operator: operator.publicKey,
        config: configPda,
        order: o.order,
        vault: o.vault,
        treasury,
        usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
  }

  /** Builds create_order (optionally followed by fund_order in the same tx). */
  async function createOrderTx(opts: OrderOpts = {}) {
    const invoiceFen = opts.invoiceFen ?? DEFAULT_INVOICE_FEN;
    const quoteRateE6 = opts.quoteRateE6 ?? feedRateE6;
    const amount = opts.amountUsdc ?? usdcForInvoice(invoiceFen, quoteRateE6);
    const signer = opts.signer ?? operator;
    const orderId = uuidBytes();
    const order = orderPda(orderId);
    const testOrder: TestOrder = { orderId, order, vault: vaultPda(order), amount };

    const params = {
      orderId,
      supplierHash: Array.from(createHash("sha256").update(`supplier:${randomUUID()}`).digest()),
      invoiceCnyFen: new BN(invoiceFen.toString()),
      quoteRateE6: new BN(quoteRateE6.toString()),
      amountUsdc: new BN(amount.toString()),
      nprPaidPaisa: new BN(((amount * BigInt(CONFIG.usdNprE6)) / 10_000_000_000n).toString()),
      quoteExpiresAt: new BN((await chainNow()) + (opts.expiresInSecs ?? 600)),
      escrowMode: opts.escrow ?? false,
    };

    let builder = program.methods
      .createOrder(params)
      .accountsPartial({
        operator: signer.publicKey,
        config: configPda,
        rateFeed: rateFeedPda,
        buyer: buyer.publicKey,
        order,
        vault: testOrder.vault,
        usdcMint,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([signer]);
    if (opts.fund) builder = builder.postInstructions([await fundIx(testOrder)]);
    return { builder, testOrder };
  }

  async function createOrder(opts: OrderOpts = {}): Promise<TestOrder> {
    const { builder, testOrder } = await createOrderTx(opts);
    await builder.rpc();
    return testOrder;
  }

  function release(o: TestOrder, authority: Keypair = operator) {
    return program.methods
      .releaseToSettlement()
      .accountsPartial({
        authority: authority.publicKey,
        config: configPda,
        order: o.order,
        vault: o.vault,
        settlementTokenAccount: partnerAta,
        usdcMint,
        operator: operator.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([authority]);
  }

  function markSettled(o: TestOrder, signer = partner, ref = "ALIPAY-20261013-0001") {
    return program.methods
      .markSettled(bytes32(ref))
      .accountsPartial({ settlementPartner: signer.publicKey, config: configPda, order: o.order })
      .signers([signer])
      .rpc();
  }

  function markInTransit(o: TestOrder, deliveryWindowSecs: number) {
    return program.methods
      .markInTransit(deliveryWindowSecs)
      .accountsPartial({ operator: operator.publicKey, config: configPda, order: o.order })
      .signers([operator])
      .rpc();
  }

  function confirmDelivery(o: TestOrder, signer = buyer) {
    return program.methods
      .confirmDelivery()
      .accountsPartial({ buyer: signer.publicKey, order: o.order })
      .signers([signer])
      .rpc();
  }

  function openDispute(o: TestOrder, reason: number) {
    return program.methods
      .openDispute(reason)
      .accountsPartial({ buyer: buyer.publicKey, order: o.order })
      .signers([buyer])
      .rpc();
  }

  function refund(o: TestOrder, authority = operator) {
    return program.methods
      .refund()
      .accountsPartial({
        authority: authority.publicKey,
        config: configPda,
        order: o.order,
        vault: o.vault,
        treasury,
        usdcMint,
        operator: operator.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([authority])
      .rpc();
  }

  function resolveDispute(o: TestOrder, refundBuyer: boolean) {
    return program.methods
      .resolveDispute(refundBuyer)
      .accountsPartial({
        admin,
        config: configPda,
        order: o.order,
        vault: o.vault,
        treasury,
        settlementTokenAccount: partnerAta,
        usdcMint,
        operator: operator.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  }

  // ---------- setup ----------

  before(async () => {
    await Promise.all([operator, oracle, partner, buyer, outsider].map((kp) => airdrop(kp.publicKey)));

    usdcMint = await createMint(connection, payer, admin, null, 6);
    treasury = (await getOrCreateAssociatedTokenAccount(connection, payer, usdcMint, operator.publicKey)).address;
    partnerAta = (await getOrCreateAssociatedTokenAccount(connection, payer, usdcMint, partner.publicKey)).address;
    await mintTo(connection, payer, usdcMint, treasury, payer, TREASURY_FUNDING);
  });

  // ---------- tests ----------

  describe("admin and oracle", () => {
    it("initializes the config and rate feed", async () => {
      await program.methods
        .initialize({
          operator: operator.publicKey,
          oracleAuthority: oracle.publicKey,
          settlementPartner: partner.publicKey,
          feeBps: CONFIG.feeBps,
          maxQuoteDeviationBps: CONFIG.maxQuoteDeviationBps,
          maxRateStalenessSecs: CONFIG.maxRateStalenessSecs,
          disputeWindowSecs: CONFIG.disputeWindowSecs,
          maxOrderUsdc: new BN(CONFIG.maxOrderUsdc.toString()),
          usdCnyE6: new BN(CONFIG.usdCnyE6),
          usdNprE6: new BN(CONFIG.usdNprE6),
        })
        .accountsPartial({
          admin,
          config: configPda,
          rateFeed: rateFeedPda,
          usdcMint,
          treasury,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      const config = await fetchConfig();
      expect(config.admin.toBase58()).to.equal(admin.toBase58());
      expect(config.operator.toBase58()).to.equal(operator.publicKey.toBase58());
      expect(config.oracleAuthority.toBase58()).to.equal(oracle.publicKey.toBase58());
      expect(config.settlementPartner.toBase58()).to.equal(partner.publicKey.toBase58());
      expect(config.usdcMint.toBase58()).to.equal(usdcMint.toBase58());
      expect(config.treasury.toBase58()).to.equal(treasury.toBase58());
      expect(config.feeBps).to.equal(CONFIG.feeBps);
      expect(config.maxQuoteDeviationBps).to.equal(CONFIG.maxQuoteDeviationBps);
      expect(config.maxRateStalenessSecs).to.equal(CONFIG.maxRateStalenessSecs);
      expect(config.disputeWindowSecs).to.equal(CONFIG.disputeWindowSecs);
      expect(config.maxOrderUsdc.toString()).to.equal(CONFIG.maxOrderUsdc.toString());
      expect(config.paused).to.equal(false);
      expect(config.orderCount.toNumber()).to.equal(0);

      const rate = await fetchRateFeed();
      expect(rate.usdCnyE6.toNumber()).to.equal(CONFIG.usdCnyE6);
      expect(rate.usdNprE6.toNumber()).to.equal(CONFIG.usdNprE6);
      expect(rate.source).to.equal(0);
      expect(rate.updatedAt.toNumber()).to.be.greaterThan(0);
    });

    it("lets the oracle authority push a new rate", async () => {
      feedRateE6 = 7_120_000n;
      await pushRate(feedRateE6);

      const rate = await fetchRateFeed();
      expect(rate.usdCnyE6.toString()).to.equal(feedRateE6.toString());
      expect(rate.usdNprE6.toNumber()).to.equal(CONFIG.usdNprE6);
      expect(rate.source).to.equal(1);
    });

    it("rejects a rate pushed by anyone else", async () => {
      await expectError(pushRate(7_500_000n, outsider), "Unauthorized");
    });

    it("rejects config updates from a non-admin", async () => {
      await expectError(updateConfig({ paused: true }, outsider), "Unauthorized");
    });
  });

  describe("direct payment", () => {
    let o: TestOrder;

    it("creates and funds an order in one transaction", async () => {
      const treasuryBefore = await tokenBalance(treasury);
      const configBefore = await fetchConfig();

      o = await createOrder({ fund: true });

      expect(o.amount).to.equal(usdcForInvoice(DEFAULT_INVOICE_FEN, feedRateE6));
      expect(await tokenBalance(o.vault)).to.equal(o.amount);
      expect(await tokenBalance(treasury)).to.equal(treasuryBefore - o.amount);

      const order = await fetchOrder(o.order);
      expect(order.status).to.deep.equal({ funded: {} });
      expect(order.buyer.toBase58()).to.equal(buyer.publicKey.toBase58());
      expect(order.escrowMode).to.equal(false);
      expect(order.amountUsdc.toString()).to.equal(o.amount.toString());
      expect(order.feeUsdc.toString()).to.equal(((o.amount * BigInt(CONFIG.feeBps)) / 10_000n).toString());
      expect(order.fundedAt.toNumber()).to.be.greaterThan(0);

      const configAfter = await fetchConfig();
      expect(configAfter.orderCount.toNumber()).to.equal(configBefore.orderCount.toNumber() + 1);
      expect(configAfter.totalVolumeUsdc.sub(configBefore.totalVolumeUsdc).toString()).to.equal(o.amount.toString());
    });

    it("rejects confirm_delivery on a direct order", async () => {
      await expectError(confirmDelivery(o), "NotEscrowMode");
    });

    it("rejects mark_settled before the funds are released", async () => {
      await expectError(markSettled(o), "InvalidStatus");
    });

    it("rejects a release signed by someone other than the platform", async () => {
      await expectError(release(o, outsider).rpc(), "Unauthorized");
    });

    it("releases to the settlement partner and closes the vault", async () => {
      const partnerBefore = await tokenBalance(partnerAta);
      await release(o).rpc();

      expect(await tokenBalance(partnerAta)).to.equal(partnerBefore + o.amount);
      await expectClosed(o.vault);
      const order = await fetchOrder(o.order);
      expect(order.status).to.deep.equal({ released: {} });
      expect(order.releasedAt.toNumber()).to.be.greaterThan(0);
    });

    it("cannot release the same order twice", async () => {
      // The vault is closed on release, so account validation fails before the status check.
      await expectError(release(o).rpc(), "AccountNotInitialized");
    });

    it("rejects mark_settled from a non-partner", async () => {
      await expectError(markSettled(o, outsider), "Unauthorized");
    });

    it("is marked settled by the partner with a payout reference", async () => {
      const configBefore = await fetchConfig();
      await markSettled(o, partner, "ALIPAY-20261013-0001");

      const order = await fetchOrder(o.order);
      expect(order.status).to.deep.equal({ settled: {} });
      expect(order.payoutRef).to.deep.equal(bytes32("ALIPAY-20261013-0001"));
      expect(order.settledAt.toNumber()).to.be.greaterThan(0);

      const configAfter = await fetchConfig();
      expect(configAfter.totalSettledUsdc.sub(configBefore.totalSettledUsdc).toString()).to.equal(o.amount.toString());
    });

    it("rejects settling an already settled order", async () => {
      await expectError(markSettled(o), "InvalidStatus");
    });
  });

  describe("escrow payment", () => {
    let o: TestOrder;

    before(async () => {
      o = await createOrder({ escrow: true, fund: true });
    });

    it("marks the order in transit with a delivery deadline", async () => {
      await markInTransit(o, 7 * 24 * 60 * 60);
      const order = await fetchOrder(o.order);
      expect(order.status).to.deep.equal({ inTransit: {} });
      expect(order.deliveryDeadline.toNumber() - order.shippedAt.toNumber()).to.equal(7 * 24 * 60 * 60);
    });

    it("rejects confirm_delivery from someone other than the buyer", async () => {
      await expectError(confirmDelivery(o, outsider), "Unauthorized");
    });

    it("lets the buyer confirm delivery", async () => {
      await confirmDelivery(o);
      await expectStatus(o.order, "delivered");
    });

    it("lets the buyer release, then the partner settles", async () => {
      const partnerBefore = await tokenBalance(partnerAta);
      await release(o, buyer).rpc();
      expect(await tokenBalance(partnerAta)).to.equal(partnerBefore + o.amount);
      await expectClosed(o.vault);
      await expectStatus(o.order, "released");

      await markSettled(o, partner, "WECHAT-4200001234567890");
      await expectStatus(o.order, "settled");
    });
  });

  describe("disputes", () => {
    it("refunds the treasury when the admin sides with the buyer", async () => {
      const o = await createOrder({ escrow: true, fund: true });
      await markInTransit(o, 7 * 24 * 60 * 60);
      await openDispute(o, 2);

      const order = await fetchOrder(o.order);
      expect(order.status).to.deep.equal({ disputed: {} });
      expect(order.disputeReason).to.equal(2);

      await expectError(release(o).rpc(), "InvalidStatus");

      const treasuryBefore = await tokenBalance(treasury);
      const configBefore = await fetchConfig();
      await resolveDispute(o, true);

      expect(await tokenBalance(treasury)).to.equal(treasuryBefore + o.amount);
      await expectClosed(o.vault);
      await expectStatus(o.order, "refunded");
      const configAfter = await fetchConfig();
      expect(configAfter.totalRefundedUsdc.sub(configBefore.totalRefundedUsdc).toString()).to.equal(o.amount.toString());
    });

    it("pays the settlement partner when the admin sides with the supplier", async () => {
      const o = await createOrder({ escrow: true, fund: true });
      await openDispute(o, 1);

      const partnerBefore = await tokenBalance(partnerAta);
      await resolveDispute(o, false);

      expect(await tokenBalance(partnerAta)).to.equal(partnerBefore + o.amount);
      await expectClosed(o.vault);
      await expectStatus(o.order, "released");
    });
  });

  describe("refunds", () => {
    it("lets the operator refund a funded order", async () => {
      const o = await createOrder({ fund: true });
      const treasuryBefore = await tokenBalance(treasury);
      const configBefore = await fetchConfig();

      await refund(o);

      expect(await tokenBalance(treasury)).to.equal(treasuryBefore + o.amount);
      await expectClosed(o.vault);
      await expectStatus(o.order, "refunded");
      const configAfter = await fetchConfig();
      expect(configAfter.totalRefundedUsdc.sub(configBefore.totalRefundedUsdc).toString()).to.equal(o.amount.toString());
    });

    it("rejects a refund from someone other than the platform", async () => {
      const o = await createOrder({ fund: true });
      await expectError(refund(o, outsider), "Unauthorized");
    });

    it("rejects refunding an order that was never funded", async () => {
      const o = await createOrder();
      await expectError(refund(o), "InvalidStatus");
    });
  });

  describe("auto-release", () => {
    let o: TestOrder;

    after(async () => {
      await updateConfig({ disputeWindowSecs: CONFIG.disputeWindowSecs });
    });

    it("stays locked while the dispute window is open, even past the delivery deadline", async () => {
      o = await createOrder({ escrow: true, fund: true });
      await markInTransit(o, 1);
      const order = await fetchOrder(o.order);
      await waitForChainTime(order.deliveryDeadline.toNumber() + 1);

      await expectError(release(o, outsider).rpc(), "ReleaseWindowOpen");
    });

    it("lets anyone release once the deadline and dispute window have passed", async () => {
      await updateConfig({ disputeWindowSecs: 0 });
      const partnerBefore = await tokenBalance(partnerAta);

      await sendAs(release(o, outsider), outsider);

      expect(await tokenBalance(partnerAta)).to.equal(partnerBefore + o.amount);
      await expectClosed(o.vault);
      await expectStatus(o.order, "released");
    });
  });

  describe("quote validation", () => {
    it("rejects a quote rate too far from the reference rate", async () => {
      const quoteRateE6 = (feedRateE6 * 10_300n) / 10_000n; // +3% vs a 2% band
      const { builder } = await createOrderTx({ quoteRateE6 });
      await expectError(builder.rpc(), "RateDeviation");
    });

    it("accepts a quote rate inside the deviation band", async () => {
      const quoteRateE6 = (feedRateE6 * 10_150n) / 10_000n; // +1.5%
      const o = await createOrder({ quoteRateE6 });
      await expectStatus(o.order, "created");
    });

    it("rejects a USDC amount that does not match the invoice", async () => {
      const expected = usdcForInvoice(DEFAULT_INVOICE_FEN, feedRateE6);
      await expectError((await createOrderTx({ amountUsdc: expected + 2n })).builder.rpc(), "AmountMismatch");
      await expectError((await createOrderTx({ amountUsdc: expected - 1n })).builder.rpc(), "AmountMismatch");
    });

    it("tolerates a one-unit rounding difference", async () => {
      const expected = usdcForInvoice(DEFAULT_INVOICE_FEN, feedRateE6);
      const o = await createOrder({ amountUsdc: expected + 1n });
      await expectStatus(o.order, "created");
    });

    it("rejects a quote that has already expired", async () => {
      const { builder } = await createOrderTx({ expiresInSecs: -10 });
      await expectError(builder.rpc(), "QuoteExpired");
    });

    it("rejects create_order from a non-operator", async () => {
      const { builder } = await createOrderTx({ signer: outsider });
      await expectError(builder.rpc(), "Unauthorized");
    });

    it("rejects quotes priced off a stale reference rate", async () => {
      await updateConfig({ maxRateStalenessSecs: 1 });
      try {
        const rate = await fetchRateFeed();
        await waitForChainTime(rate.updatedAt.toNumber() + 2);
        const { builder } = await createOrderTx();
        await expectError(builder.rpc(), "StaleRate");
      } finally {
        await updateConfig({ maxRateStalenessSecs: CONFIG.maxRateStalenessSecs });
        await pushRate(feedRateE6);
      }
    });
  });

  describe("pause", () => {
    it("blocks new orders while paused", async () => {
      await updateConfig({ paused: true });
      try {
        expect((await fetchConfig()).paused).to.equal(true);
        const { builder } = await createOrderTx();
        await expectError(builder.rpc(), "Paused");
      } finally {
        await updateConfig({ paused: false });
      }
      const o = await createOrder();
      await expectStatus(o.order, "created");
    });
  });

  describe("cancel_expired", () => {
    let o: TestOrder;

    before(async () => {
      o = await createOrder({ expiresInSecs: 2 });
    });

    const cancel = (cranker: Keypair) =>
      program.methods.cancelExpired().accountsPartial({
        cranker: cranker.publicKey,
        config: configPda,
        order: o.order,
        vault: o.vault,
        operator: operator.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([cranker]);

    it("cannot cancel before the quote expires", async () => {
      await expectError(cancel(outsider).rpc(), "QuoteNotExpired");
    });

    it("lets anyone cancel an unfunded order once its quote expires", async () => {
      const order = await fetchOrder(o.order);
      await waitForChainTime(order.quoteExpiresAt.toNumber() + 1);
      const operatorBefore = await connection.getBalance(operator.publicKey);

      await sendAs(cancel(outsider), outsider);

      await expectStatus(o.order, "cancelled");
      await expectClosed(o.vault);
      expect(await connection.getBalance(operator.publicKey)).to.be.greaterThan(operatorBefore);
    });
  });
});
