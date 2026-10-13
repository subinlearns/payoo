use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::errors::PayooError;
use crate::events::RateUpdated;
use crate::state::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeParams {
    pub operator: Pubkey,
    pub oracle_authority: Pubkey,
    pub settlement_partner: Pubkey,
    pub fee_bps: u16,
    pub max_quote_deviation_bps: u16,
    pub max_rate_staleness_secs: u32,
    pub dispute_window_secs: u32,
    pub max_order_usdc: u64,
    pub usd_cny_e6: u64,
    pub usd_npr_e6: u64,
}

#[derive(Accounts)]
#[instruction(params: InitializeParams)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Box<Account<'info, Config>>,
    #[account(
        init,
        payer = admin,
        space = 8 + RateFeed::INIT_SPACE,
        seeds = [RATE_SEED],
        bump
    )]
    pub rate_feed: Box<Account<'info, RateFeed>>,
    #[account(constraint = usdc_mint.decimals == 6 @ PayooError::InvalidParam)]
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(
        token::mint = usdc_mint,
        token::authority = params.operator,
    )]
    pub treasury: Box<Account<'info, TokenAccount>>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

pub fn initialize_handler(ctx: Context<Initialize>, params: InitializeParams) -> Result<()> {
    require!(params.fee_bps <= 1_000, PayooError::InvalidParam);
    require!(
        params.max_quote_deviation_bps > 0 && params.max_quote_deviation_bps <= 2_000,
        PayooError::InvalidParam
    );
    require!(params.max_rate_staleness_secs > 0, PayooError::InvalidParam);
    require!(params.max_order_usdc > 0, PayooError::InvalidParam);
    require!(
        params.usd_cny_e6 > 0 && params.usd_npr_e6 > 0,
        PayooError::InvalidParam
    );

    let now = Clock::get()?.unix_timestamp;

    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.operator = params.operator;
    config.oracle_authority = params.oracle_authority;
    config.settlement_partner = params.settlement_partner;
    config.usdc_mint = ctx.accounts.usdc_mint.key();
    config.treasury = ctx.accounts.treasury.key();
    config.fee_bps = params.fee_bps;
    config.max_quote_deviation_bps = params.max_quote_deviation_bps;
    config.max_rate_staleness_secs = params.max_rate_staleness_secs;
    config.dispute_window_secs = params.dispute_window_secs;
    config.max_order_usdc = params.max_order_usdc;
    config.paused = false;
    config.order_count = 0;
    config.total_volume_usdc = 0;
    config.total_settled_usdc = 0;
    config.total_refunded_usdc = 0;
    config.bump = ctx.bumps.config;

    let rate = &mut ctx.accounts.rate_feed;
    rate.usd_cny_e6 = params.usd_cny_e6;
    rate.usd_npr_e6 = params.usd_npr_e6;
    rate.updated_at = now;
    rate.source = 0;
    rate.bump = ctx.bumps.rate_feed;

    emit!(RateUpdated {
        usd_cny_e6: rate.usd_cny_e6,
        usd_npr_e6: rate.usd_npr_e6,
        source: rate.source,
        updated_at: now,
    });
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct UpdateConfigParams {
    pub operator: Option<Pubkey>,
    pub oracle_authority: Option<Pubkey>,
    pub settlement_partner: Option<Pubkey>,
    pub treasury: Option<Pubkey>,
    pub fee_bps: Option<u16>,
    pub max_quote_deviation_bps: Option<u16>,
    pub max_rate_staleness_secs: Option<u32>,
    pub dispute_window_secs: Option<u32>,
    pub max_order_usdc: Option<u64>,
    pub paused: Option<bool>,
    pub new_admin: Option<Pubkey>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ PayooError::Unauthorized
    )]
    pub config: Box<Account<'info, Config>>,
}

pub fn update_config_handler(ctx: Context<UpdateConfig>, params: UpdateConfigParams) -> Result<()> {
    let config = &mut ctx.accounts.config;
    if let Some(v) = params.operator {
        config.operator = v;
    }
    if let Some(v) = params.oracle_authority {
        config.oracle_authority = v;
    }
    if let Some(v) = params.settlement_partner {
        config.settlement_partner = v;
    }
    if let Some(v) = params.treasury {
        config.treasury = v;
    }
    if let Some(v) = params.fee_bps {
        require!(v <= 1_000, PayooError::InvalidParam);
        config.fee_bps = v;
    }
    if let Some(v) = params.max_quote_deviation_bps {
        require!(v > 0 && v <= 2_000, PayooError::InvalidParam);
        config.max_quote_deviation_bps = v;
    }
    if let Some(v) = params.max_rate_staleness_secs {
        require!(v > 0, PayooError::InvalidParam);
        config.max_rate_staleness_secs = v;
    }
    if let Some(v) = params.dispute_window_secs {
        config.dispute_window_secs = v;
    }
    if let Some(v) = params.max_order_usdc {
        require!(v > 0, PayooError::InvalidParam);
        config.max_order_usdc = v;
    }
    if let Some(v) = params.paused {
        config.paused = v;
    }
    if let Some(v) = params.new_admin {
        config.admin = v;
    }
    Ok(())
}

#[derive(Accounts)]
pub struct PushRate<'info> {
    pub oracle_authority: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = oracle_authority @ PayooError::Unauthorized
    )]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [RATE_SEED], bump = rate_feed.bump)]
    pub rate_feed: Box<Account<'info, RateFeed>>,
}

pub fn push_rate_handler(
    ctx: Context<PushRate>,
    usd_cny_e6: u64,
    usd_npr_e6: u64,
    source: u8,
) -> Result<()> {
    require!(usd_cny_e6 > 0 && usd_npr_e6 > 0, PayooError::InvalidParam);
    let now = Clock::get()?.unix_timestamp;
    let rate = &mut ctx.accounts.rate_feed;
    rate.usd_cny_e6 = usd_cny_e6;
    rate.usd_npr_e6 = usd_npr_e6;
    rate.source = source;
    rate.updated_at = now;
    emit!(RateUpdated {
        usd_cny_e6,
        usd_npr_e6,
        source,
        updated_at: now,
    });
    Ok(())
}
