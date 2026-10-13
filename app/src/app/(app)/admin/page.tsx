import { readDb } from "@/lib/db";
import { getChain } from "@/lib/chain";
import { fmtCny, fmtNprWhole, fmtRelative, fmtUsdc } from "@/lib/format";
import { ActionButton } from "@/components/action-button";
import { OrdersTable } from "@/components/orders-table";
import { Addr, PageHeader, SectionTitle, Stat } from "@/components/ui";
import { ResetButton } from "./reset-button";

export const dynamic = "force-dynamic";

const SOURCE = ["manual", "Pyth", "market API"];

export default async function AdminPage() {
  const db = readDb();
  const chain = getChain();
  const info = await chain.info();
  const buyers = Object.fromEntries(db.users.map((u) => [u.id, u.business]));
  const sup = new Map(db.suppliers.map((s) => [s.id, s]));
  const disputes = db.orders.filter((o) => o.status === "DISPUTED");
  const fees = db.orders.filter((o) => o.status === "SETTLED").reduce((a, o) => a + o.feeUsdc, 0);
  const saved = db.orders.filter((o) => o.status === "SETTLED").reduce((a, o) => a + Math.max(0, o.savingsNprPaisa), 0);
  const rateAge = info.rateFeed ? Math.floor(Date.now() / 1000) - info.rateFeed.updatedAt : null;
  const ex = (a: string) => chain.explorerAddress(a);

  return (
    <>
      <PageHeader
        eyebrow="Platform admin · demo persona"
        title="Operations & treasury"
        sub="Program config, treasury float, FX reference feed and dispute resolution."
        action={<ResetButton />}
      />

      {!info.ready && (
        <div className="mb-6 rounded-xl border border-crimson/30 bg-crimson-soft p-4 text-sm text-crimson">{info.error}</div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat accent label="Escrow volume (on-chain)" value={fmtUsdc(info.totalVolumeUsdc)} sub={`${info.orderCount} orders created`} />
        <Stat label="Settled to suppliers" value={fmtUsdc(info.totalSettledUsdc)} sub={`Refunded ${fmtUsdc(info.totalRefundedUsdc)}`} />
        <Stat label="Fee revenue" value={fmtUsdc(fees)} sub="Settled orders" />
        <Stat label="Customer savings vs bank" value={fmtNprWhole(saved)} sub="Settled orders" />
      </div>

      {disputes.length > 0 && (
        <section className="mt-10">
          <SectionTitle title="Disputes awaiting resolution" sub="Funds are frozen in each order's escrow vault" />
          <div className="card divide-y divide-line">
            {disputes.map((o) => (
              <div key={o.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                <div className="max-w-xl">
                  <div className="font-bold">
                    {fmtCny(o.invoiceCnyFen)} · {buyers[o.userId]} → {sup.get(o.supplierId)?.name}
                  </div>
                  <div className="mt-0.5 text-sm text-crimson">{o.dispute?.reason}</div>
                  {o.dispute?.note && <div className="mt-0.5 text-xs text-muted">&ldquo;{o.dispute.note}&rdquo;</div>}
                  <div className="mt-0.5 text-xs text-muted">Opened {o.dispute && fmtRelative(o.dispute.openedAt)}</div>
                </div>
                <div className="flex gap-2">
                  <ActionButton orderId={o.id} body={{ actor: "admin", action: "resolve", refund: true }} className="btn-accent" confirm="Refund the buyer? USDC returns to treasury and NPR is refunded.">
                    Refund buyer
                  </ActionButton>
                  <ActionButton orderId={o.id} body={{ actor: "admin", action: "resolve", refund: false }} className="btn-ghost" confirm="Reject the dispute and pay the supplier?">
                    Release to supplier
                  </ActionButton>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="mt-10 grid gap-6 lg:grid-cols-3">
        <section className="card p-6">
          <h2 className="font-extrabold">Treasury</h2>
          <div className="num mt-3 text-3xl font-extrabold">{fmtUsdc(info.treasuryUsdc)}</div>
          <p className="mt-1 text-xs text-muted">USDC float that pre-funds escrows while NPR settles locally.</p>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Treasury account</dt><dd><Addr value={info.treasury} href={ex(info.treasury)} /></dd></div>
            <div className="flex justify-between"><dt className="text-muted">USDC mint</dt><dd><Addr value={info.usdcMint} href={ex(info.usdcMint)} /></dd></div>
            {info.operatorSol !== undefined && (
              <div className="flex justify-between"><dt className="text-muted">Operator SOL (fees)</dt><dd className="num">{info.operatorSol.toFixed(3)} SOL</dd></div>
            )}
          </dl>
        </section>

        <section className="card p-6">
          <h2 className="font-extrabold">FX reference feed</h2>
          {info.rateFeed ? (
            <>
              <div className="num mt-3 text-3xl font-extrabold">{(info.rateFeed.usdCnyE6 / 1e6).toFixed(4)}</div>
              <div className="text-xs text-muted">CNY per USD · NPR/USD {(info.rateFeed.usdNprE6 / 1e6).toFixed(2)}</div>
              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between"><dt className="text-muted">Source</dt><dd>{SOURCE[info.rateFeed.source] ?? info.rateFeed.source}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Updated</dt><dd>{rateAge !== null && `${rateAge}s ago`}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Max staleness</dt><dd>{info.maxRateStalenessSecs}s</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Max quote deviation</dt><dd>{info.maxQuoteDeviationBps / 100}%</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Feed account</dt><dd><Addr value={info.rateFeedPda} href={ex(info.rateFeedPda)} /></dd></div>
              </dl>
            </>
          ) : (
            <p className="mt-3 text-sm text-muted">Not initialized.</p>
          )}
        </section>

        <section className="card p-6">
          <h2 className="font-extrabold">Program config</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Program</dt><dd><Addr value={info.programId} href={ex(info.programId)} /></dd></div>
            <div className="flex justify-between"><dt className="text-muted">Config PDA</dt><dd><Addr value={info.configPda} href={ex(info.configPda)} /></dd></div>
            <div className="flex justify-between"><dt className="text-muted">Admin</dt><dd><Addr value={info.admin} href={ex(info.admin)} /></dd></div>
            <div className="flex justify-between"><dt className="text-muted">Operator</dt><dd><Addr value={info.operator} href={ex(info.operator)} /></dd></div>
            <div className="flex justify-between"><dt className="text-muted">Settlement partner</dt><dd><Addr value={info.settlementPartner} href={ex(info.settlementPartner)} /></dd></div>
            <div className="flex justify-between"><dt className="text-muted">Fee</dt><dd>{info.feeBps / 100}%</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Per-order cap</dt><dd className="num">{fmtUsdc(info.maxOrderUsdc)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Dispute window</dt><dd>{Math.round(info.disputeWindowSecs / 86400)} days</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Status</dt><dd className={info.paused ? "text-crimson" : "text-jade"}>{info.paused ? "Paused" : "Live"}</dd></div>
          </dl>
        </section>
      </div>

      <section className="mt-10">
        <SectionTitle title="All orders" />
        <OrdersTable
          orders={db.orders}
          suppliers={db.suppliers}
          showBuyer
          buyers={buyers}
          actions={(o) =>
            o.seeded ? null : o.status === "FUNDED" || o.status === "IN_TRANSIT" ? (
              <ActionButton orderId={o.id} body={{ actor: "admin", action: "refund" }} className="btn-ghost btn-sm" confirm="Refund this order to the treasury?">
                Refund
              </ActionButton>
            ) : null
          }
        />
      </section>
    </>
  );
}
