use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, TransferChecked};

use crate::errors::PayooError;
use crate::events::{OrderCancelled, OrderCreated, OrderFunded};
use crate::state::*;

/// Longest quote lock the program accepts.
const MAX_QUOTE_TTL_SECS: i64 = 60 * 60;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateOrderParams {
    pub order_id: [u8; 16],
    pub supplier_hash: [u8; 32],
    pub invoice_cny_fen: u64,
    pub quote_rate_e6: u64,
    pub amount_usdc: u64,
    pub npr_paid_paisa: u64,
    pub quote_expires_at: i64,
    pub escrow_mode: bool,
}

#[derive(Accounts)]
#[instruction(params: CreateOrderParams)]
pub struct CreateOrder<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = operator @ PayooError::Unauthorized,
        has_one = usdc_mint
    )]
    pub config: Box<Account<'info, Config>>,
    #[account(seeds = [RATE_SEED], bump = rate_feed.bump)]
    pub rate_feed: Box<Account<'info, RateFeed>>,
    /// CHECK: the buyer's embedded wallet; only its address is recorded.
    pub buyer: UncheckedAccount<'info>,
    #[account(
        init,
        payer = operator,
        space = 8 + Order::INIT_SPACE,
        seeds = [ORDER_SEED, params.order_id.as_ref()],
        bump
    )]
    pub order: Box<Account<'info, Order>>,
    #[account(
        init,
        payer = operator,
        seeds = [VAULT_SEED, order.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = order,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

/// USDC base units (6dp) needed to deliver `fen` CNY at `rate_e6` CNY/USD, rounded up.
pub fn usdc_for_invoice(fen: u64, rate_e6: u64) -> Option<u64> {
    let num = (fen as u128).checked_mul(10_000_000_000u128)?;
    let den = rate_e6 as u128;
    if den == 0 {
        return None;
    }
    let q = num.checked_add(den - 1)? / den;
    u64::try_from(q).ok()
}

pub fn create_order_handler(ctx: Context<CreateOrder>, params: CreateOrderParams) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let config = &mut ctx.accounts.config;
    let rate = &ctx.accounts.rate_feed;

    require!(!config.paused, PayooError::Paused);
    require!(
        params.invoice_cny_fen > 0 && params.amount_usdc > 0,
        PayooError::ZeroAmount
    );
    require!(
        params.amount_usdc <= config.max_order_usdc,
        PayooError::OrderTooLarge
    );
    require!(params.quote_expires_at > now, PayooError::QuoteExpired);
    require!(
        params.quote_expires_at <= now + MAX_QUOTE_TTL_SECS,
        PayooError::InvalidParam
    );

    // The quote must be priced off a fresh reference rate...
    require!(
        now.saturating_sub(rate.updated_at) <= config.max_rate_staleness_secs as i64,
        PayooError::StaleRate
    );
    // ...and stay within the allowed band around it.
    let diff = params.quote_rate_e6.abs_diff(rate.usd_cny_e6) as u128;
    require!(
        diff * (BPS as u128) <= (config.max_quote_deviation_bps as u128) * (rate.usd_cny_e6 as u128),
        PayooError::RateDeviation
    );

    // The escrowed USDC must cover the invoice at the quoted rate.
    let expected = usdc_for_invoice(params.invoice_cny_fen, params.quote_rate_e6)
        .ok_or(PayooError::Overflow)?;
    require!(
        params.amount_usdc >= expected && params.amount_usdc <= expected + 1,
        PayooError::AmountMismatch
    );

    let fee_usdc = ((params.amount_usdc as u128) * (config.fee_bps as u128) / (BPS as u128)) as u64;

    let order_key = ctx.accounts.order.key();
    let order = &mut ctx.accounts.order;
    order.order_id = params.order_id;
    order.buyer = ctx.accounts.buyer.key();
    order.supplier_hash = params.supplier_hash;
    order.invoice_cny_fen = params.invoice_cny_fen;
    order.quote_rate_e6 = params.quote_rate_e6;
    order.amount_usdc = params.amount_usdc;
    order.fee_usdc = fee_usdc;
    order.npr_paid_paisa = params.npr_paid_paisa;
    order.escrow_mode = params.escrow_mode;
    order.status = OrderStatus::Created;
    order.created_at = now;
    order.quote_expires_at = params.quote_expires_at;
    order.funded_at = 0;
    order.shipped_at = 0;
    order.delivery_deadline = 0;
    order.released_at = 0;
    order.settled_at = 0;
    order.payout_ref = [0u8; 32];
    order.dispute_reason = 0;
    order.bump = ctx.bumps.order;
    order.vault_bump = ctx.bumps.vault;

    config.order_count = config.order_count.checked_add(1).ok_or(PayooError::Overflow)?;

    emit!(OrderCreated {
        order: order_key,
        order_id: params.order_id,
        buyer: order.buyer,
        invoice_cny_fen: params.invoice_cny_fen,
        amount_usdc: params.amount_usdc,
        quote_rate_e6: params.quote_rate_e6,
        escrow_mode: params.escrow_mode,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct FundOrder<'info> {
    pub operator: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = operator @ PayooError::Unauthorized,
        has_one = usdc_mint,
        has_one = treasury
    )]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [ORDER_SEED, order.order_id.as_ref()], bump = order.bump)]
    pub order: Box<Account<'info, Order>>,
    #[account(mut, seeds = [VAULT_SEED, order.key().as_ref()], bump = order.vault_bump)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = usdc_mint, token::authority = operator)]
    pub treasury: Box<Account<'info, TokenAccount>>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
}

