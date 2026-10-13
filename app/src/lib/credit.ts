import type { Order, User } from "./types";

export interface CreditFactor {
  label: string;
  detail: string;
  points: number;
}

export interface CreditProfile {
  score: number;
  band: "Building" | "Fair" | "Good" | "Excellent";
  factors: CreditFactor[];
  limitNprPaisa: number;
  monthlyAprPct: number;
  settledCount: number;
  volumeNprPaisa: number;
}

const DAY = 86_400_000;

/**
 * Simulated working-capital credit score derived from on-chain payment history.
 * Roadmap feature: lending requires licensing, so this is presented as a preview only.
 */
export function creditProfile(user: User, orders: Order[]): CreditProfile {
  const mine = orders.filter((o) => o.userId === user.id);
  const settled = mine.filter((o) => o.status === "SETTLED");
  const refundedDisputes = mine.filter((o) => o.dispute?.resolution === "refunded").length;
  const volume = settled.reduce((s, o) => s + o.totalNprPaisa, 0);
  const ageDays = Math.floor((Date.now() - new Date(user.createdAt).getTime()) / DAY);
  const recent = settled.filter((o) => Date.now() - new Date(o.updatedAt).getTime() < 90 * DAY);

  const factors: CreditFactor[] = [
    { label: "Settled payments", detail: `${settled.length} completed on-chain`, points: Math.min(settled.length * 25, 200) },
    {
      label: "Payment volume",
      detail: `NPR ${(volume / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })} settled`,
      points: Math.min(Math.floor(volume / 100 / 25_000), 60),
    },
    { label: "Account age", detail: `${ageDays} days with verified KYC`, points: Math.min(Math.floor(ageDays / 3), 40) },
    { label: "Disputes lost by supplier", detail: `${refundedDisputes} refunds`, points: -40 * refundedDisputes },
  ];
  if (user.kyc.level === "business") {
    factors.push({ label: "Business KYC", detail: "PAN + company registration verified", points: 30 });
  }

  const score = Math.max(300, Math.min(850, 520 + factors.reduce((s, f) => s + f.points, 0)));
  const band = score >= 760 ? "Excellent" : score >= 680 ? "Good" : score >= 600 ? "Fair" : "Building";
  const monthlyVolume = recent.reduce((s, o) => s + o.totalNprPaisa, 0) / 3;
  const multiplier = band === "Excellent" ? 2 : band === "Good" ? 1.5 : band === "Fair" ? 1 : 0;
  const limitNprPaisa = Math.min(Math.round((monthlyVolume * multiplier) / 100_000) * 100_000, 150_000_000);

  return {
    score,
    band,
    factors,
    limitNprPaisa,
    monthlyAprPct: band === "Excellent" ? 1.1 : band === "Good" ? 1.4 : 1.8,
    settledCount: settled.length,
    volumeNprPaisa: volume,
  };
}
