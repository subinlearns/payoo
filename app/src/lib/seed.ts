import { randomBytes, randomUUID } from "node:crypto";
import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";
import type { DbShape } from "./db";
import type { ChainTx, Order, Supplier, User } from "./types";
import { initialSimState } from "./chain/simulated";
import { orderPda, sha256, vaultPda } from "./chain/pda";
import { computeQuote } from "./quote";

export const DEFAULT_USER_ID = "usr_sita";

const SEED_USD_CNY = 6.71;
const SEED_USD_NPR = 153.4;

function newWallet() {
  const kp = Keypair.generate();
  return { publicKey: kp.publicKey.toBase58(), secretKey: bs58.encode(kp.secretKey) };
}

export function supplierHash(s: Pick<Supplier, "name" | "payoutMethod" | "payoutAccount" | "payoutName">) {
  return sha256(JSON.stringify([s.name, s.payoutMethod, s.payoutAccount, s.payoutName])).toString("hex");
}

export function buildSeed(): DbShape {
  const now = Date.now();
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  const day = 86_400_000;

  const user: User = {
    id: DEFAULT_USER_ID,
    name: "Sita Shrestha",
    business: "Himalayan Craft Imports Pvt. Ltd.",
    city: "Kathmandu",
    phone: "+977 98XXXXXX21",
    email: "sita@himalayancraft.example",
    pan: "6098XXXX4",
    kyc: { status: "verified", level: "business", verifiedAt: iso(75 * day) },
    wallet: newWallet(),
    savingsUsdc: 1_250 * 1e6,
    createdAt: iso(75 * day),
  };

  const suppliers: Supplier[] = [
    {
      id: "sup_yiwu",
      ownerId: user.id,
      name: "Yiwu Sunrise Trading Co., Ltd.",
      nameZh: "义乌日升贸易有限公司",
      marketplace: "Alibaba",
      storeUrl: "https://example.alibaba.com/yiwu-sunrise",
      city: "Yiwu, Zhejiang",
      payoutMethod: "alipay",
      payoutName: "义乌日升贸易有限公司",
      payoutAccount: "ali•••• 8812",
      verified: true,
      createdAt: iso(70 * day),
    },
    {
      id: "sup_shenzhen",
      ownerId: user.id,
      name: "Shenzhen Brightlink Electronics",
      nameZh: "深圳明联电子",
      marketplace: "1688",
      storeUrl: "https://example.1688.com/brightlink",
      city: "Shenzhen, Guangdong",
      payoutMethod: "bank",
      payoutName: "深圳明联电子有限公司",
      payoutAccount: "ICBC •••• 4471",
      verified: true,
      createdAt: iso(52 * day),
    },
    {
      id: "sup_guangzhou",
      ownerId: user.id,
      name: "Guangzhou Silk Road Textiles",
      nameZh: "广州丝路纺织",
      marketplace: "AliExpress",
      storeUrl: "https://example.aliexpress.com/silkroad-textiles",
      city: "Guangzhou, Guangdong",
      payoutMethod: "wechat",
      payoutName: "陈伟",
      payoutAccount: "wxid_•••• 93",
      verified: false,
      createdAt: iso(20 * day),
    },
  ];

  const sim = initialSimState(
    Math.floor(now / 1000),
    Math.round(SEED_USD_CNY * 1e6),
    Math.round(SEED_USD_NPR * 1e6),
  );

  // A few months of settled history so the dashboard and credit profile have something to show.
  const history: [string, number, number, boolean, string][] = [
    ["sup_yiwu", 320_000, 58, false, "PI-2026-0711"],
    ["sup_shenzhen", 875_000, 44, true, "1688-77120394"],
    ["sup_yiwu", 1_240_000, 31, true, "PI-2026-0814"],
    ["sup_guangzhou", 215_000, 17, false, "AE-80551872"],
    ["sup_shenzhen", 560_000, 9, true, "1688-77984410"],
  ];

  const orders: Order[] = [];
  const txs: ChainTx[] = [];
  for (const [supplierId, fen, daysAgo, escrowMode, invoiceRef] of history) {
    const supplier = suppliers.find((s) => s.id === supplierId)!;
    const q = computeQuote({ invoiceCnyFen: fen, usdCny: SEED_USD_CNY, usdNpr: SEED_USD_NPR });
    const id = randomUUID();
    const pda = orderPda(id);
    const t0 = now - daysAgo * day;
    const at = (mins: number) => new Date(t0 + mins * 60_000).toISOString();
    const sig = () => bs58.encode(randomBytes(64));
    const steps: [string, string, Order["events"][number]["actor"], number, string[]][] = escrowMode
      ? [
          ["FUNDED", "USDC locked in escrow", "program", 2, ["create_order", "fund_order"]],
          ["IN_TRANSIT", "Supplier shipped", "supplier", 60 * 24, ["mark_in_transit"]],
          ["DELIVERED", "Buyer confirmed delivery", "buyer", 60 * 24 * 6, ["confirm_delivery"]],
          ["RELEASED", "Released to settlement partner", "program", 60 * 24 * 6 + 1, ["release_to_settlement"]],
          ["SETTLED", "CNY paid to supplier", "partner", 60 * 24 * 6 + 14, ["mark_settled"]],
        ]
      : [
          ["FUNDED", "USDC locked in escrow", "program", 2, ["create_order", "fund_order"]],
          ["RELEASED", "Released to settlement partner", "program", 3, ["release_to_settlement"]],
          ["SETTLED", "CNY paid to supplier", "partner", 18, ["mark_settled"]],
        ];

    const events: Order["events"] = [
      { type: "QUOTE_LOCKED", label: "Quote locked", at: at(-3), actor: "platform" },
      { type: "NPR_RECEIVED", label: "NPR received via eSewa", at: at(0), actor: "rail" },
    ];
    for (const [type, label, actor, mins, ixs] of steps) {
      const s = sig();
      events.push({ type, label, at: at(mins), actor, txSig: s });
      txs.push({
        sig: s,
        slot: sim.slot - daysAgo * 216_000 + mins * 150,
        instructions: ixs,
        orderId: id,
        signer: actor === "buyer" ? user.wallet.publicKey : actor === "partner" ? sim.config.settlementPartner : sim.config.operator,
        at: at(mins),
        cluster: "simulated",
        simulated: true,
        logs: [],
      });
    }
    const settledAt = at(steps[steps.length - 1][3]);
    orders.push({
      id,
      quoteId: `qt_seed_${id.slice(0, 8)}`,
      userId: user.id,
      supplierId,
      invoiceRef,
      escrowMode,
      invoiceCnyFen: fen,
      quoteRateE6: q.quoteRateE6,
      amountUsdc: q.amountUsdc,
      feeUsdc: q.feeUsdc,
      totalNprPaisa: q.totalNprPaisa,
      savingsNprPaisa: q.savingsNprPaisa,
      status: "SETTLED",
      orderPda: pda.toBase58(),
      vaultPda: vaultPda(pda).toBase58(),
      buyerWallet: user.wallet.publicKey,
      supplierHash: supplierHash(supplier),
      rail: { method: "esewa", reference: `ESW${(t0 / 1000).toFixed(0)}`, paidAt: at(0) },
      payout: {
        method: supplier.payoutMethod,
        reference: `${supplier.payoutMethod.toUpperCase()}-${randomBytes(5).toString("hex").toUpperCase()}`,
        cnyFen: fen,
        paidAt: settledAt,
      },
      events,
      seeded: true,
      createdAt: at(-3),
      updatedAt: settledAt,
    });
    sim.config.orderCount += 1;
    sim.config.totalVolumeUsdc += q.amountUsdc;
    sim.config.totalSettledUsdc += q.amountUsdc;
    sim.balances[sim.config.treasury] -= q.amountUsdc;
  }
  orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  txs.sort((a, b) => b.at.localeCompare(a.at));

  return {
    version: 1,
    users: [user],
    suppliers,
    quotes: [],
    orders,
    txs,
    sim,
    createdAt: new Date(now).toISOString(),
  };
}
