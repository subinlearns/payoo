import { NextResponse } from "next/server";
import { payQuote } from "@/lib/orders";
import { currentUserId } from "@/lib/session";
import { apiError, jsonBody } from "@/lib/api";
import type { RailMethod } from "@/lib/types";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { method } = await jsonBody<{ method: RailMethod }>(req);
    const order = await payQuote(id, await currentUserId(), method);
    return NextResponse.json(order);
  } catch (e) {
    return apiError(e);
  }
}
