import { cookies } from "next/headers";
import { readDb } from "./db";
import { DEFAULT_USER_ID } from "./seed";

export const USER_COOKIE = "payoo_uid";

/** Demo session: the current buyer is picked by cookie (set during onboarding). */
export async function currentUserId() {
  const jar = await cookies();
  const id = jar.get(USER_COOKIE)?.value;
  const db = readDb();
  return id && db.users.some((u) => u.id === id) ? id : DEFAULT_USER_ID;
}

export async function currentUser() {
  const id = await currentUserId();
  return readDb().users.find((u) => u.id === id)!;
}
