import Link from "next/link";
import { notFound } from "next/navigation";
import { readDb } from "@/lib/db";
import { getChain, txUrl } from "@/lib/chain";
import { PAYOUT_LABELS, RAIL_LABELS, fmtCny, fmtDate, fmtNpr, fmtUsdc } from "@/lib/format";
import { Logo, StatusBadge } from "@/components/ui";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = readDb();
  const order = db.orders.find((o) => o.id === id);
  if (!order) notFound();
  const supplier = db.suppliers.find((s) => s.id === order.supplierId)!;
  const buyer = db.users.find((u) => u.id === order.userId)!;
  const chain = getChain();
  const proofs = order.events.filter((e) => e.txSig);

  const rows: [string, string][] = [
    ["Invoice", `${fmtCny(order.invoiceCnyFen)} · ${order.invoiceRef}`],
    ["Locked FX rate", `${(order.quoteRateE6 / 1e6).toFixed(4)} CNY per USD`],
    ["USDC settled", fmtUsdc(order.amountUsdc)],
    ["Payoo fee", fmtUsdc(order.feeUsdc)],
    ["Total paid", fmtNpr(order.totalNprPaisa)],
    ["Paid via", `${RAIL_LABELS[order.rail.method]} · ${order.rail.reference}`],
    ["Supplier payout", `${PAYOUT_LABELS[supplier.payoutMethod]} · ${supplier.payoutName}`],
  ];
  if (order.payout) rows.push(["Payout reference", order.payout.reference]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="no-print mb-6 flex justify-between">
        <Link href={`/orders/${order.id}`} className="text-sm font-semibold text-muted hover:text-ink">← Back to order</Link>
        <PrintButton />
      </div>
      <div className="card p-8">
        <div className="flex items-start justify-between">
          <Logo />
          <div className="text-right text-xs text-muted">
            <div className="font-bold text-ink">Payment receipt</div>
            <div>{fmtDate(order.createdAt)}</div>
            <div className="font-mono">#{order.id.slice(0, 8).toUpperCase()}</div>
          </div>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-6 text-sm">
          <div>
            <div className="eyebrow">From</div>
            <div className="mt-1 font-bold">{buyer.business}</div>
            <div className="text-muted">{buyer.city}, Nepal · PAN {buyer.pan}</div>
          </div>
          <div>
            <div className="eyebrow">To</div>
            <div className="mt-1 font-bold">{supplier.name}</div>
            <div className="text-muted">{supplier.nameZh ? `${supplier.nameZh} · ` : ""}{supplier.city}</div>
          </div>
        </div>
        <div className="mt-8 flex items-center justify-between rounded-2xl bg-paper p-5">
          <div>
            <div className="eyebrow">Supplier receives</div>
            <div className="num text-3xl font-extrabold">{fmtCny(order.invoiceCnyFen)}</div>
          </div>
          <StatusBadge status={order.status} />
        </div>
        <dl className="num mt-6 divide-y divide-line text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 py-2.5">
              <dt className="text-muted">{k}</dt>
              <dd className="text-right font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-8">
          <div className="eyebrow">On-chain proof · Solana {chain.mode === "simulated" || order.seeded ? "(simulated)" : chain.cluster}</div>
          <div className="mt-2 space-y-1.5">
            <div className="flex justify-between gap-3 text-xs">
              <span className="text-muted">Escrow account</span>
              <span className="font-mono break-all">{order.orderPda}</span>
            </div>
            {proofs.map((e) => (
              <div key={e.txSig} className="flex justify-between gap-3 text-xs">
                <span className="shrink-0 text-muted">{e.label}</span>
                <a href={txUrl(e.txSig!, chain.mode === "simulated" || !!order.seeded)} className="truncate font-mono hover:underline">{e.txSig}</a>
              </div>
            ))}
          </div>
        </div>
        <p className="mt-8 border-t border-line pt-4 text-[11px] leading-relaxed text-muted">
          Payoo (proof of concept). Funds were held in a program-controlled escrow on Solana and paid out in CNY by a
          licensed settlement partner. The supplier never received crypto, and the buyer never held crypto.
        </p>
      </div>
    </div>
  );
}
