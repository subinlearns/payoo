import { NextResponse } from "next/server";
import { getRates } from "@/lib/fx";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getRates());
}
