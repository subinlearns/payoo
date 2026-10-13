use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, TransferChecked};

use crate::errors::PayooError;
use crate::events::{DisputeResolved, OrderRefunded, OrderReleased, OrderSettled};
use crate::state::*;

/// Moves everything in the vault to `destination`, then closes the vault and returns its rent.
fn drain_vault<'info>(
    token_program: &Program<'info, Token>,
    order: &Account<'info, Order>,
    vault: &Account<'info, TokenAccount>,
    mint: &Account<'info, Mint>,
    destination: &Account<'info, TokenAccount>,
    rent_receiver: &AccountInfo<'info>,
) -> Result<u64> {
    let amount = vault.amount;
    let seeds = order.signer_seeds();
    let signer: &[&[&[u8]]] = &[&seeds];

    if amount > 0 {
        token::transfer_checked(
            CpiContext::new_with_signer(
                token_program.to_account_info(),
                TransferChecked {
                    from: vault.to_account_info(),
                    mint: mint.to_account_info(),
                    to: destination.to_account_info(),
                    authority: order.to_account_info(),
                },
                signer,
            ),
            amount,
            mint.decimals,
        )?;
    }
    token::close_account(CpiContext::new_with_signer(
        token_program.to_account_info(),
        CloseAccount {
            account: vault.to_account_info(),
            destination: rent_receiver.clone(),
            authority: order.to_account_info(),
        },
        signer,
    ))?;
    Ok(amount)
}

#[derive(Accounts)]
pub struct ReleaseToSettlement<'info> {
    pub authority: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = usdc_mint,
        has_one = operator
    )]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [ORDER_SEED, order.order_id.as_ref()], bump = order.bump)]
    pub order: Box<Account<'info, Order>>,
    #[account(mut, seeds = [VAULT_SEED, order.key().as_ref()], bump = order.vault_bump)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = config.settlement_partner,
    )]
    pub settlement_token_account: Box<Account<'info, TokenAccount>>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    /// CHECK: receives the vault rent. Validated by `has_one`.
    #[account(mut)]
    pub operator: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn release_to_settlement_handler(ctx: Context<ReleaseToSettlement>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let config = &ctx.accounts.config;
    let order = &ctx.accounts.order;
    let authority = ctx.accounts.authority.key();
    let is_platform = authority == config.operator || authority == config.admin;

    // Release rules:
    //  - Direct mode: the platform releases as soon as the escrow is funded.
    //  - Escrow mode: after the buyer confirms delivery (platform or buyer may crank),
    //    or by anyone once the delivery deadline + dispute window passes with no dispute.
    let auto_release = match (order.escrow_mode, order.status) {
        (false, OrderStatus::Funded) => {
            require!(is_platform, PayooError::Unauthorized);
            false
        }
        (true, OrderStatus::Delivered) => {
            require!(is_platform || authority == order.buyer, PayooError::Unauthorized);
            false
        }
        (true, OrderStatus::InTransit) => {
            let unlock = order
                .delivery_deadline
                .checked_add(config.dispute_window_secs as i64)
                .ok_or(PayooError::Overflow)?;
            require!(now > unlock, PayooError::ReleaseWindowOpen);
            true
        }
        _ => return err!(PayooError::InvalidStatus),
    };

    let amount = drain_vault(
        &ctx.accounts.token_program,
        &ctx.accounts.order,
        &ctx.accounts.vault,
        &ctx.accounts.usdc_mint,
        &ctx.accounts.settlement_token_account,
        &ctx.accounts.operator.to_account_info(),
    )?;

    let order_key = ctx.accounts.order.key();
    let settlement_partner = ctx.accounts.config.settlement_partner;
    let order = &mut ctx.accounts.order;
    order.status = OrderStatus::Released;
    order.released_at = now;

    emit!(OrderReleased {
        order: order_key,
        settlement_partner,
        amount_usdc: amount,
        auto_release,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct MarkSettled<'info> {
    pub settlement_partner: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = settlement_partner @ PayooError::Unauthorized
    )]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [ORDER_SEED, order.order_id.as_ref()], bump = order.bump)]
    pub order: Box<Account<'info, Order>>,
}

