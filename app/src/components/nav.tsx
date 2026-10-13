"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const BUYER = [
  { href: "/dashboard", label: "Dashboard", icon: "M3 12l9-8 9 8M5 10v10h14V10" },
  { href: "/pay", label: "Pay a supplier", icon: "M12 5v14M5 12h14" },
  { href: "/suppliers", label: "Suppliers", icon: "M4 7h16M4 12h16M4 17h10" },
  { href: "/finance", label: "Savings & credit", icon: "M4 19h16M7 16V9M12 16V5M17 16v-4" },
];

const OPS = [
  { href: "/supplier", label: "Supplier portal", icon: "M3 7l9-4 9 4-9 4-9-4zM3 7v10l9 4 9-4V7" },
  { href: "/partner", label: "Settlement partner", icon: "M4 6h16v12H4zM4 10h16" },
  { href: "/admin", label: "Platform admin", icon: "M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7l8-4z" },
  { href: "/ledger", label: "On-chain ledger", icon: "M5 4h14v16H5zM9 8h6M9 12h6M9 16h4" },
];

function Item({ href, label, icon }: { href: string; label: string; icon: string }) {
  const path = usePathname();
  const active = path === href || (href !== "/dashboard" && path.startsWith(href + "/")) || (href === "/dashboard" && path.startsWith("/orders"));
  return (
    <Link
      href={href}
      className={`flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold transition ${
        active ? "bg-white text-ink shadow-sm ring-1 ring-line" : "text-ink/70 hover:bg-white/60 hover:text-ink"
      }`}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={icon} />
      </svg>
      {label}
    </Link>
  );
}

export function SideNav() {
  return (
    <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
      <div className="eyebrow mb-1 hidden px-3 lg:block">Importer</div>
      {BUYER.map((i) => (
        <Item key={i.href} {...i} />
      ))}
      <div className="eyebrow mt-5 mb-1 hidden px-3 lg:block">Operations (demo personas)</div>
      <span className="mx-1 w-px shrink-0 bg-line lg:hidden" />
      {OPS.map((i) => (
        <Item key={i.href} {...i} />
      ))}
    </nav>
  );
}
