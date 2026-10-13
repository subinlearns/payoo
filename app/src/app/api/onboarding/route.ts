import { NextResponse } from "next/server";
import { registerUser } from "@/lib/users";
import { USER_COOKIE } from "@/lib/session";
import { apiError, jsonBody } from "@/lib/api";

export async function POST(req: Request) {
  try {
    const user = registerUser(await jsonBody(req));
    const res = NextResponse.json({ id: user.id, wallet: user.wallet.publicKey });
    res.cookies.set(USER_COOKIE, user.id, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 30 });
    return res;
  } catch (e) {
    return apiError(e);
  }
}
