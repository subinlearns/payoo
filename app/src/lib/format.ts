const npr = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nprWhole = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const cny = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtNpr = (paisa: number) => `NPR ${npr.format(paisa / 100)}`;
export const fmtNprWhole = (paisa: number) => `NPR ${nprWhole.format(Math.round(paisa / 100))}`;
export const fmtCny = (fen: number) => `¥${cny.format(fen / 100)}`;
export const fmtUsdc = (base: number) => `${usd.format(base / 1e6)} USDC`;
export const fmtUsd = (base: number) => `$${usd.format(base / 1e6)}`;
export const fmtRate = (r: number, dp = 4) => r.toFixed(dp);

export const shortAddr = (a: string, n = 4) => (a.length > 2 * n + 3 ? `${a.slice(0, n)}…${a.slice(-n)}` : a);

export function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtRelative(iso: string, now = Date.now()) {
  const diff = Math.round((now - new Date(iso).getTime()) / 1000);
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? "ago" : "from now";
  if (abs < 60) return diff >= 0 ? "just now" : "in under a minute";
  if (abs < 3600) return `${Math.floor(abs / 60)} min ${suffix}`;
  if (abs < 86400) return `${Math.floor(abs / 3600)} h ${suffix}`;
  return `${Math.floor(abs / 86400)} d ${suffix}`;
}

export const RAIL_LABELS: Record<string, string> = {
  esewa: "eSewa",
  khalti: "Khalti",
  connectips: "connectIPS",
  fonepay_qr: "Fonepay QR",
  bank_transfer: "Bank transfer",
};

export const PAYOUT_LABELS: Record<string, string> = {
  alipay: "Alipay",
  wechat: "WeChat Pay",
  bank: "Bank transfer (CNAPS)",
};
