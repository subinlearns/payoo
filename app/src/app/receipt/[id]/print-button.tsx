"use client";

export function PrintButton() {
  return (
    <button className="btn-ghost" onClick={() => window.print()}>
      Print / save PDF
    </button>
  );
}
