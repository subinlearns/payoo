import { AnchorChain } from "./anchor";
import { SimulatedChain } from "./simulated";
import type { ChainAdapter, ChainMode } from "./types";

const g = globalThis as unknown as { __payooChain?: { mode: ChainMode; adapter: ChainAdapter } };

export function chainMode(): ChainMode {
  const m = (process.env.PAYOO_CHAIN_MODE || "simulated").toLowerCase();
  return m === "devnet" || m === "localnet" ? m : "simulated";
}

export function getChain(): ChainAdapter {
  const mode = chainMode();
  if (g.__payooChain?.mode === mode) return g.__payooChain.adapter;
  const adapter = mode === "simulated" ? new SimulatedChain() : new AnchorChain(mode);
  g.__payooChain = { mode, adapter };
  return adapter;
}

export * from "./types";

/** Explorer link for a recorded tx; simulated/seed txs open the in-app ledger. */
export function txUrl(sig: string, simulated: boolean) {
  return simulated ? `/ledger/${sig}` : getChain().explorerTx(sig);
}
