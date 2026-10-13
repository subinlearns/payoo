"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "@/components/action-button";

const REASONS = [
  [1, "Goods not received"],
  [2, "Not as described / damaged"],
  [3, "Wrong quantity"],
  [4, "Other"],
] as const;

export function DisputeForm({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(2);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" className="btn-ghost" onClick={() => setOpen(true)}>
        Open dispute
      </button>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await postJson(`/api/orders/${orderId}/actions`, { actor: "buyer", action: "dispute", reason, note });
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full space-y-3 rounded-xl border border-line bg-paper p-4 sm:w-80">
      <select className="input" value={reason} onChange={(e) => setReason(Number(e.target.value))}>
        {REASONS.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <textarea className="input min-h-20" placeholder="What went wrong? (photos can be added later)" value={note} onChange={(e) => setNote(e.target.value)} />
      {error && <p className="text-xs text-crimson">{error}</p>}
      <div className="flex gap-2">
        <button className="btn-accent flex-1" disabled={busy}>
          {busy ? "Signing…" : "Freeze funds & dispute"}
        </button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
