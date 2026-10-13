"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export async function postJson<T = unknown>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

/** Posts an order action, then refreshes the server-rendered page. */
export function ActionButton({
  orderId,
  body,
  children,
  className = "btn-primary",
  confirm,
}: {
  orderId: string;
  body: Record<string, unknown>;
  children: React.ReactNode;
  className?: string;
  confirm?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function run() {
    if (confirm && !window.confirm(confirm)) return;
    setBusy(true);
    setError(null);
    try {
      await postJson(`/api/orders/${orderId}/actions`, body);
      startTransition(() => router.refresh());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button type="button" onClick={run} disabled={busy} className={className}>
        {busy ? (
          <>
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Signing…
          </>
        ) : (
          children
        )}
      </button>
      {error && <span className="max-w-xs text-xs text-crimson">{error}</span>}
    </span>
  );
}
