import { cookies } from "next/headers";

/** Auth admin : réutilise le cookie pdj-admin posé par /api/auth. */
export async function isAdminRequest(): Promise<boolean> {
  const store = await cookies();
  return store.get("pdj-admin")?.value === "1";
}

/** Vérifie le header Authorization: Bearer <API_SECRET_TOKEN> (appels VPS). */
export function verifyBearer(authHeader: string | null): boolean {
  const token = process.env.API_SECRET_TOKEN;
  return !!token && authHeader === `Bearer ${token}`;
}
