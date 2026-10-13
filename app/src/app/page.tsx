import Link from "next/link";
import { getRates } from "@/lib/fx";
import { computeQuote } from "@/lib/quote";
import { fmtCny, fmtNprWhole } from "@/lib/format";
import { Logo } from "@/components/ui";

export const dynamic = "force-dynamic";

const FLOW = [
  { n: "01", t: "Lock a quote", d: "Enter the invoice in yuan. See the NPR total, our 1% fee and the rate, locked for 10 minutes." },
  { n: "02", t: "Pay in NPR", d: "eSewa, Khalti, connectIPS, Fonepay QR or bank transfer. The rails you already use." },
  { n: "03", t: "Escrow on Solana", d: "USDC is locked in a per-order program account. Public receipt in about a second." },
  { n: "04", t: "Supplier paid in CNY", d: "A licensed partner pays out via Alipay, WeChat Pay or bank, and confirms on-chain." },
];

export default async function Landing() {
  const rates = await getRates();
  const q = computeQuote({ invoiceCnyFen: 1_000_000, usdCny: rates.usdCny, usdNpr: rates.usdNpr });

  return (
    <div className="overflow-x-hidden">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Logo />
        <nav className="flex items-center gap-2 text-sm font-semibold sm:gap-5">
          <a href="#how" className="hidden text-ink/70 hover:text-ink sm:inline">How it works</a>
          <a href="#compare" className="hidden text-ink/70 hover:text-ink sm:inline">Pricing</a>
          <Link href="/admin" className="hidden text-ink/70 hover:text-ink sm:inline">Operations</Link>
          <Link href="/dashboard" className="btn-primary">Open app</Link>
        </nav>
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-10 pb-20 sm:px-6 lg:grid-cols-[1.15fr_1fr] lg:pt-16">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1 text-xs font-bold">
            <span className="h-2 w-2 rounded-full sol-gradient" /> Built on Solana · Nepal → China corridor
          </span>
          <h1 className="mt-6 text-4xl leading-[1.05] font-extrabold tracking-tight sm:text-6xl">
            Pay suppliers in China <span className="text-crimson">in minutes</span>, not weeks.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-ink/70">
            Payoo lets Nepali importers pay Alibaba and 1688 suppliers in NPR, with a transparent rate, escrow
            protection and a public receipt for every payment. Solana is the invisible settlement layer.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/pay" className="btn-accent px-6 py-3 text-base">Make a payment</Link>
            <Link href="/onboarding" className="btn-ghost px-6 py-3 text-base">Open an account</Link>
          </div>
          <div className="mt-10 grid max-w-lg grid-cols-3 gap-6">
            {[
              ["~1 s", "on-chain settlement"],
              ["1.4%", "all-in cost"],
              ["0", "crypto for users to handle"],
            ].map(([a, b]) => (
              <div key={b}>
                <div className="num text-2xl font-extrabold">{a}</div>
                <div className="text-xs text-muted">{b}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative">
          <div className="absolute -inset-6 -z-10 rounded-[2.5rem] bg-gradient-to-br from-crimson/15 via-transparent to-sol-b/20 blur-2xl" />
          <div className="card overflow-hidden shadow-xl shadow-ink/5">
            <div className="flex items-center justify-between bg-ink px-6 py-4 text-white">
              <span className="text-sm font-bold">Live quote</span>
              <span className="num rounded-full bg-white/10 px-2.5 py-0.5 text-xs">¥1 = NPR {rates.cnyNpr.toFixed(3)}</span>
            </div>
            <div className="p-6">
              <div className="eyebrow">Supplier receives</div>
              <div className="num text-4xl font-extrabold">{fmtCny(q.invoiceCnyFen)}</div>
              <div className="mt-6 grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-jade-soft p-4">
                  <div className="text-xs font-bold text-jade">Payoo</div>
                  <div className="num mt-1 text-xl font-extrabold">{fmtNprWhole(q.totalNprPaisa)}</div>
                  <div className="text-xs text-ink/60">minutes · escrow protected</div>
                </div>
                <div className="rounded-2xl bg-paper p-4">
                  <div className="text-xs font-bold text-muted">Bank wire (TT)</div>
                  <div className="num mt-1 text-xl font-extrabold text-ink/60">{fmtNprWhole(q.bankWire.totalNprPaisa)}</div>
                  <div className="text-xs text-ink/50">{q.bankWire.days}</div>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between rounded-xl border border-dashed border-jade/40 px-4 py-3 text-sm">
                <span className="font-semibold">You keep</span>
                <span className="num font-extrabold text-jade">{fmtNprWhole(q.savingsNprPaisa)}</span>
              </div>
              <p className="mt-3 text-[11px] text-muted">Rate source: {rates.source}. Bank estimate: NPR 2,500 Swift fee + $30 correspondent + 2.5% FX margin.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-line bg-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:px-6 md:grid-cols-3">
          {[
            ["No direct rail", "There's no NPR → CNY channel. Cards and PayPal are blocked or capped for most Nepali buyers."],
            ["Slow & opaque wires", "Outward TTs take 3–7 days, stack fees, hide the FX spread and need paperwork on every transfer."],
            ["Risky middlemen", "Hundi and informal agents mean no receipts, no protection and frequent scams for first-time importers."],
          ].map(([t, d]) => (
            <div key={t}>
              <div className="text-xs font-bold tracking-widest text-crimson uppercase">The problem</div>
              <div className="mt-2 text-xl font-extrabold">{t}</div>
              <p className="mt-2 text-sm text-ink/70">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="how" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="eyebrow">How it works</div>
        <h2 className="mt-2 max-w-2xl text-3xl font-extrabold tracking-tight sm:text-4xl">NPR in. CNY out. Solana in the middle, where nobody has to see it.</h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FLOW.map((s) => (
            <div key={s.n} className="card p-6">
              <div className="num text-sm font-extrabold text-crimson">{s.n}</div>
              <div className="mt-3 text-lg font-extrabold">{s.t}</div>
              <p className="mt-2 text-sm text-ink/70">{s.d}</p>
            </div>
          ))}
        </div>
        <div className="card mt-6 overflow-x-auto p-6">
          <div className="flex min-w-[640px] items-center justify-between gap-2 text-center text-xs font-bold">
            {["Importer (NPR)", "Payoo + local rail", "Escrow PDA · USDC", "Settlement partner", "Supplier (CNY)"].map((x, i, arr) => (
              <div key={x} className="flex flex-1 items-center gap-2">
                <div className={`flex-1 rounded-xl px-3 py-3 ${i === 2 ? "sol-gradient text-ink" : "bg-paper"}`}>{x}</div>
                {i < arr.length - 1 && <span className="text-muted">→</span>}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="compare" className="bg-ink py-20 text-white">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Why importers switch</h2>
          <div className="mt-10 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="text-xs tracking-wider text-white/50 uppercase">
                  <th className="py-3 pr-4"></th>
                  <th className="px-4 py-3 text-sol-b">Payoo</th>
                  <th className="px-4 py-3">Bank wire (TT)</th>
                  <th className="px-4 py-3">Hundi / agent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {[
                  ["Time to supplier", "Minutes", "3–7 days", "1–3 days"],
                  ["All-in cost on ¥10,000", "~1.4%", "~4–5%", "Unknown spread"],
                  ["Rate shown upfront", "Yes, locked 10 min", "Rarely", "No"],
                  ["Buyer protection", "On-chain escrow + disputes", "None", "None"],
                  ["Proof of payment", "Public Solana receipt", "SWIFT copy, days later", "None"],
                  ["Paperwork", "One-time KYC", "Every transfer", "None (and no recourse)"],
                ].map(([k, a, b, c]) => (
                  <tr key={k}>
                    <td className="py-3.5 pr-4 text-white/60">{k}</td>
                    <td className="px-4 py-3.5 font-bold">{a}</td>
                    <td className="px-4 py-3.5 text-white/70">{b}</td>
                    <td className="px-4 py-3.5 text-white/70">{c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 px-4 py-20 sm:px-6 md:grid-cols-2">
        <div className="card p-8">
          <div className="eyebrow">Why Solana</div>
          <h3 className="mt-2 text-2xl font-extrabold">Settlement that feels instant and costs fractions of a cent</h3>
          <ul className="mt-5 space-y-3 text-sm text-ink/80">
            <li><b>~400 ms blocks, sub-cent fees.</b> Payoo sponsors every user transaction.</li>
            <li><b>USDC as an SPL token.</b> A stable dollar removes FX risk between payment and payout.</li>
            <li><b>Anchor escrow program.</b> One PDA vault per order with an enforced state machine, so funds can only move to the settlement partner or back to the treasury.</li>
            <li><b>On-chain FX guardrail.</b> Every quote is checked against a fresh reference rate (Pyth USD/CNH) within 1%.</li>
          </ul>
        </div>
        <div className="card p-8">
          <div className="eyebrow">Built for regulation, not around it</div>
          <h3 className="mt-2 text-2xl font-extrabold">Users never touch crypto</h3>
          <ul className="mt-5 space-y-3 text-sm text-ink/80">
            <li><b>Nepali buyers</b> pay NPR through licensed local rails and never hold or trade crypto.</li>
            <li><b>Chinese suppliers</b> receive CNY from a licensed payout partner. No crypto ever reaches them.</li>
            <li><b>Stablecoin settlement</b> happens between regulated institutions, the model we&apos;re taking to NRB&apos;s sandbox conversations.</li>
            <li><b>Proof of concept today:</b> devnet + simulated rails. Pilot only with licensed partners.</li>
          </ul>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <div className="card flex flex-col items-start justify-between gap-6 bg-crimson p-10 text-white sm:flex-row sm:items-center">
          <div>
            <h2 className="text-3xl font-extrabold tracking-tight">Try the full flow in two minutes</h2>
            <p className="mt-2 text-white/80">Quote → pay NPR → escrow on Solana → CNY payout → receipt.</p>
          </div>
          <Link href="/pay" className="btn bg-white px-6 py-3 text-base text-crimson hover:bg-white/90">Start a payment</Link>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-xs text-muted sm:px-6">
          <Logo />
          <span>Proof of concept for the Solana Crypto World Fair. Not a licensed financial service.</span>
        </div>
      </footer>
    </div>
  );
}
