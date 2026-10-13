#!/usr/bin/env bash
# Runs the payoo_escrow integration suite against a throwaway local validator.
#
# Requires solana-test-validator, solana and solana-keygen on PATH, and the program
# built to target/deploy/payoo_escrow.so. Set ANCHOR_WALLET to reuse an existing
# keypair as the provider/admin wallet; otherwise a fresh one is generated.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROGRAM_ID="JDyePwDypafn8Yi9fZdzPYp7b4uztLKD9zZ3DfV4VxVy"
PROGRAM_SO="$ROOT/target/deploy/payoo_escrow.so"
RPC_URL="http://127.0.0.1:8899"

for bin in solana-test-validator solana solana-keygen; do
  command -v "$bin" >/dev/null || { echo "error: $bin not found on PATH" >&2; exit 1; }
done
[[ -f "$PROGRAM_SO" ]] || { echo "error: $PROGRAM_SO not found; build the program first" >&2; exit 1; }

if solana cluster-version -u localhost >/dev/null 2>&1; then
  echo "error: something is already serving $RPC_URL; stop it first" >&2
  exit 1
fi

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/payoo-test.XXXXXX")"
VALIDATOR_PID=""

cleanup() {
  if [[ -n "$VALIDATOR_PID" ]] && kill -0 "$VALIDATOR_PID" 2>/dev/null; then
    kill "$VALIDATOR_PID" 2>/dev/null || true
    wait "$VALIDATOR_PID" 2>/dev/null || true
  fi
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

echo "Starting solana-test-validator (ledger: $WORK_DIR/ledger)"
solana-test-validator --reset --quiet \
  --ledger "$WORK_DIR/ledger" \
  --bpf-program "$PROGRAM_ID" "$PROGRAM_SO" \
  >"$WORK_DIR/validator.log" 2>&1 &
VALIDATOR_PID=$!

for _ in $(seq 1 120); do
  if solana cluster-version -u localhost >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$VALIDATOR_PID" 2>/dev/null; then
    echo "error: validator exited during startup:" >&2
    cat "$WORK_DIR/validator.log" >&2
    exit 1
  fi
  sleep 0.5
done
solana cluster-version -u localhost >/dev/null 2>&1 || { echo "error: validator did not start in time" >&2; exit 1; }

WALLET="${ANCHOR_WALLET:-}"
if [[ -z "$WALLET" ]]; then
  WALLET="$WORK_DIR/wallet.json"
  solana-keygen new --no-bip39-passphrase --silent --force --outfile "$WALLET" >/dev/null
fi
solana airdrop 100 "$(solana-keygen pubkey "$WALLET")" -u localhost --keypair "$WALLET" >/dev/null

cd "$ROOT"
ANCHOR_PROVIDER_URL="$RPC_URL" ANCHOR_WALLET="$WALLET" \
  npx ts-mocha -p ./tsconfig.json -t 1000000 'tests/**/*.ts'
