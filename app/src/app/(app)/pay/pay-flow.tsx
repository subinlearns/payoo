"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Order, Quote, RailMethod, Rates, Supplier } from "@/lib/types";
import { PAYOUT_LABELS, RAIL_LABELS, fmtCny, fmtNpr, fmtNprWhole, fmtUsdc } from "@/lib/format";
import { postJson } from "@/components/action-button";

const RAILS: { id: RailMethod; hint: string }[] = [
  { id: "esewa", hint: "Wallet" },
  { id: "khalti", hint: "Wallet" },
  { id: "connectips", hint: "Bank account" },
  { id: "fonepay_qr", hint: "Scan with any bank app" },
  { id: "bank_transfer", hint: "NCHL / IPS" },
];

const PROCESS_STEPS = [
  "Confirming NPR with the payment gateway",
  "Refreshing the on-chain FX reference",
  "Locking USDC in your escrow account on Solana",
  "Handing off to the settlement partner",
];

function useCountdown(expiresAt?: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  if (!expiresAt) return { left: 0, label: "" };
  const left = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
  return { left, label: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` };
}

export function PayFlow({ suppliers, initialSupplier, rates }: { suppliers: Supplier[]; initialSupplier?: string; rates: Rates }) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState(
    suppliers.some((s) => s.id === initialSupplier) ? initialSupplier! : suppliers[0].id,
  );
  const [amount, setAmount] = useState("5000");
  const [invoiceRef, setInvoiceRef] = useState("PI-2026-1013");
  const [escrowMode, setEscrowMode] = useState(true);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [rail, setRail] = useState<RailMethod>("esewa");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const { left, label } = useCountdown(quote?.expiresAt);

  const supplier = suppliers.find((s) => s.id === supplierId)!;
  const estimate = useMemo(() => {
    const n = Number(amount);
    return n > 0 ? n * rates.cnyNpr * 1.014 : 0;
  }, [amount, rates]);

  async function getQuote(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setQuote(await postJson<Quote>("/api/quotes", { supplierId, invoiceCny: Number(amount), invoiceRef, escrowMode }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function pay() {
    if (!quote) return;
    setBusy(true);
    setError(null);
    setStep(0);
    const timer = setInterval(() => setStep((s) => Math.min(s + 1, PROCESS_STEPS.length - 2)), 700);
    try {
      const order = await postJson<Order>(`/api/quotes/${quote.id}/pay`, { method: rail });
      clearInterval(timer);
      setStep(PROCESS_STEPS.length);
      setTimeout(() => router.push(`/orders/${order.id}?new=1`), 600);
    } catch (err) {
      clearInterval(timer);
      setStep(-1);
      setBusy(false);
      setError((err as Error).message);
    }
  }

  if (step >= 0) {
    return (
      <div className="card mx-auto max-w-lg p-8">
        <div className="eyebrow">Processing payment</div>
        <div className="num mt-2 text-3xl font-extrabold">{quote && fmtCny(quote.invoiceCnyFen)}</div>
        <div className="text-sm text-muted">to {supplier.name}</div>
        <ol className="mt-8 space-y-4">
          {PROCESS_STEPS.map((s, i) => {
            const done = step > i || step === PROCESS_STEPS.length;
            const current = step === i;
            if (i === 3 && quote?.escrowMode) s = "Holding funds in escrow until you confirm delivery";
            return (
              <li key={s} className="flex items-center gap-3 text-sm">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                    done ? "bg-jade text-white" : current ? "bg-ink text-white" : "bg-line text-muted"
                  }`}
                >
                  {done ? "✓" : current ? <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-white border-t-transparent" /> : i + 1}
                </span>
                <span className={done || current ? "font-semibold" : "text-muted"}>{s}</span>
              </li>
            );
          })}
        </ol>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <form onSubmit={getQuote} className="card space-y-5 p-6">
        <div>
          <label className="label" htmlFor="supplier">
            Supplier
          </label>
          <select id="supplier" className="input" value={supplierId} onChange={(e) => (setSupplierId(e.target.value), setQuote(null))}>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.marketplace}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-muted">
            Paid via {PAYOUT_LABELS[supplier.payoutMethod]} to {supplier.payoutName} ({supplier.payoutAccount}){" "}
            {supplier.verified ? <span className="font-semibold text-jade">· verified</span> : <span className="font-semibold text-amber">· unverified</span>}
          </p>
        </div>
        <div>
          <label className="label" htmlFor="amount">
            Invoice amount
          </label>
          <div className="relative">
            <span className="absolute top-1/2 left-3.5 -translate-y-1/2 text-lg font-bold text-muted">¥</span>
            <input
              id="amount"
              className="input num pl-8 text-lg font-bold"
              inputMode="decimal"
              value={amount}
              onChange={(e) => (setAmount(e.target.value.replace(/[^\d.]/g, "")), setQuote(null))}
            />
          </div>
          <p className="num mt-1.5 text-xs text-muted">≈ {fmtNprWhole(estimate * 100)} all-in (estimate)</p>
        </div>
        <div>
          <label className="label" htmlFor="ref">
            Invoice / order reference
          </label>
          <input id="ref" className="input" value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} placeholder="Alibaba order no. or PI number" />
        </div>
        <fieldset>
          <legend className="label">Protection</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              { v: true, t: "Escrow protection", d: "Funds held on-chain until you confirm delivery. Dispute if something's wrong." },
              { v: false, t: "Direct payment", d: "Supplier is paid right away. Best for trusted, repeat suppliers." },
            ].map((o) => (
              <button
                type="button"
                key={o.t}
                onClick={() => (setEscrowMode(o.v), setQuote(null))}
                className={`rounded-xl border p-3 text-left transition ${escrowMode === o.v ? "border-ink bg-ink/[0.03] ring-2 ring-ink/10" : "border-line hover:border-ink/30"}`}
              >
                <div className="text-sm font-bold">{o.t}</div>
                <div className="mt-0.5 text-xs text-muted">{o.d}</div>
              </button>
            ))}
          </div>
        </fieldset>
        {error && !quote && <p className="text-sm text-crimson">{error}</p>}
        <button className="btn-primary w-full py-3" disabled={busy || !(Number(amount) > 0)}>
          {busy ? "Fetching live rate…" : quote ? "Refresh quote" : "Get locked quote"}
        </button>
      </form>

      <div>
        {quote ? (
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between bg-ink px-6 py-4 text-white">
              <div>
                <div className="text-[11px] font-bold tracking-widest text-white/60 uppercase">Locked quote</div>
                <div className="text-sm text-white/80">Rate source: {quote.rates.source}</div>
              </div>
              <div className={`num rounded-full px-3 py-1 text-sm font-bold ${left < 60 ? "bg-crimson" : "bg-white/10"}`}>
                {left > 0 ? `⏱ ${label}` : "Expired"}
              </div>
            </div>
            <div className="p-6">
              <div className="flex items-end justify-between">
                <div>
                  <div className="eyebrow">You pay</div>
                  <div className="num text-3xl font-extrabold tracking-tight">{fmtNpr(quote.totalNprPaisa)}</div>
                </div>
                <div className="text-right">
                  <div className="eyebrow">Supplier gets</div>
                  <div className="num text-xl font-extrabold">{fmtCny(quote.invoiceCnyFen)}</div>
                </div>
              </div>

              <dl className="num mt-6 space-y-2 border-t border-line pt-4 text-sm">
                <Row k="Invoice converted to USDC" v={`${fmtUsdc(quote.amountUsdc)} @ ${(quote.quoteRateE6 / 1e6).toFixed(4)} CNY/USD`} />
                <Row k={`NPR for principal @ ${quote.buyerUsdNpr.toFixed(3)} NPR/USD`} v={fmtNpr(quote.principalNprPaisa)} />
                <Row k="   incl. FX spread (0.40%)" v={fmtNpr(quote.spreadNprPaisa)} muted />
                <Row k={`Payoo fee (${(quote.feeBps / 100).toFixed(2)}%)`} v={fmtNpr(quote.feeNprPaisa)} />
                <Row k="Solana network fee" v="Covered by Payoo" muted />
                <Row k="Effective rate" v={`¥1 = NPR ${(quote.effectiveCnyNpr).toFixed(3)}`} strong />
              </dl>

              <div className="mt-5 rounded-xl bg-jade-soft p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-bold text-jade">You save vs. a bank wire</span>
                  <span className="num font-extrabold text-jade">{fmtNprWhole(quote.savingsNprPaisa)}</span>
                </div>
                <div className="num mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-ink/70">
                  <span>Bank TT total</span>
                  <span className="text-right">{fmtNprWhole(quote.bankWire.totalNprPaisa)}</span>
                  <span>Swift + correspondent fees</span>
                  <span className="text-right">{fmtNprWhole(quote.bankWire.localFeeNprPaisa + quote.bankWire.correspondentFeeNprPaisa)}</span>
                  <span>Bank FX margin (~2.5%)</span>
                  <span className="text-right">{fmtNprWhole(quote.bankWire.fxMarginNprPaisa)}</span>
                  <span>Bank settlement time</span>
                  <span className="text-right">{quote.bankWire.days}</span>
                </div>
              </div>

              <div className="mt-6">
                <div className="label">Pay with</div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {RAILS.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setRail(r.id)}
                      className={`rounded-xl border px-3 py-2.5 text-left transition ${rail === r.id ? "border-ink ring-2 ring-ink/10" : "border-line hover:border-ink/30"}`}
                    >
                      <div className="text-sm font-bold">{RAIL_LABELS[r.id]}</div>
                      <div className="text-[11px] text-muted">{r.hint}</div>
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-muted">Demo gateway: the NPR payment is simulated and confirms instantly.</p>
              </div>

              {error && <p className="mt-4 text-sm text-crimson">{error}</p>}
              <button onClick={pay} disabled={busy || left === 0} className="btn-accent mt-5 w-full py-3.5 text-base">
                Pay {fmtNprWhole(quote.totalNprPaisa)} with {RAIL_LABELS[rail]}
              </button>
              <p className="mt-3 text-center text-xs text-muted">
                {quote.escrowMode
                  ? "Funds stay in an on-chain escrow until you confirm delivery."
                  : "The settlement partner pays the supplier as soon as the escrow is funded."}
              </p>
            </div>
          </div>
        ) : (
          <div className="card flex h-full min-h-80 flex-col justify-center p-8">
            <div className="eyebrow">Live mid-market rate</div>
            <div className="num mt-2 text-4xl font-extrabold">¥1 = NPR {rates.cnyNpr.toFixed(3)}</div>
            <p className="mt-2 max-w-sm text-sm text-muted">
              Quotes are priced off the live rate plus a 0.40% spread and a 1% fee, locked for 10 minutes, and checked
              on-chain against the program&apos;s FX reference feed.
            </p>
            <Link href="/suppliers" className="mt-6 text-sm font-semibold text-crimson hover:underline">
              Paying someone new? Add a supplier →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ k, v, muted, strong }: { k: string; v: string; muted?: boolean; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${muted ? "text-muted" : ""} ${strong ? "border-t border-line pt-2 font-bold" : ""}`}>
      <dt className="whitespace-pre">{k}</dt>
      <dd className="text-right">{v}</dd>
    </div>
  );
}
