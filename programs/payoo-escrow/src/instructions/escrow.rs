use anchor_lang::prelude::*;

use crate::errors::PayooError;
use crate::events::{DeliveryConfirmed, DisputeOpened, OrderShipped};
use crate::state::*;

/// Longest delivery window the operator may set when a supplier ships.
const MAX_DELIVERY_WINDOW_SECS: u32 = 90 * 24 * 60 * 60;

#[derive(Accounts)]
pub struct MarkInTransit<'info> {
    pub operator: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = operator @ PayooError::Unauthorized
    )]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [ORDER_SEED, order.order_id.as_ref()], bump = order.bump)]
    pub order: Box<Account<'info, Order>>,
}

pub fn mark_in_transit_handler(ctx: Context<MarkInTransit>, delivery_window_secs: u32) -> Result<()> {
    require!(
        delivery_window_secs > 0 && delivery_window_secs <= MAX_DELIVERY_WINDOW_SECS,
        PayooError::InvalidParam
    );
    let now = Clock::get()?.unix_timestamp;
    let order_key = ctx.accounts.order.key();
    let order = &mut ctx.accounts.order;
    require!(order.escrow_mode, PayooError::NotEscrowMode);
    require!(order.status == OrderStatus::Funded, PayooError::InvalidStatus);

    order.status = OrderStatus::InTransit;
    order.shipped_at = now;
    order.delivery_deadline = now + delivery_window_secs as i64;

    emit!(OrderShipped {
        order: order_key,
        delivery_deadline: order.delivery_deadline,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct BuyerAction<'info> {
    pub buyer: Signer<'info>,
    #[account(
        mut,
        seeds = [ORDER_SEED, order.order_id.as_ref()],
        bump = order.bump,
        has_one = buyer @ PayooError::Unauthorized
    )]
    pub order: Box<Account<'info, Order>>,
}

pub fn confirm_delivery_handler(ctx: Context<BuyerAction>) -> Result<()> {
    let order_key = ctx.accounts.order.key();
    let order = &mut ctx.accounts.order;
    require!(order.escrow_mode, PayooError::NotEscrowMode);
    require!(
        matches!(order.status, OrderStatus::Funded | OrderStatus::InTransit),
        PayooError::InvalidStatus
    );
    order.status = OrderStatus::Delivered;
    emit!(DeliveryConfirmed {
        order: order_key,
        buyer: order.buyer,
    });
    Ok(())
}

pub fn open_dispute_handler(ctx: Context<BuyerAction>, reason: u8) -> Result<()> {
    let order_key = ctx.accounts.order.key();
    let order = &mut ctx.accounts.order;
    require!(order.escrow_mode, PayooError::NotEscrowMode);
    require!(
        matches!(order.status, OrderStatus::Funded | OrderStatus::InTransit),
        PayooError::InvalidStatus
    );
    order.status = OrderStatus::Disputed;
    order.dispute_reason = reason;
    emit!(DisputeOpened {
        order: order_key,
        reason,
    });
    Ok(())
}
