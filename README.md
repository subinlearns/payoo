# Payoo

**Pay Chinese suppliers from Nepal in minutes, with a transparent rate and escrow protection. Solana is the invisible settlement layer.**

Nepali importers have no direct NPR → CNY payment rail. Cards and PayPal are blocked or capped, bank wires take 3–7 days and lose 4–5% to fees and FX spread, and informal hundi agents offer no receipts or protection. Payoo lets an importer pay in NPR through local rails (eSewa, Khalti, connectIPS, Fonepay QR, bank transfer). It locks the equivalent USDC in a per-order escrow on Solana, then a licensed settlement partner pays the supplier in CNY via Alipay, WeChat Pay or bank transfer.

```
Importer ──NPR──▶ Payoo + local rail ──USDC──▶ Escrow PDA (Solana) ──USDC──▶ Settlement partner ──CNY──▶ Supplier
                                         ▲ quote checked against on-chain FX feed
```

Built for the **Solana Crypto World Fair**.

---

## What's in this repo

| Path | What it is |
|---|---|
| [`programs/payoo-escrow`](programs/payoo-escrow) | Anchor 0.31 program: per-order USDC escrow, FX-rate guardrail, delivery confirmation, disputes, refunds, settlement proofs |
| [`tests/payoo-escrow.ts`](tests/payoo-escrow.ts) | 34 on-chain integration tests against a local validator (happy paths + every error branch) |
| [`target/idl/payoo_escrow.json`](target/idl/payoo_escrow.json) | IDL generated from the program (also used by the app) |
| [`app/`](app) | Next.js 16 product: importer app, supplier portal, settlement-partner console, admin console, on-chain ledger, backend API |
| [`app/scripts/devnet-setup.mts`](app/scripts/devnet-setup.mts) | Creates test USDC, treasury float and partner accounts, and initializes the program config on devnet/localnet |
| [`app/scripts/smoke.mjs`](app/scripts/smoke.mjs) | End-to-end API smoke test (direct, escrow + dispute, escrow + delivery) for any chain mode |
| [`docs/`](docs) | Architecture notes, demo script and hackathon submission answers |

## Quick start (two minutes, no wallet needed)

```bash
cd app
npm install
npm run dev          # http://localhost:3000
```

By default the app runs in **simulated chain mode**: an in-process replica of the `payoo_escrow` program with the same state machine, validations and error codes. The whole product works offline, with no SOL and no validator. Live FX rates come from a public market API (with Pyth support, see below) and fall back to fixed rates when offline.

Demo walkthrough:

1. **Pay a supplier** (`/pay`): enter ¥5,000 and choose *Escrow protection*. You get a locked 10-minute quote with fee, spread and a bank-wire comparison.
2. Pay with a mock NPR rail. USDC is locked in the order's escrow PDA, and the order page shows each transaction.
3. **Supplier portal** (`/supplier`): mark the order shipped.
4. Back on the order page: **Confirm delivery & release**. The buyer's embedded wallet co-signs and USDC moves to the settlement partner.
5. **Settlement partner** (`/partner`): pay out in CNY and confirm on-chain.
6. **Receipt** (`/receipt/:id`): a printable receipt with on-chain proof.
7. Try the other paths: a *Direct payment* (released immediately), or **Open dispute** → resolve it in **Platform admin** (`/admin`).

`/admin` → *Reset demo data* restores the seed at any time.

## Running against real Solana (localnet or devnet)

The app talks to the deployed program through the Anchor client (`app/src/lib/chain/anchor.ts`) when `PAYOO_CHAIN_MODE` is `localnet` or `devnet`. Only the operator key needs SOL: Payoo sponsors fees, so buyers and the partner just co-sign.

```bash
# 1. Build and deploy the program (needs Rust, Solana CLI, Anchor 0.31)
anchor build
anchor keys sync            # only if you regenerate the program keypair
anchor deploy --provider.cluster devnet

# 2. Create test USDC, the treasury float, the partner account, and initialize config
cd app
SOLANA_RPC_URL=https://api.devnet.solana.com npm run devnet:setup
#   optional: -- --payer ~/.config/solana/id.json  to use a funded keypair (else one is generated + airdropped)

# 3. Run the app against devnet
PAYOO_CHAIN_MODE=devnet SOLANA_RPC_URL=https://api.devnet.solana.com npm run dev
```

