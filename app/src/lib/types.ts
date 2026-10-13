export type OrderStatus =
  | "CREATED"
  | "FUNDED"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "RELEASED"
  | "SETTLED"
  | "DISPUTED"
  | "REFUNDED"
  | "CANCELLED";

export type PayoutMethod = "alipay" | "wechat" | "bank";
export type RailMethod = "esewa" | "khalti" | "connectips" | "fonepay_qr" | "bank_transfer";
export type Marketplace = "Alibaba" | "1688" | "AliExpress" | "Taobao" | "Direct";

export interface EmbeddedWallet {
  publicKey: string;
  /** base58 secret key. Demo only: production uses an MPC / embedded wallet provider. */
  secretKey: string;
}

export interface User {
  id: string;
  name: string;
  business: string;
  city: string;
  phone: string;
  email: string;
  pan: string;
  kyc: { status: "verified" | "pending"; level: "business" | "individual"; verifiedAt?: string };
  wallet: EmbeddedWallet;
  /** Simulated USD savings balance, USDC base units (6dp). */
  savingsUsdc: number;
  createdAt: string;
}

export interface Supplier {
  id: string;
  ownerId: string;
  name: string;
  nameZh?: string;
  marketplace: Marketplace;
  storeUrl: string;
  city: string;
  payoutMethod: PayoutMethod;
  payoutName: string;
  /** Masked account (bank no. / Alipay id / WeChat id). */
  payoutAccount: string;
  verified: boolean;
  createdAt: string;
}

export interface Rates {
  /** CNY per USD */
  usdCny: number;
  /** NPR per USD */
  usdNpr: number;
  /** NPR per CNY (derived) */
  cnyNpr: number;
  source: "pyth" | "open.er-api" | "fallback";
  fetchedAt: string;
  pythPublishTime?: string;
}

export interface BankWireEstimate {
  totalNprPaisa: number;
  localFeeNprPaisa: number;
  correspondentFeeNprPaisa: number;
  fxMarginNprPaisa: number;
  days: string;
}

export interface QuoteBreakdown {
  invoiceCnyFen: number;
  /** CNY per USD x1e6, locked into the on-chain order */
  quoteRateE6: number;
  /** NPR per USD the buyer pays (mid + spread) */
  buyerUsdNpr: number;
  amountUsdc: number;
  feeUsdc: number;
  feeBps: number;
  spreadBps: number;
  principalNprPaisa: number;
  feeNprPaisa: number;
  spreadNprPaisa: number;
  totalNprPaisa: number;
  /** Effective NPR per CNY, all-in */
  effectiveCnyNpr: number;
  bankWire: BankWireEstimate;
  savingsNprPaisa: number;
}

export interface Quote extends QuoteBreakdown {
  id: string;
  userId: string;
  supplierId: string;
  invoiceRef: string;
  escrowMode: boolean;
  rates: Rates;
  status: "open" | "paid" | "expired";
  orderId?: string;
  createdAt: string;
  expiresAt: string;
}

export interface OrderEvent {
  type: string;
  label: string;
  at: string;
  actor: "buyer" | "platform" | "supplier" | "partner" | "admin" | "rail" | "program";
  txSig?: string;
  note?: string;
}

export interface Order {
  id: string;
  quoteId: string;
  userId: string;
  supplierId: string;
  invoiceRef: string;
  escrowMode: boolean;
  invoiceCnyFen: number;
  quoteRateE6: number;
  amountUsdc: number;
  feeUsdc: number;
  totalNprPaisa: number;
  savingsNprPaisa: number;
  status: OrderStatus;
  orderPda: string;
  vaultPda: string;
  buyerWallet: string;
  supplierHash: string;
  rail: { method: RailMethod; reference: string; paidAt: string };
  tracking?: { carrier: string; number: string; shippedAt: string; deliveryDeadline: string };
  dispute?: { reason: string; note: string; openedAt: string; resolution?: "refunded" | "released"; resolvedAt?: string };
  payout?: { method: PayoutMethod; reference: string; cnyFen: number; paidAt: string };
  events: OrderEvent[];
  seeded?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChainTx {
  sig: string;
  slot: number;
  instructions: string[];
  orderId?: string;
  signer: string;
  at: string;
  cluster: string;
  simulated: boolean;
  logs: string[];
}
