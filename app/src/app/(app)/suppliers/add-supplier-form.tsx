"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "@/components/action-button";

const EMPTY = { name: "", nameZh: "", marketplace: "Alibaba", storeUrl: "", city: "", payoutMethod: "alipay", payoutName: "", payoutAccount: "" };

export function AddSupplierForm() {
  const router = useRouter();
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await postJson("/api/suppliers", f);
      setF(EMPTY);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card h-fit space-y-4 p-6">
      <div className="font-extrabold">Add a supplier</div>
      <div>
        <label className="label">Company name</label>
        <input className="input" value={f.name} onChange={set("name")} placeholder="Ningbo Harbor Housewares Co." />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Chinese name</label>
          <input className="input" value={f.nameZh} onChange={set("nameZh")} placeholder="宁波…" />
        </div>
        <div>
          <label className="label">Marketplace</label>
          <select className="input" value={f.marketplace} onChange={set("marketplace")}>
            {["Alibaba", "1688", "AliExpress", "Taobao", "Direct"].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">City</label>
          <input className="input" value={f.city} onChange={set("city")} placeholder="Ningbo" />
        </div>
        <div>
          <label className="label">Store link</label>
          <input className="input" value={f.storeUrl} onChange={set("storeUrl")} placeholder="https://…" />
        </div>
      </div>
      <div>
        <label className="label">Payout method</label>
        <select className="input" value={f.payoutMethod} onChange={set("payoutMethod")}>
          <option value="alipay">Alipay</option>
          <option value="wechat">WeChat Pay</option>
          <option value="bank">Bank transfer (CNAPS)</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Account name</label>
          <input className="input" value={f.payoutName} onChange={set("payoutName")} />
        </div>
        <div>
          <label className="label">Account / ID</label>
          <input className="input" value={f.payoutAccount} onChange={set("payoutAccount")} />
        </div>
      </div>
      {error && <p className="text-sm text-crimson">{error}</p>}
      <button className="btn-primary w-full" disabled={busy}>
        {busy ? "Saving…" : "Save supplier"}
      </button>
    </form>
  );
}
