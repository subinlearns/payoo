import { readDb } from "@/lib/db";
import { getChain, txUrl } from "@/lib/chain";
import { PAYOUT_LABELS, fmtCny, fmtRelative, fmtUsdc } from "@/lib/format";
import { ActionButton } from "@/components/action-button";
import { Addr, Empty, PageHeader, SectionTitle, Stat, TxLink } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function PartnerConsole() {
  const db = readDb();
  const chain = getChain();
  const info = await chain.info();
  const sup = new Map(db.suppliers.map((s) => [s.id, s]));
  const queue = db.orders.filter((o) => o.status === "RELEASED");
  const settled = db.orders.filter((o) => o.status === "SETTLED");
  const today = settled.filter((o) => o.payout && Date.now() - new Date(o.payout.paidAt).getTime() < 86_400_000);

  return (
    <>
      <PageHeader
        eyebrow="Settlement partner · demo persona"
        title="CNY payout queue"
        sub="A licensed payout partner receives USDC from the escrow, pays the supplier in CNY through local rails, and confirms the payout on-chain."
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat accent label="USDC received, awaiting payout" value={fmtUsdc(queue.reduce((a, o) => a + o.amountUsdc, 0))} sub={`${queue.length} orders`} />
        <Stat label="Paid out today" value={fmtCny(today.reduce((a, o) => a + o.invoiceCnyFen, 0))} sub={`${today.length} payouts`} />
        <Stat label="Partner USDC account" value={fmtUsdc(info.settlementUsdc)} sub={<Addr value={info.settlementTokenAccount} href={chain.explorerAddress(info.settlementTokenAccount)} />} />
      </div>

      <section className="mt-10">
        <SectionTitle title="Ready to pay" sub="USDC already landed in your account for each of these" />
        {queue.length === 0 ? (
          <Empty title="Queue is clear" sub="Released orders appear here the moment the escrow pays out." />
        ) : (
          <div className="card divide-y divide-line">
            {queue.map((o) => {
              const s = sup.get(o.supplierId)!;
              const released = [...o.events].reverse().find((e) => e.type === "RELEASED");
              return (
                <div key={o.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                  <div className="min-w-0">
                    <div className="font-bold">
                      {s.name} {s.nameZh && <span className="font-normal text-muted">· {s.nameZh}</span>}
                    </div>
                    <div className="mt-0.5 text-xs text-muted">
                      {PAYOUT_LABELS[s.payoutMethod]} · {s.payoutName} · {s.payoutAccount} · ref {o.invoiceRef}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 text-xs text-muted">
                      Received {fmtUsdc(o.amountUsdc)} {released && fmtRelative(released.at)}
                      {released?.txSig && <TxLink sig={released.txSig} href={txUrl(released.txSig, chain.mode === "simulated" || !!o.seeded)} simulated={chain.mode === "simulated" || !!o.seeded} />}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="num text-xl font-extrabold">{fmtCny(o.invoiceCnyFen)}</span>
                    <ActionButton orderId={o.id} body={{ actor: "partner", action: "settle" }} className="btn-accent">
                      Pay via {PAYOUT_LABELS[s.payoutMethod].split(" ")[0]} & confirm
                    </ActionButton>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="mt-10">
        <SectionTitle title="Recent payouts" />
        <div className="card divide-y divide-line">
          {settled.slice(0, 8).map((o) => (
            <div key={o.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
              <div>
                <div className="font-semibold">{sup.get(o.supplierId)?.name}</div>
                <div className="font-mono text-xs text-muted">{o.payout?.reference}</div>
              </div>
              <div className="text-right">
                <div className="num font-bold">{fmtCny(o.invoiceCnyFen)}</div>
                <div className="text-xs text-muted">{o.payout && fmtRelative(o.payout.paidAt)}</div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
