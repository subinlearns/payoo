import { NextResponse } from "next/server";
import { ServiceError } from "./orders";

export function apiError(e: unknown) {
  if (e instanceof ServiceError) return NextResponse.json({ error: e.message }, { status: e.status });
  console.error(e);
  return NextResponse.json({ error: (e as Error).message ?? "Unexpected error" }, { status: 500 });
}

export async function jsonBody<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ServiceError("Invalid JSON body");
  }
}
