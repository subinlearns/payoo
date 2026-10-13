import { NextResponse } from "next/server";
import { getChain } from "@/lib/chain";
import { apiError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getChain().info());
  } catch (e) {
    return apiError(e);
  }
}
