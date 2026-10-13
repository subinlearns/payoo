import { readDb } from "@/lib/db";
import { PAYOUT_LABELS, fmtCny, fmtRelative } from "@/lib/format";
import { Empty, PageHeader, SectionTitle, StatusBadge } from "@/components/ui";
import { ShipForm } from "./ship-form";

export const dynamic = "force-dynamic";

export default async function SupplierPortal() {
  const db = readDb();
  const sup = new Map(db.suppliers.map((s) => [s.id, s]));
  const buyers = new Map(db.users.map((u) => [u.id, u]));
  const toShip = db.orders.filter((o) => o.escrowMode && o.status === "FUNDED" && !o.seeded);
  const incoming = db.orders.filter((o) => ["IN_TRANSIT", "DELIVERED", "RELEASED", "SETTLED"].includes(o.status)).slice(0, 12);

  return (
    <>
      <PageHeader
        eyebrow="Supplier portal · demo persona"
        title="Orders funded and ready to ship"
        sub="Suppliers see that payment is already locked in escrow before they ship. They never touch crypto: they're paid in CNY by the settlement partner."
      />
      <section>
        <SectionTitle title="Awaiting shipment" sub="Buyer funds are verifiably locked on-chain" />
        {toShip.length === 0 ? (
          <Empty title="Nothing to ship" sub="Create an escrow-protected payment as the importer and it will appear here." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {toShip.map((o) => {
              const s = sup.get(o.supplierId)!;
              return (
                <div key={o.id} className="card p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs text-muted">{s.name}</div>
                      <div className="num text-2xl font-extrabold">{fmtCny(o.invoiceCnyFen)}</div>
                      <div className="text-xs text-muted">
                        {o.invoiceRef} · from {buyers.get(o.userId)?.business}
                      </div>
                    </div>
                    <StatusBadge status={o.status} />
                  </div>
                  <div className="mt-3 rounded-xl bg-jade-soft px-3 py-2 text-xs text-jade">
                    Payment secured in escrow {fmtRelative(o.updatedAt)}. Payout via {PAYOUT_LABELS[s.payoutMethod]} on delivery.
                  </div>
                  <ShipForm orderId={o.id} />
                </div>
              );
            })}
          </div>
        )}
      </section>
      <section className="mt-10">
        <SectionTitle title="Payment status" />
        <div className="card divide-y divide-line">
          {incoming.map((o) => (
            <div key={o.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
              <div>
                <div className="font-semibold">{sup.get(o.supplierId)?.name}</div>
                <div className="text-xs text-muted">
                  {o.invoiceRef}
                  {o.tracking && ` · ${o.tracking.carrier} ${o.tracking.number}`}
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className="num font-bold">{fmtCny(o.invoiceCnyFen)}</span>
                <StatusBadge status={o.status} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
