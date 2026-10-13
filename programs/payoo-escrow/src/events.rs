use anchor_lang::prelude::*;

#[event]
pub struct RateUpdated {
    pub usd_cny_e6: u64,
    pub usd_npr_e6: u64,
    pub source: u8,
    pub updated_at: i64,
}

#[event]
pub struct OrderCreated {
    pub order: Pubkey,
    pub order_id: [u8; 16],
    pub buyer: Pubkey,
    pub invoice_cny_fen: u64,
    pub amount_usdc: u64,
    pub quote_rate_e6: u64,
    pub escrow_mode: bool,
}

#[event]
pub struct OrderFunded {
    pub order: Pubkey,
    pub amount_usdc: u64,
}

#[event]
pub struct OrderShipped {
    pub order: Pubkey,
    pub delivery_deadline: i64,
}

#[event]
pub struct DeliveryConfirmed {
    pub order: Pubkey,
    pub buyer: Pubkey,
}

#[event]
pub struct OrderReleased {
    pub order: Pubkey,
    pub settlement_partner: Pubkey,
    pub amount_usdc: u64,
    pub auto_release: bool,
}

#[event]
pub struct OrderSettled {
    pub order: Pubkey,
    pub payout_ref: [u8; 32],
}

#[event]
pub struct DisputeOpened {
    pub order: Pubkey,
    pub reason: u8,
}

#[event]
pub struct DisputeResolved {
    pub order: Pubkey,
    pub refunded: bool,
}

#[event]
pub struct OrderRefunded {
    pub order: Pubkey,
    pub amount_usdc: u64,
}

#[event]
pub struct OrderCancelled {
    pub order: Pubkey,
}
