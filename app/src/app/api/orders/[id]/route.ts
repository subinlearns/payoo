import { NextResponse } from "next/server";
import { readDb } from "@/lib/db";
import { getChain } from "@/lib/chain";
import { apiError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const order = readDb().orders.find((o) => o.id === id);
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    const onchain = order.seeded ? null : await getChain().fetchOrder(id).catch(() => null);
    return NextResponse.json({ order, onchain });
  } catch (e) {
    return apiError(e);
  }
}