pub fn mark_settled_handler(ctx: Context<MarkSettled>, payout_ref: [u8; 32]) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let order_key = ctx.accounts.order.key();
    let order = &mut ctx.accounts.order;
    require!(order.status == OrderStatus::Released, PayooError::InvalidStatus);
    order.status = OrderStatus::Settled;
    order.settled_at = now;
    order.payout_ref = payout_ref;

    let config = &mut ctx.accounts.config;
    config.total_settled_usdc = config
        .total_settled_usdc
        .checked_add(order.amount_usdc)
        .ok_or(PayooError::Overflow)?;

    emit!(OrderSettled {
        order: order_key,
        payout_ref,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct Refund<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = usdc_mint,
        has_one = treasury,
        has_one = operator
    )]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [ORDER_SEED, order.order_id.as_ref()], bump = order.bump)]
    pub order: Box<Account<'info, Order>>,
    #[account(mut, seeds = [VAULT_SEED, order.key().as_ref()], bump = order.vault_bump)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = usdc_mint)]
    pub treasury: Box<Account<'info, TokenAccount>>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    /// CHECK: receives the vault rent. Validated by `has_one`.
    #[account(mut)]
    pub operator: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

/// Platform-initiated refund, e.g. the settlement partner could not pay the supplier.
pub fn refund_handler(ctx: Context<Refund>) -> Result<()> {
    let authority = ctx.accounts.authority.key();
    let config = &ctx.accounts.config;
    require!(
        authority == config.operator || authority == config.admin,
        PayooError::Unauthorized
    );
    require!(
        matches!(
            ctx.accounts.order.status,
            OrderStatus::Funded | OrderStatus::InTransit
        ),
        PayooError::InvalidStatus
    );

    let amount = drain_vault(
        &ctx.accounts.token_program,
        &ctx.accounts.order,
        &ctx.accounts.vault,
        &ctx.accounts.usdc_mint,
        &ctx.accounts.treasury,
        &ctx.accounts.operator.to_account_info(),
    )?;

    let config = &mut ctx.accounts.config;
    config.total_refunded_usdc = config
        .total_refunded_usdc
        .checked_add(amount)
        .ok_or(PayooError::Overflow)?;

    let order_key = ctx.accounts.order.key();
    ctx.accounts.order.status = OrderStatus::Refunded;
    emit!(OrderRefunded {
        order: order_key,
        amount_usdc: amount,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct ResolveDispute<'info> {
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ PayooError::Unauthorized,
        has_one = usdc_mint,
        has_one = treasury,
        has_one = operator
    )]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [ORDER_SEED, order.order_id.as_ref()], bump = order.bump)]
    pub order: Box<Account<'info, Order>>,
    #[account(mut, seeds = [VAULT_SEED, order.key().as_ref()], bump = order.vault_bump)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = usdc_mint)]
    pub treasury: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = config.settlement_partner,
    )]
    pub settlement_token_account: Box<Account<'info, TokenAccount>>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    /// CHECK: receives the vault rent. Validated by `has_one`.
    #[account(mut)]
    pub operator: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn resolve_dispute_handler(ctx: Context<ResolveDispute>, refund_buyer: bool) -> Result<()> {
    require!(
        ctx.accounts.order.status == OrderStatus::Disputed,
        PayooError::InvalidStatus
    );
    let now = Clock::get()?.unix_timestamp;

    let destination = if refund_buyer {
        &ctx.accounts.treasury
    } else {
        &ctx.accounts.settlement_token_account
    };
    let amount = drain_vault(
        &ctx.accounts.token_program,
        &ctx.accounts.order,
        &ctx.accounts.vault,
        &ctx.accounts.usdc_mint,
        destination,
        &ctx.accounts.operator.to_account_info(),
    )?;

    let order_key = ctx.accounts.order.key();
    if refund_buyer {
        let config = &mut ctx.accounts.config;
        config.total_refunded_usdc = config
            .total_refunded_usdc
            .checked_add(amount)
            .ok_or(PayooError::Overflow)?;
        ctx.accounts.order.status = OrderStatus::Refunded;
        emit!(OrderRefunded {
            order: order_key,
            amount_usdc: amount,
        });
    } else {
        let order = &mut ctx.accounts.order;
        order.status = OrderStatus::Released;
        order.released_at = now;
        emit!(OrderReleased {
            order: order_key,
            settlement_partner: ctx.accounts.config.settlement_partner,
            amount_usdc: amount,
            auto_release: false,
        });
    }
    emit!(DisputeResolved {
        order: order_key,
        refunded: refund_buyer,
    });
    Ok(())
}
