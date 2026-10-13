# Payoo: Solana Crypto World Fair submission

> Copy-paste answers for the submission form. Items marked **TODO** need a link only you can create.

## Basics

| Field | Answer |
|---|---|
| **Project Name** | Payoo |
| **Link to Your Submission** | **TODO**: public URL of the deployed app (e.g. Vercel), or the GitHub repo if not deployed |
| **Project GitHub link** | **TODO**: `https://github.com/<you>/payoo` (see "Publishing the repo" below) |
| **Pitch deck / video** | Deck: https://claude.ai/artifact/DuGDt3W3zBD3GQcTAo2Mxu (share it publicly from its Share menu first, or export to PDF/PPTX). **TODO**: Loom pitch link |

### Project Description (short, ~50 words)

Payoo lets small Nepali importers pay Chinese suppliers in minutes instead of days. Buyers pay in NPR through local wallets and banks. Payoo locks USDC in a per-order escrow program on Solana, and a licensed partner pays the supplier in CNY. Every payment comes with a transparent rate, buyer protection and a public on-chain receipt.

### Project Description (long)

Nepal imports billions of dollars of goods from China every year, but a small importer buying from Alibaba or 1688 has no good way to pay. There is no direct NPR → CNY rail, cards and PayPal are blocked or capped, bank telegraphic transfers take 3–7 days and cost 4–5% in stacked fees and hidden FX spread, and the informal hundi market offers no receipts and frequent scams.

Payoo is a cross-border payment bridge with Solana as the invisible settlement layer. The importer enters the invoice in yuan and gets a locked 10-minute quote showing the exact NPR total, a 1% fee and the rate, next to what a bank wire would cost. They pay in NPR with eSewa, Khalti, connectIPS, Fonepay QR or a bank transfer. Payoo's treasury then locks the equivalent USDC in a per-order escrow account (a PDA) controlled by our Anchor program. Before accepting the order, the program checks that the quoted rate is within 1% of a fresh on-chain FX reference (Pyth USD/CNH) and that the escrowed USDC covers the invoice exactly. Direct payments release immediately to a licensed settlement partner, who pays the supplier in CNY via Alipay, WeChat Pay or bank transfer and records the payout reference on-chain. Escrow-protected payments wait for the buyer to confirm delivery, with a dispute and refund flow and a permissionless auto-release after the delivery deadline.

Neither end user ever touches crypto. The buyer has an embedded wallet with no seed phrase, and Payoo sponsors all fees. The supplier only ever receives CNY. The repo includes the Anchor program with 34 passing on-chain integration tests, a full Next.js product (importer app, supplier portal, settlement-partner console, admin/treasury console, on-chain ledger and receipts), and a devnet setup script. It runs end-to-end against a real validator.

## Project details

### What are you building, and who is it for?

Payoo is a payment bridge that lets Nepali importers pay suppliers in China in NPR, while the supplier receives CNY within minutes. It's for the thousands of small and medium importers, traders and online sellers in Nepal who buy from Alibaba, 1688, AliExpress and Taobao suppliers. Today they choose between slow, expensive bank wires and risky informal agents.

The product has four sides:

- **Importer app:** onboarding with KYC and an embedded wallet, saved suppliers, locked quotes compared against a bank wire, local NPR payment rails, order tracking, delivery confirmation and disputes, and receipts.
- **Supplier portal:** suppliers see that funds are already locked in escrow before they ship, and mark shipments.
- **Settlement-partner console:** a licensed payout partner receives USDC, pays CNY via Alipay, WeChat Pay or bank transfer, and confirms on-chain.
- **Admin console:** treasury float, FX reference feed, program config and dispute resolution.

### Why did you decide to build this, and why build it now?

We live this problem. Nepal is a major importer of Chinese goods, yet a shop owner in Kathmandu who wants to pay a ¥10,000 invoice waits up to a week and loses roughly NPR 10,000 more than necessary to fees and spread, or trusts a hundi agent with no receipt and no recourse. First-time importers are regularly scammed because there is no escrow or proof of payment.

Three things make now the right time:

1. **Stablecoins are mature.** USDC on Solana is liquid, regulated and widely used for B2B settlement between licensed institutions.
2. **Solana is cheap and fast enough.** Sub-second finality and fractions-of-a-cent fees make per-order escrow economical even for a ¥2,000 invoice.
3. **Local rails are ready.** Wallets and QR payments (eSewa, Khalti, Fonepay, connectIPS) are now ubiquitous in Nepal, so the NPR leg can be collected instantly.

