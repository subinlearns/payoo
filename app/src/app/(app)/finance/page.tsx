import { readDb } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { getRates } from "@/lib/fx";
import { creditProfile } from "@/lib/credit";
import { fmtNprWhole, fmtUsd } from "@/lib/format";
import { PageHeader, SimNotice } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function FinancePage() {
  const [user, rates] = await Promise.all([currentUser(), getRates()]);
  const credit = creditProfile(user, readDb().orders);
  const savingsNpr = (user.savingsUsdc / 1e6) * rates.usdNpr * 100;
  const pct = ((credit.score - 300) / 550) * 100;

  return (
    <>
      <PageHeader
        eyebrow="Roadmap preview"
        title="Savings & working capital"
        sub="The same on-chain rails that move payments can power simple banking for importers. Shown here as a simulated preview."
      />
      <SimNotice>
        Deposit-taking and lending are regulated activities. These features are simulated and would launch only with
        a licensed banking partner.
      </SimNotice>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="card p-6">
          <div className="eyebrow">Dollar savings wallet</div>
          <div className="num mt-3 text-4xl font-extrabold">{fmtUsd(user.savingsUsdc)}</div>
          <div className="num mt-1 text-sm text-muted">≈ {fmtNprWhole(savingsNpr)} at today&apos;s rate</div>
          <p className="mt-5 text-sm text-ink/80">
            Hold a stable USD balance (USDC) between orders, so the next supplier payment isn&apos;t exposed to NPR moving.
            Pay invoices straight from savings with no conversion at checkout.
          </p>
          <div className="mt-5 grid grid-cols-3 gap-3 text-center text-xs">
            {[
              ["Instant", "pay from balance"],
              ["1:1", "USD-backed"],
              ["0 fee", "to hold"],
            ].map(([a, b]) => (
              <div key={a} className="rounded-xl bg-paper p-3">
                <div className="text-sm font-extrabold">{a}</div>
                <div className="text-muted">{b}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="card p-6">
          <div className="eyebrow">Working-capital line</div>
          <div className="mt-3 flex items-end justify-between">
            <div>
              <div className="num text-4xl font-extrabold">{credit.score}</div>
              <div className="text-sm font-bold text-jade">{credit.band}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted">Eligible line</div>
              <div className="num text-2xl font-extrabold">{fmtNprWhole(credit.limitNprPaisa)}</div>
              <div className="text-xs text-muted">{credit.monthlyAprPct}% / month, repaid from future payments</div>
            </div>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full sol-gradient" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-muted">
            <span>300</span>
            <span>850</span>
          </div>
          <div className="mt-5 text-xs font-bold tracking-wider text-muted uppercase">Score built from on-chain history</div>
          <ul className="mt-2 divide-y divide-line text-sm">
            {credit.factors.map((f) => (
              <li key={f.label} className="flex items-center justify-between py-2">
                <span>
                  <span className="font-semibold">{f.label}</span>
                  <span className="block text-xs text-muted">{f.detail}</span>
                </span>
                <span className={`num font-bold ${f.points < 0 ? "text-crimson" : f.points > 0 ? "text-jade" : "text-muted"}`}>
                  {f.points > 0 ? "+" : ""}
                  {f.points}
                </span>
              </li>
            ))}
          </ul>
          <button className="btn-primary mt-4 w-full" disabled>
            Draw advance (coming with lending partner)
          </button>
        </section>
      </div>
    </>
  );
}
