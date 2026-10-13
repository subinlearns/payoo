# Payoo architecture

## Components

```
┌──────────────────────────── app/ (Next.js 16) ─────────────────────────────┐
│ Importer UI        Supplier portal     Partner console     Admin    Ledger │
│      │                   │                    │               │            │
│      └──────────── API routes (src/app/api) ──┴───────────────┘            │
│                          │                                                 │
│  lib/orders.ts  quote → mock NPR rail → escrow → actions (state machine)   │
│  lib/quote.ts   FX + fee math (mirrors on-chain rounding)                  │
│  lib/fx.ts      Pyth Hermes (USD/CNH) → open.er-api → fallback             │
│  lib/chain/     ChainAdapter                                               │
│     ├─ simulated.ts  in-process replica of payoo_escrow (default)          │
│     └─ anchor.ts     Anchor client for localnet/devnet (generated IDL)     │
│  lib/db.ts      JSON file store (.data/) for UX state; chain = funds truth │
└────────────────────────────────────────────────────────────────────────────┘
                               │ transactions (operator pays fees)
                               ▼
┌──────────────────── programs/payoo-escrow (Anchor 0.31) ───────────────────┐
│ Config PDA ["config"]   RateFeed PDA ["rate"]                              │
│ Order PDA ["order", uuid]  ── authority of ──▶ Vault PDA ["vault", order]  │
│ Treasury ATA (operator)   Settlement ATA (partner)   USDC mint (6 dp)      │
└────────────────────────────────────────────────────────────────────────────┘
```

## Accounts

| Account | Seeds | Purpose |
|---|---|---|
| `Config` | `["config"]` | Admin, operator, oracle authority, settlement partner, USDC mint, treasury, fee, limits, pause flag, running totals |
| `RateFeed` | `["rate"]` | USD/CNY and USD/NPR reference rates (×1e6), timestamp, source |
| `Order` | `["order", order_id(16 bytes)]` | Buyer, supplier hash, invoice (fen), locked rate, USDC amount, fee, NPR paid, mode, status, timestamps, payout ref |
| Vault | `["vault", order]` | SPL token account owned by the order PDA; closed on release/refund/cancel |

## Instructions and signers

| Instruction | Signer | Effect |
|---|---|---|
| `initialize` | admin | Creates Config + RateFeed; treasury must be a USDC account owned by the operator |
| `update_config` | admin | Rotate keys, fee, limits, pause |
| `push_rate` | oracle authority | Refresh reference rates |
| `create_order` | operator | Validates FX deviation, staleness, amount, cap; opens an empty vault |
| `fund_order` | operator | Treasury → vault (same tx as create in the app) |
| `mark_in_transit` | operator | Escrow mode: starts delivery window |
| `confirm_delivery` / `open_dispute` | buyer | Escrow mode only |
| `release_to_settlement` | operator/admin (direct), buyer/platform (delivered), anyone (after deadline + dispute window) | Vault → partner ATA, close vault |
| `mark_settled` | settlement partner | Records the CNY payout reference hash |
| `refund` | operator/admin | Vault → treasury (buyer refunded in NPR off-chain) |
| `resolve_dispute` | admin | Refund or release a disputed order |
| `cancel_expired` | anyone | Closes an unfunded order whose quote expired |

Every transition emits an Anchor event (`OrderCreated`, `OrderFunded`, `OrderReleased`, …) for indexers.

## Money flow and liquidity

The NPR leg settles through local rails into Payoo's local account. The USDC leg is pre-funded from the treasury float, so the supplier is paid in minutes rather than waiting for NPR to clear. Refunds return USDC to the treasury, and the buyer is refunded in NPR through the original rail. Fee revenue is collected in NPR, and the on-chain `fee_usdc` records it for transparent receipts.

## Security notes

- The vault authority is the order PDA, so no key can move escrowed funds outside the program's rules.
- Release destinations are pinned by `has_one`/`token::authority` constraints to the configured partner account or treasury.
- The FX guardrail prevents a compromised or buggy backend from pricing orders far from market.
- The per-order cap (`max_order_usdc`) and `paused` flag limit blast radius.
- In production, admin and treasury authority move to a Squads multisig, and the operator becomes a narrowly scoped hot key.
- In the demo, embedded-wallet secrets live in the app DB. Production would use an MPC/embedded wallet provider (Privy, Turnkey, Web3Auth).
