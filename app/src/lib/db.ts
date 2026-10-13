import fs from "node:fs";
import path from "node:path";
import type { ChainTx, Order, Quote, Supplier, User } from "./types";
import type { SimChainState } from "./chain/simulated";
import { buildSeed } from "./seed";

export interface DbShape {
  version: 1;
  users: User[];
  suppliers: Supplier[];
  quotes: Quote[];
  orders: Order[];
  txs: ChainTx[];
  sim: SimChainState;
  createdAt: string;
}

const DATA_DIR = path.join(/* turbopackIgnore: true */ process.cwd(), ".data");
const DB_FILE = path.join(DATA_DIR, "payoo-db.json");

function load(): DbShape {
  if (!fs.existsSync(DB_FILE)) {
    const seed = buildSeed();
    save(seed);
    return seed;
  }
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8")) as DbShape;
}

function save(db: DbShape) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

/** Read-only snapshot. */
export function readDb(): DbShape {
  return load();
}

/** Read-modify-write. Synchronous, so a single Node process never interleaves writes. */
export function withDb<T>(fn: (db: DbShape) => T): T {
  const db = load();
  const out = fn(db);
  save(db);
  return out;
}

export function resetDb() {
  save(buildSeed());
}

export const dataDir = DATA_DIR;
