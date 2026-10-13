import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import idl from "./payoo_escrow.json";

export const PROGRAM_ID = new PublicKey(process.env.PAYOO_PROGRAM_ID || idl.address);

export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const SYSTEM_PROGRAM_ID = new PublicKey("11111111111111111111111111111111");

export const uuidToBytes = (uuid: string) => {
  const hex = uuid.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error(`invalid order id ${uuid}`);
  return Buffer.from(hex, "hex");
};

export const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest();

export const configPda = () => PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID)[0];
export const rateFeedPda = () => PublicKey.findProgramAddressSync([Buffer.from("rate")], PROGRAM_ID)[0];
export const orderPda = (orderId: string) =>
  PublicKey.findProgramAddressSync([Buffer.from("order"), uuidToBytes(orderId)], PROGRAM_ID)[0];
export const vaultPda = (order: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from("vault"), order.toBuffer()], PROGRAM_ID)[0];

/** Anchor error code -> name/message, straight from the IDL. */
export const PROGRAM_ERRORS = new Map(idl.errors.map((e) => [e.code, { name: e.name, msg: e.msg }]));
export const programError = (name: string) => idl.errors.find((e) => e.name === name);
