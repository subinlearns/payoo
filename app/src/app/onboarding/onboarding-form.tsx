"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "@/components/action-button";

const STEPS = ["Verifying PAN with IRD", "Screening against sanctions lists", "Creating your embedded Solana wallet"];

export function OnboardingForm() {
  const router = useRouter();
  const [f, setF] = useState({ name: "", business: "", city: "Kathmandu", phone: "", email: "", pan: "", level: "business" });
  const [step, setStep] = useState(-1);
  const [wallet, setWallet] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStep(0);
    try {
      for (let i = 0; i < STEPS.length - 1; i++) {
        await new Promise((r) => setTimeout(r, 650));
        setStep(i + 1);
      }
      const res = await postJson<{ wallet: string }>("/api/onboarding", f);
      setWallet(res.wallet);
      setStep(STEPS.length);
    } catch (err) {
      setError((err as Error).message);
      setStep(-1);
    }
  }

  if (step >= 0) {
    return (
      <div className="card mt-8 p-6">
        <ol className="space-y-4">
          {STEPS.map((s, i) => (
            <li key={s} className="flex items-center gap-3 text-sm">
              <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${step > i ? "bg-jade text-white" : step === i ? "bg-ink text-white" : "bg-line text-muted"}`}>
                {step > i ? "✓" : i + 1}
              </span>
              <span className={step >= i ? "font-semibold" : "text-muted"}>{s}</span>
            </li>
          ))}
        </ol>
        {wallet && (
          <div className="mt-6 rounded-xl bg-jade-soft p-4">
            <div className="text-sm font-bold text-jade">You&apos;re verified.</div>
            <div className="mt-1 text-xs text-ink/70">Your wallet address:</div>
            <div className="mt-1 font-mono text-xs break-all">{wallet}</div>
            <button className="btn-primary mt-4" onClick={() => (router.push("/suppliers"), router.refresh())}>
              Add your first supplier →
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card mt-8 space-y-4 p-6">
      <div className="grid grid-cols-2 gap-2">
        {[
          ["business", "Business", "Company PAN + registration"],
          ["individual", "Individual", "Citizenship + PAN"],
        ].map(([v, t, d]) => (
          <button type="button" key={v} onClick={() => setF({ ...f, level: v })} className={`rounded-xl border p-3 text-left ${f.level === v ? "border-ink ring-2 ring-ink/10" : "border-line"}`}>
            <div className="text-sm font-bold">{t}</div>
            <div className="text-xs text-muted">{d}</div>
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Full name</label>
          <input className="input" required value={f.name} onChange={set("name")} placeholder="Ram Bahadur Thapa" />
        </div>
        <div>
          <label className="label">Business name</label>
          <input className="input" value={f.business} onChange={set("business")} placeholder="Thapa Electronics Traders" />
        </div>
        <div>
          <label className="label">Mobile</label>
          <input className="input" required value={f.phone} onChange={set("phone")} placeholder="+977 98…" />
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input" type="email" value={f.email} onChange={set("email")} />
        </div>
        <div>
          <label className="label">PAN (9 digits)</label>
          <input className="input num" required value={f.pan} onChange={set("pan")} inputMode="numeric" maxLength={9} placeholder="301234567" />
        </div>
        <div>
          <label className="label">City</label>
          <input className="input" value={f.city} onChange={set("city")} />
        </div>
      </div>
      {error && <p className="text-sm text-crimson">{error}</p>}
      <button className="btn-accent w-full py-3">Verify & create account</button>
      <p className="text-center text-[11px] text-muted">Demo: KYC checks are simulated and approve instantly.</p>
    </form>
  );
}
