import Link from "next/link";
import { readDb } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { PAYOUT_LABELS, fmtCny } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { AddSupplierForm } from "./add-supplier-form";

export const dynamic = "force-dynamic";

export default async function SuppliersPage() {
  const user = await currentUser();
  const db = readDb();
  const suppliers = db.suppliers.filter((s) => s.ownerId === user.id);
  return (
    <>
      <PageHeader
        eyebrow="Suppliers"
        title="Who you pay in China"
        sub="Payout details are stored off-chain and verified by our settlement partner. Only a hash goes on-chain."
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="grid content-start gap-4 sm:grid-cols-2">
          {suppliers.map((s) => {
            const paid = db.orders.filter((o) => o.supplierId === s.id && o.status === "SETTLED");
            return (
              <div key={s.id} className="card flex flex-col p-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-bold">{s.name}</div>
                    {s.nameZh && <div className="text-sm text-muted">{s.nameZh}</div>}
                  </div>
                  <span className="rounded-full bg-paper px-2 py-0.5 text-[11px] font-bold">{s.marketplace}</span>
                </div>
                <div className="mt-3 space-y-1 text-xs text-muted">
                  <div>{s.city}</div>
                  <div>
                    {PAYOUT_LABELS[s.payoutMethod]} · {s.payoutName} · {s.payoutAccount}
                  </div>
                  <div>
                    {s.verified ? (
                      <span className="font-semibold text-jade">Payout details verified by partner</span>
                    ) : (
                      <span className="font-semibold text-amber">Verification pending, so escrow is recommended</span>
                    )}
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
                  <span className="num text-xs text-muted">
                    {paid.length} paid · {fmtCny(paid.reduce((a, o) => a + o.invoiceCnyFen, 0))}
                  </span>
                  <Link href={`/pay?supplier=${s.id}`} className="btn-primary btn-sm">
                    Pay
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
        <AddSupplierForm />
      </div>
    </>
  );
}
