import Link from "next/link";
import { Logo } from "@/components/ui";
import { SideNav } from "@/components/nav";
import { chainMode } from "@/lib/chain";
import { getRates } from "@/lib/fx";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const MODE_LABEL = { simulated: "Simulated chain", devnet: "Solana devnet", localnet: "Solana localnet" };

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [rates, user] = await Promise.all([getRates(), currentUser()]);
  const mode = chainMode();
  return (
    <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col lg:flex-row">
      <aside className="no-print border-b border-line px-4 py-4 lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:shrink-0 lg:border-r lg:border-b-0 lg:px-4 lg:py-6">
        <div className="mb-4 flex items-center justify-between lg:mb-8 lg:px-2">
          <Link href="/">
            <Logo />
          </Link>
        </div>
        <SideNav />
        <div className="mt-8 hidden rounded-2xl border border-line bg-white/60 p-3 lg:block">
          <div className="text-sm font-bold">{user.business}</div>
          <div className="text-xs text-muted">{user.name} · KYC {user.kyc.status}</div>
          <Link href="/onboarding" className="mt-2 inline-block text-xs font-semibold text-crimson hover:underline">
            Onboard a new importer →
          </Link>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="no-print flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-8">
          <div className="flex items-center gap-4 text-xs">
            <span className="num font-semibold">
              USD/CNY <span className="text-ink">{rates.usdCny.toFixed(4)}</span>
            </span>
            <span className="num font-semibold">
              USD/NPR <span className="text-ink">{rates.usdNpr.toFixed(2)}</span>
            </span>
            <span className="num hidden font-semibold sm:inline">
              ¥1 = NPR {rates.cnyNpr.toFixed(3)}
            </span>
            <span className="rounded-full bg-line px-2 py-0.5 text-[10px] font-bold text-muted uppercase">{rates.source}</span>
          </div>
          <Link
            href="/ledger"
            className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1 text-xs font-bold"
          >
            <span className={`h-2 w-2 rounded-full ${mode === "simulated" ? "bg-amber" : "sol-gradient"}`} />
            {MODE_LABEL[mode]}
          </Link>
        </header>
        <main className="px-4 py-8 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
