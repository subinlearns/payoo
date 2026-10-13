import { NextResponse } from "next/server";
import { resetDb } from "@/lib/db";
import { USER_COOKIE } from "@/lib/session";

export async function POST() {
  resetDb();
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(USER_COOKIE);
  return res;
}
