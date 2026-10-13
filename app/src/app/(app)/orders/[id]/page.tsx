import Link from "next/link";
import { notFound } from "next/navigation";
import { readDb } from "@/lib/db";
import { getChain, txUrl } from "@/lib/chain";
import { PAYOUT_LABELS, RAIL_LABELS, fmtCny, fmtDate, fmtNpr, fmtRelative, fmtUsdc } from "@/lib/format";
import type { Order } from "@/lib/types";
import { ActionButton } from "@/components/action-button";
import { Addr, StatusBadge, TxLink } from "@/components/ui";
import { DisputeForm } from "./dispute-form";

export const dynamic = "force-dynamic";

const DIRECT_STEPS = [
  { key: "NPR_RECEIVED", label: "NPR received" },
  { key: "FUNDED", label: "USDC in escrow" },
  { key: "RELEASED", label: "Sent to partner" },
  { key: "SETTLED", label: "CNY paid" },
];
const ESCROW_STEPS = [
  { key: "NPR_RECEIVED", label: "NPR received" },
  { key: "FUNDED", label: "USDC in escrow" },
  { key: "IN_TRANSIT", label: "Shipped" },
  { key: "DELIVERED", label: "Delivered" },
  { key: "RELEASED", label: "Sent to partner" },
  { key: "SETTLED", label: "CNY paid" },
];

