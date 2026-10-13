import Link from "next/link";
import type { OrderStatus } from "@/lib/types";
import { shortAddr } from "@/lib/format";

export function Logo({ className = "", light = false }: { className?: string; light?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="9" fill="#d7263d" />
        <path d="M10 23V9h6.2a4.6 4.6 0 0 1 0 9.2H13" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="22.5" cy="22.5" r="2.2" fill="#14f195" />
      </svg>
      <span className={`text-lg font-extrabold tracking-tight ${light ? "text-white" : "text-ink"}`}>Payoo</span>
    </span>
  );
}

const STATUS_STYLE: Record<OrderStatus, { label: string; cls: string }> = {
  CREATED: { label: "Created", cls: "bg-line text-ink" },
  FUNDED: { label: "In escrow", cls: "bg-sky-soft text-sky" },
  IN_TRANSIT: { label: "In transit", cls: "bg-violet-soft text-violet" },
  DELIVERED: { label: "Delivered", cls: "bg-sky-soft text-sky" },
  RELEASED: { label: "Paying out", cls: "bg-amber-soft text-amber" },
  SETTLED: { label: "Settled", cls: "bg-jade-soft text-jade" },
  DISPUTED: { label: "Disputed", cls: "bg-crimson-soft text-crimson" },
  REFUNDED: { label: "Refunded", cls: "bg-line text-muted" },
  CANCELLED: { label: "Cancelled", cls: "bg-line text-muted" },
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${s.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full bg-current ${status === "RELEASED" ? "pulse-dot" : ""}`} />
      {s.label}
    </span>
  );
}

export function TxLink({ sig, href, simulated }: { sig: string; href: string; simulated: boolean }) {
  const external = href.startsWith("http");
  return (
    <Link
      href={href}
      target={external ? "_blank" : undefined}
      className="inline-flex items-center gap-1.5 rounded-md bg-ink/[0.04] px-2 py-0.5 font-mono text-[11px] text-ink-2 hover:bg-ink/[0.08]"
      title={sig}
    >
      <span className="h-1.5 w-1.5 rounded-full sol-gradient" />
      {shortAddr(sig, 6)}
      {simulated && <span className="text-muted">· sim</span>}
      {external && <span aria-hidden>↗</span>}
    </Link>
  );
}

export function Addr({ value, href }: { value: string; href?: string }) {
  const inner = <span className="font-mono text-xs">{shortAddr(value, 5)}</span>;
  if (!href) return <span title={value}>{inner}</span>;
  return (
    <Link href={href} target={href.startsWith("http") ? "_blank" : undefined} title={value} className="hover:underline">
      {inner}
    </Link>
  );
}

export function Stat({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub?: React.ReactNode; accent?: boolean }) {
  return (
    <div className={`card p-5 ${accent ? "border-ink bg-ink text-white" : ""}`}>
      <div className={`eyebrow ${accent ? "text-white/60" : ""}`}>{label}</div>
      <div className="num mt-2 text-2xl font-extrabold tracking-tight">{value}</div>
      {sub && <div className={`mt-1 text-xs ${accent ? "text-white/70" : "text-muted"}`}>{sub}</div>}
    </div>
  );
}

export function SectionTitle({ title, action, sub }: { title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-lg font-extrabold tracking-tight">{title}</h2>
        {sub && <p className="mt-0.5 text-sm text-muted">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ eyebrow, title, sub, action }: { eyebrow?: string; title: string; sub?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{title}</h1>
        {sub && <p className="mt-1.5 max-w-2xl text-sm text-muted">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function SimNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-dashed border-amber/40 bg-amber-soft/60 px-3.5 py-2.5 text-xs text-amber">
      <span className="mt-px font-bold">Preview</span>
      <span className="text-ink/70">{children}</span>
    </div>
  );
}

export function Empty({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-12 text-center">
      <div className="text-sm font-bold">{title}</div>
      {sub && <p className="mt-1 max-w-sm text-sm text-muted">{sub}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
