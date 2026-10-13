use anchor_lang::prelude::*;

#[error_code]
pub enum PayooError {
    #[msg("Platform is paused")]
    Paused,
    #[msg("Signer is not authorized for this action")]
    Unauthorized,
    #[msg("Order is not in a valid state for this action")]
    InvalidStatus,
    #[msg("Instruction only applies to escrow-protected orders")]
    NotEscrowMode,
    #[msg("Quote has expired")]
    QuoteExpired,
    #[msg("Quote has not expired yet")]
    QuoteNotExpired,
    #[msg("FX reference rate is stale")]
    StaleRate,
    #[msg("Quoted FX rate deviates too far from the reference rate")]
    RateDeviation,
    #[msg("USDC amount does not match the invoice and quoted rate")]
    AmountMismatch,
    #[msg("Order amount must be greater than zero")]
    ZeroAmount,
    #[msg("Order amount exceeds the per-order limit")]
    OrderTooLarge,
    #[msg("Invalid parameter")]
    InvalidParam,
    #[msg("Auto-release window has not elapsed")]
    ReleaseWindowOpen,
    #[msg("Arithmetic overflow")]
    Overflow,
}
