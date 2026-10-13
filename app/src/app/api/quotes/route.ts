import { NextResponse } from "next/server";
import { createQuote } from "@/lib/orders";
import { currentUserId } from "@/lib/session";
import { apiError, jsonBody } from "@/lib/api";

export async function POST(req: Request) {
  try {
    const body = await jsonBody<{ supplierId: string; invoiceCny: number; invoiceRef: string; escrowMode: boolean }>(req);
    const quote = await createQuote(await currentUserId(), {
      supplierId: body.supplierId,
      invoiceCny: Number(body.invoiceCny),
      invoiceRef: String(body.invoiceRef ?? ""),
      escrowMode: Boolean(body.escrowMode),
    });
    return NextResponse.json(quote);
  } catch (e) {
    return apiError(e);
  }
}
