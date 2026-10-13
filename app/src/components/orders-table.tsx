import Link from "next/link";
import type { Order, Supplier } from "@/lib/types";
import { fmtCny, fmtNprWhole, fmtRelative } from "@/lib/format";
import { StatusBadge } from "./ui";

export function OrdersTable({
  orders,
  suppliers,
  showBuyer,
  buyers,
  hrefBase = "/orders",
  actions,
}: {
  orders: Order[];
  suppliers: Supplier[];
  showBuyer?: boolean;
  buyers?: Record<string, string>;
  hrefBase?: string;
  actions?: (o: Order) => React.ReactNode;
}) {
  const sup = new Map(suppliers.map((s) => [s.id, s]));
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-[11px] font-bold tracking-wider text-muted uppercase">
            <th className="px-5 py-3">Supplier</th>
            {showBuyer && <th className="px-3 py-3">Buyer</th>}
            <th className="px-3 py-3 text-right">Invoice</th>
            <th className="px-3 py-3 text-right">Paid</th>
            <th className="px-3 py-3">Mode</th>
            <th className="px-3 py-3">Status</th>
            <th className="px-3 py-3">Updated</th>
            {actions && <th className="px-5 py-3 text-right">Action</th>}
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => {
            const s = sup.get(o.supplierId);
            return (
              <tr key={o.id} className="border-b border-line/70 last:border-0 hover:bg-paper/60">
                <td className="px-5 py-3">
                  <Link href={`${hrefBase}/${o.id}`} className="font-semibold hover:underline">
                    {s?.name ?? "Supplier"}
                  </Link>
                  <div className="text-xs text-muted">{o.invoiceRef}</div>
                </td>
                {showBuyer && <td className="px-3 py-3 text-xs">{buyers?.[o.userId] ?? o.userId}</td>}
                <td className="num px-3 py-3 text-right font-semibold">{fmtCny(o.invoiceCnyFen)}</td>
                <td className="num px-3 py-3 text-right text-muted">{fmtNprWhole(o.totalNprPaisa)}</td>
                <td className="px-3 py-3 text-xs">{o.escrowMode ? "Protected" : "Direct"}</td>
                <td className="px-3 py-3">
                  <StatusBadge status={o.status} />
                </td>
                <td className="px-3 py-3 text-xs text-muted">{fmtRelative(o.updatedAt)}</td>
                {actions && <td className="px-5 py-3 text-right">{actions(o)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
