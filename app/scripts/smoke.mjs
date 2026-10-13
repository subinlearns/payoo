// End-to-end smoke test against a running Payoo server (any chain mode).
// Usage: node scripts/smoke.mjs [baseUrl]
const B = process.argv[2] ?? "http://localhost:3000";

async function post(path, body) {
  const res = await fetch(B + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json();
  return { ok: res.ok, data };
}

let failures = 0;
function check(label, cond, extra = "") {
  console.log(`${cond ? "✔" : "✘"} ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) failures++;
}

async function pay(supplierId, invoiceCny, escrowMode, method) {
  const q = await post("/api/quotes", { supplierId, invoiceCny, invoiceRef: `SMOKE-${Date.now()}`, escrowMode });
  if (!q.ok) throw new Error(`quote: ${q.data.error}`);
  const o = await post(`/api/quotes/${q.data.id}/pay`, { method });
  if (!o.ok) throw new Error(`pay: ${o.data.error}`);
  return { quote: q.data, order: o.data };
}

const act = (id, body) => post(`/api/orders/${id}/actions`, body);

// 1. Direct payment: funded + released in one go, then partner settles.
const d = await pay("sup_yiwu", 5000, false, "esewa");
check("direct payment released to partner", d.order.status === "RELEASED", `NPR ${d.quote.totalNprPaisa / 100}`);
const replay = await post(`/api/quotes/${d.quote.id}/pay`, { method: "esewa" });
check("quote cannot be paid twice", !replay.ok, replay.data.error);
const wrongRole = await act(d.order.id, { actor: "buyer", action: "settle" });
check("buyer cannot settle", !wrongRole.ok, wrongRole.data.error);
const s = await act(d.order.id, { actor: "partner", action: "settle" });
check("partner settles in CNY", s.data.status === "SETTLED", s.data.payout?.reference);

// 2. Escrow → ship → dispute → refund.
const e1 = await pay("sup_guangzhou", 2400.5, true, "khalti");
check("escrow payment funded", e1.order.status === "FUNDED");
check("ship", (await act(e1.order.id, { actor: "supplier", action: "ship", carrier: "SF Express", windowDays: 14 })).data.status === "IN_TRANSIT");
check("dispute", (await act(e1.order.id, { actor: "buyer", action: "dispute", reason: 2, note: "damaged" })).data.status === "DISPUTED");
check("admin refunds", (await act(e1.order.id, { actor: "admin", action: "resolve", refund: true })).data.status === "REFUNDED");

// 3. Escrow → ship → buyer confirms (auto-release) → settle.
const e2 = await pay("sup_shenzhen", 12000, true, "connectips");
check("ship", (await act(e2.order.id, { actor: "supplier", action: "ship", windowDays: 14 })).data.status === "IN_TRANSIT");
check("buyer confirms → released", (await act(e2.order.id, { actor: "buyer", action: "confirm_delivery" })).data.status === "RELEASED");
check("settled", (await act(e2.order.id, { actor: "partner", action: "settle" })).data.status === "SETTLED");

// 4. On-chain state agrees.
const detail = await (await fetch(`${B}/api/orders/${e2.order.id}`)).json();
check("on-chain order is Settled", detail.onchain?.status === "Settled", detail.onchain?.address);
check("vault drained", detail.onchain?.vaultBalance === 0);
const refunded = await (await fetch(`${B}/api/orders/${e1.order.id}`)).json();
check("on-chain refunded order is Refunded", refunded.onchain?.status === "Refunded");
const chain = await (await fetch(`${B}/api/chain`)).json();
console.log(`  chain: ${chain.mode} · orders ${chain.orderCount} · treasury ${(chain.treasuryUsdc / 1e6).toFixed(2)} USDC`);

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll smoke checks passed");
