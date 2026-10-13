import { randomBytes } from "node:crypto";
import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";
import { withDb } from "./db";
import { ServiceError } from "./orders";
import type { User } from "./types";

/** Onboarding: simulated KYC check + embedded wallet creation (no seed phrase shown to the user). */
export function registerUser(input: {
  name: string;
  business: string;
  city: string;
  phone: string;
  email: string;
  pan: string;
  level: "business" | "individual";
}): User {
  if (!input.name?.trim() || !input.phone?.trim()) throw new ServiceError("Name and phone are required");
  if (!/^\d{9}$/.test(input.pan?.trim() ?? "")) throw new ServiceError("PAN must be 9 digits");
  const kp = Keypair.generate();
  const now = new Date().toISOString();
  const user: User = {
    id: `usr_${randomBytes(5).toString("hex")}`,
    name: input.name.trim(),
    business: input.business?.trim() || input.name.trim(),
    city: input.city?.trim() || "Kathmandu",
    phone: input.phone.trim(),
    email: input.email?.trim() || "",
    pan: `${input.pan.trim().slice(0, 4)}XXXX${input.pan.trim().slice(-1)}`,
    kyc: { status: "verified", level: input.level === "individual" ? "individual" : "business", verifiedAt: now },
    wallet: { publicKey: kp.publicKey.toBase58(), secretKey: bs58.encode(kp.secretKey) },
    savingsUsdc: 0,
    createdAt: now,
  };
  withDb((d) => d.users.push(user));
  return user;
}