pub fn fund_order_handler(ctx: Context<FundOrder>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(!ctx.accounts.config.paused, PayooError::Paused);
    require!(
        ctx.accounts.order.status == OrderStatus::Created,
        PayooError::InvalidStatus
    );
    require!(
        now <= ctx.accounts.order.quote_expires_at,
        PayooError::QuoteExpired
    );

    let amount = ctx.accounts.order.amount_usdc;
    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.treasury.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.operator.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.usdc_mint.decimals,
    )?;

    let config = &mut ctx.accounts.config;
    config.total_volume_usdc = config
        .total_volume_usdc
        .checked_add(amount)
        .ok_or(PayooError::Overflow)?;

    let order_key = ctx.accounts.order.key();
    let order = &mut ctx.accounts.order;
    order.status = OrderStatus::Funded;
    order.funded_at = now;

    emit!(OrderFunded {
        order: order_key,
        amount_usdc: amount,
    });
    Ok(())
}

/// Permissionless clean-up of a quote that expired before it was funded.
#[derive(Accounts)]
pub struct CancelExpired<'info> {
    pub cranker: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = operator)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [ORDER_SEED, order.order_id.as_ref()], bump = order.bump)]
    pub order: Box<Account<'info, Order>>,
    #[account(mut, seeds = [VAULT_SEED, order.key().as_ref()], bump = order.vault_bump)]
    pub vault: Box<Account<'info, TokenAccount>>,
    /// CHECK: paid the vault rent at creation; receives it back. Validated by `has_one`.
    #[account(mut)]
    pub operator: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn cancel_expired_handler(ctx: Context<CancelExpired>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let order = &ctx.accounts.order;
    require!(order.status == OrderStatus::Created, PayooError::InvalidStatus);
    require!(now > order.quote_expires_at, PayooError::QuoteNotExpired);

    let seeds = order.signer_seeds();
    let signer: &[&[&[u8]]] = &[&seeds];
    token::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        CloseAccount {
            account: ctx.accounts.vault.to_account_info(),
            destination: ctx.accounts.operator.to_account_info(),
            authority: ctx.accounts.order.to_account_info(),
        },
        signer,
    ))?;

    let order_key = ctx.accounts.order.key();
    ctx.accounts.order.status = OrderStatus::Cancelled;
    emit!(OrderCancelled { order: order_key });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::usdc_for_invoice;

    #[test]
    fn converts_invoice_at_quoted_rate() {
        // ¥10,000.00 at 7.000000 CNY/USD = $1,428.571429 (rounded up)
        assert_eq!(usdc_for_invoice(1_000_000, 7_000_000), Some(1_428_571_429));
        // ¥7.00 at 7.0 = exactly $1.00
        assert_eq!(usdc_for_invoice(700, 7_000_000), Some(1_000_000));
    }

    #[test]
    fn rejects_zero_rate_and_overflow() {
        assert_eq!(usdc_for_invoice(100, 0), None);
        assert_eq!(usdc_for_invoice(u64::MAX, 1), None);
    }
}
