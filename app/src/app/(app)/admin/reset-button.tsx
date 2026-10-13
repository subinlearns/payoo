"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "@/components/action-button";

export function ResetButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn-ghost"
      disabled={busy}
      onClick={async () => {
        if (!window.confirm("Reset all demo data to the initial seed?")) return;
        setBusy(true);
        await postJson("/api/demo/reset");
        router.push("/dashboard");
        router.refresh();
      }}
    >
      {busy ? "Resetting…" : "Reset demo data"}
    </button>
  );
}