Regulators are also opening sandbox programmes for new payment models. A design where users never hold crypto and institutions settle in stablecoins is one we can bring into those conversations.

### What technologies are you using or integrating with to build your product?

- **On-chain:** Rust + Anchor 0.31 (`payoo_escrow` program), SPL Token (USDC, 6 decimals), PDAs for per-order escrow vaults, Anchor events for indexing
- **Oracle:** Pyth price feeds (`FX.USD/CNH` via Hermes), relayed into an on-chain reference account, with a public FX API as fallback
- **Client:** `@coral-xyz/anchor` TypeScript client from the generated IDL, `@solana/web3.js`, `@solana/spl-token`
- **App and backend:** Next.js 16 (App Router, React 19, route handlers), TypeScript, Tailwind CSS 4
- **Wallets:** embedded, sponsored-fee wallets for buyers (production: an MPC/embedded wallet provider such as Privy or Turnkey); Squads multisig for admin and treasury on the roadmap
- **Rails (simulated in the demo):** eSewa, Khalti, connectIPS, Fonepay QR and bank transfer for NPR in; Alipay, WeChat Pay and CNAPS bank transfer for CNY out through a licensed partner
- **Testing:** Mocha/Chai on-chain integration suite against `solana-test-validator`, Rust unit tests, Node test runner, and an end-to-end API smoke test

### Which chains does your product use?

Solana (devnet for the proof of concept, mainnet-beta for production).

### How does your product use these chains?

Solana is the settlement and trust layer between the NPR side and the CNY side:

1. **Per-order escrow:** each payment creates an `Order` PDA and a USDC vault PDA whose only authority is the order itself. Funds can only go to the configured settlement partner's account or back to the treasury, following an enforced state machine: Funded → (InTransit → Delivered) → Released → Settled, or Disputed → Refunded/Released.
2. **On-chain FX guardrail:** a `RateFeed` account holds USD/CNY and USD/NPR reference rates relayed from Pyth. `create_order` rejects quotes that are stale, more than 1% off the reference, or whose USDC amount doesn't exactly cover the invoice.
3. **Buyer protection:** in escrow mode the buyer's embedded wallet signs `confirm_delivery` or `open_dispute`. Funds auto-release, permissionlessly, after the delivery deadline plus a dispute window if the buyer goes silent. Admin dispute resolution refunds or releases the funds.
4. **Proof of payment:** every step (create, fund, ship, deliver, release, and settle with a hashed payout reference) is a public transaction. It becomes the buyer's receipt and builds an on-chain payment history that can later power working-capital credit.
5. **Stable value:** USDC removes FX risk between payment and payout, and Solana's fees (sponsored by Payoo) make per-order escrow viable for small invoices.

### Is your project a mobile-focused dApp?

Mobile-first, but not a native mobile dApp yet. The app is a responsive web app designed for phone use, since most Nepali importers run their business from a phone and pay with mobile wallets like eSewa and Khalti. Users never manage keys: an embedded wallet is created at sign-up and fees are sponsored. A native Android app (Kotlin + Compose, Solana Mobile Wallet Adapter) is on the roadmap.

### Where is your team primarily based?

Nepal (**TODO**: add your city, e.g. Kathmandu)

## Media and code

| Item | What to submit |
|---|---|
| **Project logo or graphic** | `docs/brand/payoo-logo.png` (1200×400 banner) or `docs/brand/payoo-mark.png` (512×512 square). SVGs are alongside. |
| **GitHub link** | **TODO**: the public repo (make sure it's public, or judges can't open it) |
| **Demo video** | **TODO**: record with the script in [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md) (2–3 min screen recording), upload to YouTube (unlisted) or Loom, and tick "Show demo video on the public project page" |
| **Pitch video** | **TODO**: record with the pitch script in [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md) (about 2 min, face on camera plus the deck) |

### Access instructions for judges

> Run locally in 2 minutes: `cd app && npm install && npm run dev` → http://localhost:3000. No wallet or SOL needed (simulated chain mode). To run against Solana devnet/localnet, see the README section "Running against real Solana". On-chain tests: `npm install && npm run test:local` (needs the Solana CLI).

## Publishing the repo (checklist)

```bash
cd ~/Desktop/payoo
git init && git add . && git commit -m "Payoo: Nepal → China payments on Solana"
gh repo create payoo --public --source . --push
```

`.gitignore` already excludes `node_modules`, build output, the program keypair (`target/deploy/*-keypair.json`), and `app/.data` (which holds demo wallet secrets and devnet keys).
