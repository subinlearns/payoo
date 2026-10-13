import Link from "next/link";
import { readDb } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { getChain } from "@/lib/chain";
import { fmtCny, fmtNprWhole, fmtUsd, shortAddr } from "@/lib/format";
import { OrdersTable } from "@/components/orders-table";
import { Empty, PageHeader, SectionTitle, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

const ACTIVE = new Set(["FUNDED", "IN_TRANSIT", "DELIVERED", "RELEASED", "DISPUTED"]);

function settlementMinutes(o: { events: { type: string; at: string }[] }) {
  const funded = o.events.find((e) => e.type === "NPR_RECEIVED");
  const settled = o.events.find((e) => e.type === "SETTLED");
  if (!funded || !settled) return null;
  return (new Date(settled.at).getTime() - new Date(funded.at).getTime()) / 60_000;
}

export default async function DashboardPage() {
  const user = await currentUser();
  const db = readDb();
  const chain = getChain();
  const orders = db.orders.filter((o) => o.userId === user.id);
  const suppliers = db.suppliers.filter((s) => s.ownerId === user.id);
  const active = orders.filter((o) => ACTIVE.has(o.status));
  const settled = orders.filter((o) => o.status === "SETTLED");

  const totalPaid = settled.reduce((s, o) => s + o.totalNprPaisa, 0);
  const totalCny = settled.reduce((s, o) => s + o.invoiceCnyFen, 0);
  const saved = settled.reduce((s, o) => s + Math.max(0, o.savingsNprPaisa), 0);
  const directTimes = settled.filter((o) => !o.escrowMode).map(settlementMinutes).filter((m): m is number => m !== null);
  const avgMinutes = directTimes.length ? Math.round(directTimes.reduce((a, b) => a + b, 0) / directTimes.length) : null;

  return (
    <>
      <PageHeader
        eyebrow={user.business}
        title={`Namaste, ${user.name.split(" ")[0]}`}
        sub="Pay suppliers in China from Nepal. Your NPR is converted at a locked rate and settled through an on-chain escrow."
        action={
          <Link href="/pay" className="btn-accent">
            + Pay a supplier
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat accent label="Paid to suppliers" value={fmtCny(totalCny)} sub={`${fmtNprWhole(totalPaid)} across ${settled.length} payments`} />
        <Stat label="Saved vs bank wire" value={<span className="text-jade">{fmtNprWhole(saved)}</span>} sub="Compared with a typical outward TT" />
        <Stat
          label="Avg. time to supplier"
          value={avgMinutes !== null ? `${avgMinutes} min` : "N/A"}
          sub="Direct payments, NPR in → CNY out"
        />
        <Stat label="Active payments" value={active.length} sub={`${suppliers.length} saved suppliers`} />
      </div>

      <div className="mt-10 grid gap-8 xl:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-10">
          {active.length > 0 && (
            <section>
              <SectionTitle title="In progress" sub="Payments moving through escrow and settlement" />
              <OrdersTable orders={active} suppliers={db.suppliers} />
            </section>
          )}
          <section>
            <SectionTitle title="Payment history" />
            {orders.length ? (
              <OrdersTable orders={orders.filter((o) => !ACTIVE.has(o.status))} suppliers={db.suppliers} />
            ) : (
              <Empty
                title="No payments yet"
                sub="Add a supplier and get a locked quote. Most payments settle in minutes."
                action={
                  <Link href="/pay" className="btn-primary">
                    Make your first payment
                  </Link>
                }
              />
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <div className="card p-5">
            <div className="eyebrow">Embedded wallet</div>
            <p className="mt-1 text-xs text-muted">Created at sign-up. No seed phrase, and Payoo sponsors network fees.</p>
            <a
              href={chain.explorerAddress(user.wallet.publicKey)}
              target={chain.mode === "simulated" ? undefined : "_blank"}
              className="mt-3 block rounded-xl bg-paper px-3 py-2 font-mono text-xs break-all hover:bg-line/60"
            >
              {shortAddr(user.wallet.publicKey, 10)}
            </a>
            <div className="mt-3 flex items-center gap-2 text-xs">
              <span className="rounded-full bg-jade-soft px-2 py-0.5 font-bold text-jade">KYC verified</span>
              <span className="text-muted capitalize">{user.kyc.level} · PAN {user.pan}</span>
            </div>
          </div>
          <Link href="/finance" className="card block p-5 transition hover:border-ink/30">
            <div className="eyebrow">Dollar savings · preview</div>
            <div className="num mt-2 text-2xl font-extrabold">{fmtUsd(user.savingsUsdc)}</div>
            <p className="mt-1 text-xs text-muted">Hold a stable USD balance between orders. See your credit line →</p>
          </Link>
          <div className="card p-5">
            <div className="eyebrow">How a payment flows</div>
            <ol className="mt-3 space-y-2.5 text-xs">
              {[
                ["Lock a quote", "Rate + fee fixed for 10 minutes"],
                ["Pay NPR locally", "eSewa, Khalti, connectIPS, Fonepay QR, bank"],
                ["USDC escrow on Solana", "Public receipt in ~1 second"],
                ["Partner pays CNY", "Alipay, WeChat Pay or bank, same day"],
              ].map(([t, d], i) => (
                <li key={t} className="flex gap-3">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink text-[10px] font-bold text-white">
                    {i + 1}
                  </span>
                  <span>
                    <span className="font-bold">{t}</span>
                    <span className="block text-muted">{d}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </div>
    </>
  );
}