function Progress({ order }: { order: Order }) {
  const steps = order.escrowMode ? ESCROW_STEPS : DIRECT_STEPS;
  const done = new Set(order.events.map((e) => e.type));
  const halted = order.status === "DISPUTED" || order.status === "REFUNDED";
  return (
    <ol className="grid grid-cols-2 gap-3 sm:flex sm:gap-0">
      {steps.map((s, i) => {
        const ok = done.has(s.key);
        const next = !ok && (i === 0 || done.has(steps[i - 1].key)) && !halted;
        return (
          <li key={s.key} className="flex flex-1 items-center gap-2 sm:flex-col sm:items-start sm:gap-2">
            <div className="flex w-full items-center">
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  ok ? "bg-jade text-white" : next ? "bg-ink text-white" : "bg-line text-muted"
                }`}
              >
                {ok ? "✓" : i + 1}
              </span>
              {i < steps.length - 1 && <span className={`mx-2 hidden h-0.5 flex-1 sm:block ${ok ? "bg-jade" : "bg-line"}`} />}
            </div>
            <span className={`text-xs font-semibold ${ok || next ? "" : "text-muted"}`}>{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ new?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const db = readDb();
  const order = db.orders.find((o) => o.id === id);
  if (!order) notFound();
  const supplier = db.suppliers.find((s) => s.id === order.supplierId)!;
  const chain = getChain();
  const onchain = order.seeded ? null : await chain.fetchOrder(order.id).catch(() => null);
  const txs = db.txs.filter((t) => t.orderId === order.id);
  const simulated = chain.mode === "simulated" || !!order.seeded;

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/dashboard" className="text-sm font-semibold text-muted hover:text-ink">
        ← Dashboard
      </Link>

      {sp.new && (
        <div className="mt-4 rounded-2xl border border-jade/30 bg-jade-soft px-5 py-4 text-sm">
          <span className="font-bold text-jade">Payment received.</span>{" "}
          {order.escrowMode
            ? "Your USDC is locked in escrow on Solana. It will be released when you confirm delivery."
            : "Your USDC is on its way to the settlement partner, who pays the supplier in CNY."}
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="eyebrow">
            {order.escrowMode ? "Escrow-protected payment" : "Direct payment"} · {order.invoiceRef}
          </div>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight">
            <span className="num">{fmtCny(order.invoiceCnyFen)}</span> <span className="text-muted">to</span> {supplier.name}
          </h1>
          <div className="mt-2 flex items-center gap-3">
            <StatusBadge status={order.status} />
            <span className="text-xs text-muted">Updated {fmtRelative(order.updatedAt)}</span>
          </div>
        </div>
        <Link href={`/receipt/${order.id}`} className="btn-ghost">
          View receipt
        </Link>
      </div>

      <div className="card mt-6 p-6">
        <Progress order={order} />
      </div>

      {/* Buyer actions */}
      {order.escrowMode && (order.status === "FUNDED" || order.status === "IN_TRANSIT") && !order.seeded && (
        <div className="card mt-6 flex flex-wrap items-center justify-between gap-4 border-ink/20 p-6">
          <div className="max-w-lg">
            <div className="font-bold">{order.status === "IN_TRANSIT" ? "Has your shipment arrived?" : "Waiting for the supplier to ship"}</div>
            <p className="mt-1 text-sm text-muted">
              {order.tracking
                ? `${order.tracking.carrier} · ${order.tracking.number}. If you don't respond, funds auto-release after ${fmtDate(order.tracking.deliveryDeadline)} plus a 3-day dispute window.`
                : "Funds stay locked in the escrow vault. Confirm once the goods arrive, or open a dispute if something is wrong."}
            </p>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            <ActionButton orderId={order.id} body={{ actor: "buyer", action: "confirm_delivery" }} className="btn-accent" confirm="Confirm the goods arrived as ordered? This releases the funds to the supplier.">
              Confirm delivery & release
            </ActionButton>
            <DisputeForm orderId={order.id} />
          </div>
        </div>
      )}
      {order.status === "DISPUTED" && order.dispute && (
        <div className="card mt-6 border-crimson/30 bg-crimson-soft/40 p-6 text-sm">
          <div className="font-bold text-crimson">Dispute under review: {order.dispute.reason}</div>
          {order.dispute.note && <p className="mt-1 text-ink/80">&ldquo;{order.dispute.note}&rdquo;</p>}
          <p className="mt-2 text-muted">Funds are frozen in escrow. Payoo&apos;s resolution team will refund you or release payment to the supplier.</p>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <section className="card p-6">
            <h2 className="font-extrabold">Timeline</h2>
            <ol className="relative mt-5 space-y-5 border-l-2 border-line pl-6">
              {[...order.events].reverse().map((e, i) => (
                <li key={i} className="relative">
                  <span className="absolute top-1 -left-[31px] h-3 w-3 rounded-full border-2 border-white bg-ink ring-2 ring-line" />
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-sm font-bold">{e.label}</span>
                    {e.txSig && <TxLink sig={e.txSig} href={txUrl(e.txSig, simulated)} simulated={simulated} />}
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    {fmtDate(e.at)} · <span className="capitalize">{e.actor}</span>
                    {e.note && <> · {e.note}</>}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {txs.length > 0 && (
            <section className="card p-6">
              <h2 className="font-extrabold">Solana transactions</h2>
              <p className="mt-1 text-xs text-muted">Every state change is a public, verifiable transaction.</p>
              <div className="mt-4 divide-y divide-line">
                {txs.map((t) => (
                  <div key={t.sig} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div className="flex flex-wrap gap-1.5">
                      {t.instructions.map((ix) => (
                        <span key={ix} className="rounded-md bg-violet-soft px-2 py-0.5 font-mono text-[11px] text-violet">
                          {ix}
                        </span>
                      ))}
                    </div>
                    <TxLink sig={t.sig} href={txUrl(t.sig, t.simulated)} simulated={t.simulated} />
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className="space-y-6">
          <section className="card p-6">
            <h2 className="font-extrabold">Amounts</h2>
            <dl className="num mt-4 space-y-2.5 text-sm">
              <div className="flex justify-between"><dt className="text-muted">You paid</dt><dd className="font-bold">{fmtNpr(order.totalNprPaisa)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Via</dt><dd>{RAIL_LABELS[order.rail.method]} · {order.rail.reference}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Escrowed</dt><dd>{fmtUsdc(order.amountUsdc)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Locked rate</dt><dd>{(order.quoteRateE6 / 1e6).toFixed(4)} CNY/USD</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Payoo fee</dt><dd>{fmtUsdc(order.feeUsdc)}</dd></div>
              <div className="flex justify-between border-t border-line pt-2.5"><dt className="text-muted">Supplier receives</dt><dd className="font-bold">{fmtCny(order.invoiceCnyFen)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Payout to</dt><dd>{PAYOUT_LABELS[supplier.payoutMethod]}</dd></div>
              {order.payout && (
                <div className="flex justify-between"><dt className="text-muted">Payout ref</dt><dd className="font-mono text-xs">{order.payout.reference}</dd></div>
              )}
              <div className="flex justify-between text-jade"><dt>Saved vs bank wire</dt><dd className="font-bold">{fmtNpr(Math.max(0, order.savingsNprPaisa))}</dd></div>
            </dl>
          </section>

          <section className="card p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-extrabold">On-chain escrow</h2>
              {onchain && <span className="rounded-md bg-violet-soft px-2 py-0.5 font-mono text-[11px] text-violet">{onchain.status}</span>}
            </div>
            <dl className="mt-4 space-y-2.5 text-sm">
              <div className="flex justify-between gap-2"><dt className="text-muted">Order PDA</dt><dd><Addr value={order.orderPda} href={chain.explorerAddress(order.orderPda)} /></dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">Vault (USDC)</dt><dd><Addr value={order.vaultPda} href={chain.explorerAddress(order.vaultPda)} /></dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">Buyer wallet</dt><dd><Addr value={order.buyerWallet} href={chain.explorerAddress(order.buyerWallet)} /></dd></div>
              {onchain && (
                <div className="flex justify-between gap-2"><dt className="text-muted">Vault balance</dt><dd className="num">{fmtUsdc(onchain.vaultBalance)}</dd></div>
              )}
              <div className="flex justify-between gap-2"><dt className="text-muted">Supplier hash</dt><dd className="font-mono text-xs" title={order.supplierHash}>{order.supplierHash.slice(0, 12)}…</dd></div>
            </dl>
            <p className="mt-4 text-[11px] leading-relaxed text-muted">
              {order.seeded
                ? "Historical demo order (seed data)."
                : simulated
                  ? "Simulated chain mode: state mirrors the payoo_escrow program. Set PAYOO_CHAIN_MODE=devnet for real transactions."
                  : `Live from ${chain.cluster}. Supplier payout details are stored off-chain; only their hash is on-chain.`}
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
