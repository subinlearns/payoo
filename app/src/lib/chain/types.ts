export type ChainMode = "simulated" | "devnet" | "localnet";

export type OnchainStatus =
  | "Created"
  | "Funded"
  | "InTransit"
  | "Delivered"
  | "Released"
  | "Settled"
  | "Disputed"
  | "Refunded"
  | "Cancelled";

export interface OnchainOrder {
  address: string;
  vault: string;
  buyer: string;
  status: OnchainStatus;
  invoiceCnyFen: number;
  quoteRateE6: number;
  amountUsdc: number;
  feeUsdc: number;
  nprPaidPaisa: number;
  escrowMode: boolean;
  createdAt: number;
  quoteExpiresAt: number;
  fundedAt: number;
  shippedAt: number;
  deliveryDeadline: number;
  releasedAt: number;
  settledAt: number;
  payoutRef: string;
  disputeReason: number;
  vaultBalance: number;
}

export interface ChainInfo {
  mode: ChainMode;
  cluster: string;
  ready: boolean;
  error?: string;
  programId: string;
  configPda: string;
  rateFeedPda: string;
  admin: string;
  operator: string;
  oracleAuthority: string;
  settlementPartner: string;
  usdcMint: string;
  treasury: string;
  settlementTokenAccount: string;
  treasuryUsdc: number;
  settlementUsdc: number;
  operatorSol?: number;
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
  rateFeed: { usdCnyE6: number; usdNprE6: number; updatedAt: number; source: number } | null;
}

export interface TxResult {
  sig: string;
  slot: number;
}

export interface CreateOrderArgs {
  orderId: string;
  buyer: string;
  supplierHash: Buffer;
  invoiceCnyFen: number;
  quoteRateE6: number;
  amountUsdc: number;
  nprPaidPaisa: number;
  /** unix seconds */
  quoteExpiresAt: number;
  escrowMode: boolean;
}

export type ReleaseSigner = { kind: "operator" } | { kind: "buyer"; secretKey: string };

export interface ChainAdapter {
  mode: ChainMode;
  cluster: string;
  info(): Promise<ChainInfo>;
  explorerTx(sig: string): string;
  explorerAddress(address: string): string;
  pushRate(usdCnyE6: number, usdNprE6: number, source: number): Promise<TxResult>;
  /** create_order + fund_order in one atomic transaction. */
  createAndFund(args: CreateOrderArgs): Promise<TxResult>;
  markInTransit(orderId: string, deliveryWindowSecs: number): Promise<TxResult>;
  confirmDelivery(orderId: string, buyerSecretKey: string): Promise<TxResult>;
  openDispute(orderId: string, buyerSecretKey: string, reason: number): Promise<TxResult>;
  release(orderId: string, signer: ReleaseSigner): Promise<TxResult>;
  markSettled(orderId: string, payoutRef: Buffer): Promise<TxResult>;
  refund(orderId: string): Promise<TxResult>;
  resolveDispute(orderId: string, refundBuyer: boolean): Promise<TxResult>;
  fetchOrder(orderId: string): Promise<OnchainOrder | null>;
}

export class ProgramError extends Error {
  constructor(
    public code: number,
    public errorName: string,
    message: string,
  ) {
    super(message);
  }
}
