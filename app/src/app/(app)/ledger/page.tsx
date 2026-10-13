import Link from "next/link";
import { readDb } from "@/lib/db";
import { getChain, txUrl } from "@/lib/chain";
import { fmtRelative, shortAddr } from "@/lib/format";
import { PageHeader, TxLink } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function LedgerPage({ searchParams }: { searchParams: Promise<{ address?: string }> }) {
  const { address } = await searchParams;
  const db = readDb();
  const chain = getChain();
  const info = await chain.info();
  let txs = db.txs;
  if (address) {
    const orderIds = new Set(db.orders.filter((o) => [o.orderPda, o.vaultPda, o.buyerWallet].includes(address)).map((o) => o.id));
    txs = txs.filter((t) => t.signer === address || (t.orderId && orderIds.has(t.orderId)));
  }
  const sims = chain.mode === "simulated";

  return (
    <>
      <PageHeader
        eyebrow={sims ? "Simulated cluster" : `Solana ${chain.cluster}`}
        title="On-chain ledger"
        sub={
          sims
            ? "Every transaction the payoo_escrow program processed in this demo. Simulated mode mirrors the program's rules; switch to devnet for real signatures."
            : "Transactions sent to the payoo_escrow program. Links open Solana Explorer."
        }
      />
      <div className="card mb-6 flex flex-wrap gap-x-8 gap-y-3 p-5 text-sm">
        <div>
          <div className="eyebrow">Program</div>
          <a href={chain.explorerAddress(info.programId)} className="font-mono text-xs hover:underline">{info.programId}</a>
        </div>
        <div>
          <div className="eyebrow">Transactions</div>
          <div className="num font-bold">{db.txs.length}</div>
        </div>
        {address && (
          <div>
            <div className="eyebrow">Filtered by</div>
            <span className="font-mono text-xs">{shortAddr(address, 8)}</span>{" "}
            <Link href="/ledger" className="text-xs font-semibold text-crimson">clear</Link>
          </div>
        )}
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] font-bold tracking-wider text-muted uppercase">
              <th className="px-5 py-3">Signature</th>
              <th className="px-3 py-3">Instructions</th>
              <th className="px-3 py-3">Signer</th>
              <th className="px-3 py-3 text-right">Slot</th>
              <th className="px-5 py-3 text-right">Time</th>
            </tr>
          </thead>
          <tbody>
            {txs.slice(0, 200).map((t) => (
              <tr key={t.sig} className="border-b border-line/70 last:border-0">
                <td className="px-5 py-2.5"><TxLink sig={t.sig} href={txUrl(t.sig, t.simulated)} simulated={t.simulated} /></td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {t.instructions.map((ix) => (
                      <span key={ix} className="rounded-md bg-violet-soft px-2 py-0.5 font-mono text-[11px] text-violet">{ix}</span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2.5 font-mono text-xs">{shortAddr(t.signer, 5)}</td>
                <td className="num px-3 py-2.5 text-right text-xs">{t.slot.toLocaleString()}</td>
                <td className="px-5 py-2.5 text-right text-xs text-muted">{fmtRelative(t.at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
