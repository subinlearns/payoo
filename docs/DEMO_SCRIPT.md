# Video scripts

## 1. Demo video (2:30–3:00 screen recording)

**Setup before recording:** `cd app && npm run dev`, open `/admin` → *Reset demo data*. Use a 1440×900 browser window. If you have devnet set up, run with `PAYOO_CHAIN_MODE=devnet` so the explorer links are real.

| Time | Screen | Say |
|---|---|---|
| 0:00 | Landing page hero | "This is Payoo. It lets a small importer in Nepal pay a supplier in China in minutes, with Solana as the settlement layer underneath." |
| 0:12 | Scroll to the comparison table | "Today the options are a bank wire, which takes three to seven days and costs four to five percent, or a hundi agent with no receipt and no protection." |
| 0:25 | Click **Open app** → dashboard | "Meet Sita. She imports handicraft supplies for her business in Kathmandu. She's already KYC-verified and has an embedded Solana wallet she never has to think about." |
| 0:38 | **Pay a supplier** → choose Yiwu Sunrise, ¥5,000, **Escrow protection** → *Get locked quote* | "She enters the invoice in yuan. The quote uses the live rate and is locked for ten minutes. The fee, the spread and the total in rupees are all visible, and she saves nearly five thousand rupees compared with a bank wire." |
| 0:58 | Pick **eSewa** → Pay | "She pays in rupees with eSewa. The moment that lands, our program locks the equivalent USDC in an escrow account created just for this order." |
| 1:10 | Order page: progress bar, timeline, transactions, on-chain escrow panel | "Here's the public receipt: create and fund in one transaction, the order's PDA and its vault holding the USDC. The program also checked the quoted rate against an on-chain FX reference before accepting it." |
| 1:28 | **Supplier portal** → Mark shipped | "On the other side, the supplier can see the money is already locked before shipping. They mark it shipped with a tracking number, and that's recorded on-chain too." |
| 1:42 | Back to the order → **Confirm delivery & release** | "When the goods arrive, Sita confirms. Her wallet co-signs, Payoo pays the fee, and the escrow releases the USDC to our licensed settlement partner." |
| 1:55 | **Settlement partner** → *Pay via Alipay & confirm* | "The partner pays the supplier in yuan through Alipay and writes the payout reference on-chain. The supplier never touches crypto, and neither does Sita." |
| 2:08 | Order → **View receipt** | "Sita gets a receipt with the rate, fees, payout reference and every Solana transaction." |
| 2:15 | (Optional) New escrow order → **Open dispute** → **Admin** → *Refund buyer* | "If something goes wrong, she opens a dispute, which freezes the funds, and our team can refund her or release the payment." |
| 2:30 | **Admin** treasury, FX feed, program config → **Ledger** | "Behind it all is an Anchor program with an enforced state machine, per-order caps, a pause switch and 34 passing on-chain tests." |
| 2:45 | Landing page | "Payoo: NPR in, CNY out, with Solana in the middle where nobody has to see it." |

## 2. Pitch video (about 2:00, face on camera plus slides)

**Hook (0:00–0:15)**
"Nepal buys billions of dollars of goods from China every year. But if you're a small importer in Kathmandu, paying a ¥10,000 invoice on Alibaba takes up to a week and costs you ten thousand rupees more than it should, if your bank lets you do it at all."

**Problem (0:15–0:40)**
"There's no direct rupee-to-yuan rail. Cards and PayPal are blocked or capped. Bank wires stack fees and hide the exchange rate. So many traders fall back on hundi, informal agents with no receipts, no protection and plenty of scams."

**Solution (0:40–1:10)**
"Payoo fixes this. You enter the invoice in yuan and get a locked quote with every fee visible. You pay in rupees with eSewa, Khalti or your bank. We lock the equivalent USDC in an escrow on Solana, and a licensed partner pays your supplier in yuan via Alipay, WeChat or bank, in minutes. If you choose protection, the money only moves when you confirm delivery."

**Why Solana (1:10–1:30)**
"Solana makes per-order escrow cheap enough for a two-thousand-yuan invoice: sub-second finality and fees we can cover for the user. Our Anchor program enforces the escrow rules, checks every quote against a Pyth FX reference, and gives every payment a public receipt."

**Regulation and business model (1:30–1:45)**
"Users never hold crypto. Rupees go through licensed Nepali rails and yuan through a licensed payout partner. We earn a 1% fee plus a small FX spread, about a quarter of what a bank wire costs."

**Close (1:45–2:00)**
"Next is a pilot with a licensed remittance partner and NRB sandbox conversations. Then working-capital credit built on on-chain payment history, and more corridors: India, UAE, Thailand. Payoo lets every small importer in Nepal pay the world like a big one."
