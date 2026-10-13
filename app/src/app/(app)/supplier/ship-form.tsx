"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "@/components/action-button";

export function ShipForm({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [carrier, setCarrier] = useState("China Post EMS");
  const [trackingNumber, setTracking] = useState("");
  const [windowDays, setWindow] = useState(21);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await postJson(`/api/orders/${orderId}/actions`, { actor: "supplier", action: "ship", carrier, trackingNumber, windowDays });
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <select className="input" value={carrier} onChange={(e) => setCarrier(e.target.value)}>
          {["China Post EMS", "SF Express", "DHL Express", "Cargo via Kerung (Gyirong)", "Sea + rail via Kolkata"].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <input className="input" placeholder="Tracking no. (auto)" value={trackingNumber} onChange={(e) => setTracking(e.target.value)} />
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs text-muted">Delivery window</label>
        <input type="number" min={1} max={90} className="input w-20" value={windowDays} onChange={(e) => setWindow(Number(e.target.value))} />
        <span className="text-xs text-muted">days</span>
        <button className="btn-primary ml-auto" disabled={busy}>
          {busy ? "Signing…" : "Mark shipped"}
        </button>
      </div>
      {error && <p className="text-xs text-crimson">{error}</p>}
    </form>
  );
}
