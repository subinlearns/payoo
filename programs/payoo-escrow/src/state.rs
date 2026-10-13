use anchor_lang::prelude::*;

pub const CONFIG_SEED: &[u8] = b"config";
pub const RATE_SEED: &[u8] = b"rate";
pub const ORDER_SEED: &[u8] = b"order";
pub const VAULT_SEED: &[u8] = b"vault";

/// Basis-point denominator (100% = 10_000 bps).
pub const BPS: u64 = 10_000;
/// Fixed-point scale used for FX rates (rate_e6 = rate * 1_000_000).
pub const RATE_SCALE: u64 = 1_000_000;

/// Global platform configuration. One per deployment.
#[account]
#[derive(InitSpace)]
pub struct Config {
    /// Governance key (a Squads multisig in production). Resolves disputes, edits config.
    pub admin: Pubkey,
    /// Platform backend hot key. Creates and funds orders, marks shipments.
    pub operator: Pubkey,
    /// Key allowed to push FX reference rates (relays Pyth / market data).
    pub oracle_authority: Pubkey,
    /// Licensed settlement partner wallet. Receives USDC and pays suppliers in CNY.
    pub settlement_partner: Pubkey,
    /// USDC mint accepted by the escrow.
    pub usdc_mint: Pubkey,
    /// Treasury USDC token account (owned by `operator`) that funds escrows and receives refunds.
    pub treasury: Pubkey,
    /// Platform fee in bps, recorded per order for transparent receipts.
    pub fee_bps: u16,
    /// Max allowed deviation between a quoted rate and the on-chain reference rate.
    pub max_quote_deviation_bps: u16,
    /// Reference rate must be fresher than this when an order is created.
    pub max_rate_staleness_secs: u32,
    /// Grace period after the delivery deadline before anyone may crank an auto-release.
    pub dispute_window_secs: u32,
    /// Per-order cap (in USDC base units) to limit blast radius in early stages.
    pub max_order_usdc: u64,
    pub paused: bool,
    pub order_count: u64,
    pub total_volume_usdc: u64,
    pub total_settled_usdc: u64,
    pub total_refunded_usdc: u64,
    pub bump: u8,
}

/// On-chain FX reference rates, pushed by the oracle authority.
#[account]
#[derive(InitSpace)]
pub struct RateFeed {
    /// CNY per 1 USD, scaled by 1e6.
    pub usd_cny_e6: u64,
    /// NPR per 1 USD, scaled by 1e6.
    pub usd_npr_e6: u64,
    pub updated_at: i64,
    /// 0 = manual, 1 = Pyth, 2 = public market API.
    pub source: u8,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum OrderStatus {
    /// Quote accepted and NPR received; escrow account exists but is empty.
    Created,
    /// USDC locked in the escrow vault.
    Funded,
    /// Escrow mode: supplier has shipped.
    InTransit,
    /// Escrow mode: buyer confirmed delivery.
    Delivered,
    /// USDC sent to the settlement partner.
    Released,
    /// Settlement partner confirmed the CNY payout to the supplier.
    Settled,
    /// Buyer raised a dispute; funds frozen until the admin resolves it.
    Disputed,
    /// USDC returned to the treasury (buyer is refunded in NPR off-chain).
    Refunded,
    /// Quote expired before funding.
    Cancelled,
}

/// One escrow per payment order. PDA: ["order", order_id].
#[account]
#[derive(InitSpace)]
pub struct Order {
    /// Off-chain order UUID (16 bytes).
    pub order_id: [u8; 16],
    /// Buyer's embedded wallet.
    pub buyer: Pubkey,
    /// sha256 of the supplier payout details (kept off-chain for privacy).
    pub supplier_hash: [u8; 32],
    /// Invoice amount in CNY fen (1/100 yuan).
    pub invoice_cny_fen: u64,
    /// CNY per USD (x1e6) locked in the quote.
    pub quote_rate_e6: u64,
    /// USDC (6 decimals) the escrow must deliver to the settlement partner.
    pub amount_usdc: u64,
    /// Platform fee in USDC terms, recorded for the receipt.
    pub fee_usdc: u64,
    /// Total the buyer paid in NPR paisa (1/100 rupee).
    pub npr_paid_paisa: u64,
    pub escrow_mode: bool,
    pub status: OrderStatus,
    pub created_at: i64,
    pub quote_expires_at: i64,
    pub funded_at: i64,
    pub shipped_at: i64,
    pub delivery_deadline: i64,
    pub released_at: i64,
    pub settled_at: i64,
    /// Settlement partner payout reference (bank / Alipay / WeChat transaction id).
    pub payout_ref: [u8; 32],
    pub dispute_reason: u8,
    pub bump: u8,
    pub vault_bump: u8,
}

impl Order {
    pub fn signer_seeds(&self) -> [&[u8]; 3] {
        [ORDER_SEED, &self.order_id, std::slice::from_ref(&self.bump)]
    }
}
