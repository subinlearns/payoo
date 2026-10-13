import { NextResponse } from "next/server";
import { addSupplier } from "@/lib/orders";
import { currentUserId } from "@/lib/session";
import { apiError, jsonBody } from "@/lib/api";

export async function POST(req: Request) {
  try {
    const body = await jsonBody<Parameters<typeof addSupplier>[1]>(req);
    return NextResponse.json(addSupplier(await currentUserId(), body));
  } catch (e) {
    return apiError(e);
  }
}
