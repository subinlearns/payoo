//! Payoo escrow program.
//!
//! Locks USDC per cross-border payment order (Nepal -> China) and releases it to a
//! licensed settlement partner, who pays the supplier in CNY. Supports direct payments
//! and buyer-protected escrow with delivery confirmation, disputes and refunds.

use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("JDyePwDypafn8Yi9fZdzPYp7b4uztLKD9zZ3DfV4VxVy");

#[program]
pub mod payoo_escrow {
    use super::*;

    /// One-time setup of the platform config and FX reference rate feed.
    pub fn initialize(ctx: Context<Initialize>, params: InitializeParams) -> Result<()> {
        instructions::admin::initialize_handler(ctx, params)
    }

    /// Admin-only config changes (keys, fee, limits, pause).
    pub fn update_config(ctx: Context<UpdateConfig>, params: UpdateConfigParams) -> Result<()> {
        instructions::admin::update_config_handler(ctx, params)
    }

    /// Oracle authority pushes USD/CNY and USD/NPR reference rates.
    pub fn push_rate(
        ctx: Context<PushRate>,
        usd_cny_e6: u64,
        usd_npr_e6: u64,
        source: u8,
    ) -> Result<()> {
        instructions::admin::push_rate_handler(ctx, usd_cny_e6, usd_npr_e6, source)
    }

    /// Records an accepted quote and opens an empty escrow vault for it.
    pub fn create_order(ctx: Context<CreateOrder>, params: CreateOrderParams) -> Result<()> {
        instructions::order::create_order_handler(ctx, params)
    }

    /// Moves USDC from the treasury into the order's escrow vault.
    pub fn fund_order(ctx: Context<FundOrder>) -> Result<()> {
        instructions::order::fund_order_handler(ctx)
    }

    /// Escrow mode: supplier shipped; starts the delivery window.
    pub fn mark_in_transit(ctx: Context<MarkInTransit>, delivery_window_secs: u32) -> Result<()> {
        instructions::escrow::mark_in_transit_handler(ctx, delivery_window_secs)
    }

    /// Escrow mode: buyer confirms the goods arrived.
    pub fn confirm_delivery(ctx: Context<BuyerAction>) -> Result<()> {
        instructions::escrow::confirm_delivery_handler(ctx)
    }

    /// Escrow mode: buyer freezes the funds pending admin review.
    pub fn open_dispute(ctx: Context<BuyerAction>, reason: u8) -> Result<()> {
        instructions::escrow::open_dispute_handler(ctx, reason)
    }

    /// Sends escrowed USDC to the settlement partner.
    pub fn release_to_settlement(ctx: Context<ReleaseToSettlement>) -> Result<()> {
        instructions::settlement::release_to_settlement_handler(ctx)
    }

    /// Settlement partner confirms the CNY payout reached the supplier.
    pub fn mark_settled(ctx: Context<MarkSettled>, payout_ref: [u8; 32]) -> Result<()> {
        instructions::settlement::mark_settled_handler(ctx, payout_ref)
    }

    /// Returns escrowed USDC to the treasury (buyer is refunded in NPR).
    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        instructions::settlement::refund_handler(ctx)
    }

    /// Admin settles a dispute: refund the buyer or pay the supplier.
    pub fn resolve_dispute(ctx: Context<ResolveDispute>, refund_buyer: bool) -> Result<()> {
        instructions::settlement::resolve_dispute_handler(ctx, refund_buyer)
    }

    /// Anyone may cancel an order whose quote expired before funding.
    pub fn cancel_expired(ctx: Context<CancelExpired>) -> Result<()> {
        instructions::order::cancel_expired_handler(ctx)
    }
}
