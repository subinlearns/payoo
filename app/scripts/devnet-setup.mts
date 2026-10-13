/**
 * One-time chain setup for PAYOO_CHAIN_MODE=devnet|localnet.
 *
 *  - creates (or reuses) the operator, settlement-partner keys
 *  - creates a 6-decimal test USDC mint and mints a treasury float
 *  - initializes the payoo_escrow config + FX rate feed
 *  - writes everything the app needs to .data/chain-keys.json
 *
 * Usage:
 *   SOLANA_RPC_URL=https://api.devnet.solana.com npm run devnet:setup [-- --payer ~/.config/solana/id.json]
 *   SOLANA_RPC_URL=http://127.0.0.1:8899 npm run devnet:setup
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import bs58 from "bs58";
import anchor from "@coral-xyz/anchor";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";

const RPC = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const IS_LOCAL = /127\.0\.0\.1|localhost/.test(RPC);
const CLUSTER = IS_LOCAL ? "localnet" : "devnet";
const KEYS_FILE = path.resolve(process.env.PAYOO_KEYS_FILE || ".data/chain-keys.json");
const IDL = JSON.parse(fs.readFileSync(new URL("../src/lib/chain/payoo_escrow.json", import.meta.url), "utf8"));
const PROGRAM_ID = new PublicKey(process.env.PAYOO_PROGRAM_ID || IDL.address);
const TREASURY_FLOAT = 1_000_000; // test USDC

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

function loadKeypairFile(p: string) {
  const full = p.replace(/^~/, os.homedir());
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(full, "utf8"))));
}

const enc = (k: Keypair) => bs58.encode(k.secretKey);
const dec = (s: string) => Keypair.fromSecretKey(bs58.decode(s));

async function ensureSol(conn: Connection, who: PublicKey, min: number) {
  const bal = await conn.getBalance(who);
  if (bal >= min * LAMPORTS_PER_SOL) return;
  console.log(`  requesting airdrop for ${who.toBase58()}…`);
  try {
    const sig = await conn.requestAirdrop(who, (IS_LOCAL ? 100 : 2) * LAMPORTS_PER_SOL);
    await conn.confirmTransaction(sig, "confirmed");
  } catch (e) {
    console.error(
      `\nAirdrop failed (${(e as Error).message}).\nFund ${who.toBase58()} with devnet SOL at https://faucet.solana.com and re-run.`,
    );
    process.exit(1);
  }
}

async function liveRates() {
  try {
    const r = (await (await fetch("https://open.er-api.com/v6/latest/USD")).json()) as { rates: Record<string, number> };
    return { usdCny: r.rates.CNY, usdNpr: r.rates.NPR };
  } catch {
    return { usdCny: 6.71, usdNpr: 153.4 };
  }
}

async function main() {
  const conn = new Connection(RPC, "confirmed");
  console.log(`Payoo chain setup → ${CLUSTER} (${RPC})`);

  const program = await conn.getAccountInfo(PROGRAM_ID);
  if (!program?.executable) {
    console.error(
      `\nProgram ${PROGRAM_ID.toBase58()} is not deployed on ${CLUSTER}.\n` +
        `Deploy it first from the repo root:  anchor build && anchor deploy --provider.cluster ${CLUSTER}\n` +
        `(or: solana program deploy target/deploy/payoo_escrow.so --program-id target/deploy/payoo_escrow-keypair.json)`,
    );
    process.exit(1);
  }

  const existing = fs.existsSync(KEYS_FILE) && !process.argv.includes("--force")
    ? JSON.parse(fs.readFileSync(KEYS_FILE, "utf8"))
    : null;

  const payerPath = arg("--payer");
  const operator = payerPath ? loadKeypairFile(payerPath) : existing ? dec(existing.operator) : Keypair.generate();
  const partner = existing ? dec(existing.partner) : Keypair.generate();
  console.log(`  operator / admin / oracle: ${operator.publicKey.toBase58()}`);
  console.log(`  settlement partner:        ${partner.publicKey.toBase58()}`);
  await ensureSol(conn, operator.publicKey, 0.5);

  const usdcMint = existing?.usdcMint
    ? new PublicKey(existing.usdcMint)
    : await createMint(conn, operator, operator.publicKey, null, 6);
  console.log(`  test USDC mint:            ${usdcMint.toBase58()}`);
  const treasury = await getOrCreateAssociatedTokenAccount(conn, operator, usdcMint, operator.publicKey);
  const settlement = await getOrCreateAssociatedTokenAccount(conn, operator, usdcMint, partner.publicKey);
  if (Number(treasury.amount) < 1_000 * 1e6) {
    await mintTo(conn, operator, usdcMint, treasury.address, operator, BigInt(TREASURY_FLOAT * 1e6));
    console.log(`  minted ${TREASURY_FLOAT.toLocaleString()} test USDC to treasury ${treasury.address.toBase58()}`);
  }

  const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(operator), { commitment: "confirmed" });
  const prog = new anchor.Program({ ...IDL, address: PROGRAM_ID.toBase58() }, provider);
  const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
  const [rateFeed] = PublicKey.findProgramAddressSync([Buffer.from("rate")], PROGRAM_ID);

  if (await conn.getAccountInfo(config)) {
    console.log(`  config already initialized at ${config.toBase58()}`);
  } else {
    const rates = await liveRates();
    const sig = await prog.methods
      .initialize({
        operator: operator.publicKey,
        oracleAuthority: operator.publicKey,
        settlementPartner: partner.publicKey,
        feeBps: 100,
        maxQuoteDeviationBps: 100,
        maxRateStalenessSecs: 900,
        disputeWindowSecs: 3 * 24 * 3600,
        maxOrderUsdc: new anchor.BN(50_000 * 1e6),
        usdCnyE6: new anchor.BN(Math.round(rates.usdCny * 1e6)),
        usdNprE6: new anchor.BN(Math.round(rates.usdNpr * 1e6)),
      })
      .accountsPartial({
        admin: operator.publicKey,
        config,
        rateFeed,
        usdcMint,
        treasury: treasury.address,
      })
      .rpc();
    console.log(`  initialized config ${config.toBase58()} (tx ${sig})`);
  }

  fs.mkdirSync(path.dirname(KEYS_FILE), { recursive: true });
  fs.writeFileSync(
    KEYS_FILE,
    JSON.stringify(
      {
        cluster: CLUSTER,
        rpcUrl: RPC,
        admin: enc(operator),
        operator: enc(operator),
        oracle: enc(operator),
        partner: enc(partner),
        usdcMint: usdcMint.toBase58(),
        treasury: treasury.address.toBase58(),
        settlementTokenAccount: settlement.address.toBase58(),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(`\nWrote ${KEYS_FILE}\nNow run:  PAYOO_CHAIN_MODE=${CLUSTER} SOLANA_RPC_URL=${RPC} npm run dev`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
