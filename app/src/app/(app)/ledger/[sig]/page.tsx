import Link from "next/link";
import { notFound } from "next/navigation";
import { readDb } from "@/lib/db";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function TxPage({ params }: { params: Promise<{ sig: string }> }) {
  const { sig } = await params;
  const db = readDb();
  const tx = db.txs.find((t) => t.sig === sig);
  if (!tx) notFound();
  const order = tx.orderId ? db.orders.find((o) => o.id === tx.orderId) : undefined;
  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/ledger" className="text-sm font-semibold text-muted hover:text-ink">← Ledger</Link>
      <h1 className="mt-4 text-2xl font-extrabold tracking-tight">Transaction</h1>
      <div className="mt-1 font-mono text-xs break-all text-muted">{tx.sig}</div>
      <div className="card mt-6 divide-y divide-line text-sm">
        {[
          ["Result", <span key="r" className="font-bold text-jade">Success</span>],
          ["Cluster", tx.simulated ? "Simulated (mirrors payoo_escrow)" : tx.cluster],
          ["Slot", tx.slot.toLocaleString()],
          ["Timestamp", fmtDate(tx.at)],
          ["Signer / fee payer", <span key="s" className="font-mono text-xs">{tx.signer}</span>],
          ["Instructions", tx.instructions.join(" → ")],
          ["Order", order ? <Link key="o" href={`/orders/${order.id}`} className="font-semibold text-crimson hover:underline">{order.invoiceRef}</Link> : "N/A"],
        ].map(([k, v]) => (
          <div key={String(k)} className="flex flex-wrap justify-between gap-2 px-5 py-3">
            <span className="text-muted">{k}</span>
            <span className="text-right">{v}</span>
          </div>
        ))}
      </div>
      {tx.logs.length > 0 && (
        <div className="mt-6">
          <div className="eyebrow mb-2">Program logs</div>
          <pre className="overflow-x-auto rounded-2xl bg-ink p-5 font-mono text-[11px] leading-relaxed text-white/80">
            {tx.logs.join("\n")}
          </pre>
        </div>
      )}
    </div>
  );
}