For localnet, start a validator with the program preloaded:

```bash
solana-test-validator --reset --bpf-program JDyePwDypafn8Yi9fZdzPYp7b4uztLKD9zZ3DfV4VxVy target/deploy/payoo_escrow.so
cd app && SOLANA_RPC_URL=http://127.0.0.1:8899 npm run devnet:setup
PAYOO_CHAIN_MODE=localnet SOLANA_RPC_URL=http://127.0.0.1:8899 npm run dev
node scripts/smoke.mjs http://localhost:3000     # full end-to-end check
```

In real-chain modes every transaction link opens Solana Explorer.

**Pyth:** Hermes now requires an API key. Set `PYTH_HERMES_URL` to your endpoint and the quote engine uses the Pyth `FX.USD/CNH` feed (`PYTH_USDCNH_FEED_ID`, preset). Without it, quotes use open.er-api.com. Either way the backend relays the reference rate on-chain (`push_rate`), and the program rejects any quote more than 1% away from it.

## Tests

```bash
# Program unit tests (FX rounding)
cargo test -p payoo-escrow

# On-chain integration suite: spins up a throwaway validator, 34 tests
npm install && npm run test:local       # or `anchor test`

# App: quote math (mirrors on-chain rounding)
cd app && npm test && npm run typecheck
```

## The escrow program

One `Order` PDA (`["order", order_id]`) and one USDC vault PDA (`["vault", order]`) per payment. The vault's authority is the order PDA itself, so funds can only move by the rules below.

```
            create_order + fund_order (operator, from treasury)
                              │
                           Funded ──────────────── refund (operator/admin) ──▶ Refunded
             direct mode │          │ escrow mode
                         │   mark_in_transit (operator)
                         │          ▼
                         │      InTransit ── open_dispute (buyer) ──▶ Disputed ── resolve_dispute (admin)
                         │          │ confirm_delivery (buyer)                       │ refund → Refunded
                         │          ▼                                                │ release ↓
                         │      Delivered                                            │
                         ▼          ▼    (or anyone, after deadline + dispute window)
             release_to_settlement ──▶ Released ── mark_settled (partner, payout ref) ──▶ Settled

   Created + quote expired ── cancel_expired (anyone) ──▶ Cancelled
```

Guardrails enforced on-chain:

- **FX check:** the quoted CNY/USD rate must be within `max_quote_deviation_bps` of a reference feed fresher than `max_rate_staleness_secs`.
- **Amount check:** escrowed USDC must equal `ceil(invoice_fen × 10¹⁰ / rate_e6)` (±1 base unit), so the supplier is never under-paid.
- **Role checks:** the operator, buyer, partner and admin can each sign only their own transitions. Release destinations are pinned to the partner's token account or the treasury.
- **Per-order cap, global pause, permissionless auto-release** after the delivery deadline plus the dispute window, and **vault rent reclaimed** on close.
- Supplier payout details stay off-chain; only their sha256 hash is stored.

More detail is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Regulation, honestly

Nepal Rastra Bank prohibits crypto transactions, and China restricts them. Payoo is designed so that **neither end user ever touches crypto**. Importers pay NPR through licensed rails, and suppliers receive CNY from a licensed payout partner. Stablecoin settlement happens only between institutions. This repo is a **proof of concept** (devnet, simulated rails and KYC). A pilot requires licensed partners and regulator engagement (NRB sandbox). Savings and credit are shown as simulated roadmap previews only.

## Roadmap

1. **Hackathon PoC** (this repo): escrow program, quotes, mock rails, consoles, devnet.
2. **Pilot:** licensed remittance and payout partner, a closed group of importers, NRB sandbox conversations.
3. **Product:** production KYC/AML, audited program, Squads multisig for admin and treasury, Android app.
4. **Financial services:** USD savings and working-capital credit based on on-chain payment history (with licensing).
5. **More corridors:** India, UAE, Thailand.
