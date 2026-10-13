import { NextResponse } from "next/server";
import { performAction, type Actor, type OrderAction } from "@/lib/orders";
import { currentUserId } from "@/lib/session";
import { apiError, jsonBody } from "@/lib/api";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { actor, ...action } = await jsonBody<OrderAction & { actor: Actor }>(req);
    const order = await performAction(id, actor, await currentUserId(), action as OrderAction);
    return NextResponse.json(order);
  } catch (e) {
    return apiError(e);
  }
}
