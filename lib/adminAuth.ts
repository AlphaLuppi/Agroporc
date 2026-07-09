import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

const COOKIE_MAX_AGE_S = 7 * 24 * 60 * 60; // 7 jours (comme l'existant)

function secret(): string {
  const s = process.env.ADMIN_PASSWORD;
  if (!s) throw new Error("ADMIN_PASSWORD non défini");
  return s;
}

/** Valeur de cookie signée : "expiry.hmac(expiry)". Non falsifiable sans le secret. */
export function signAdminCookie(): string {
  const expiry = Math.floor(Date.now() / 1000) + COOKIE_MAX_AGE_S;
  const sig = createHmac("sha256", secret()).update(String(expiry)).digest("hex");
  return `${expiry}.${sig}`;
}

export function verifyAdminCookieValue(value: string | undefined): boolean {
  if (!value) return false;
  const [expiryStr, sig] = value.split(".");
  if (!expiryStr || !sig) return false;
  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry) || expiry < Math.floor(Date.now() / 1000)) return false;
  const expected = createHmac("sha256", secret()).update(expiryStr).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const ADMIN_COOKIE_MAX_AGE = COOKIE_MAX_AGE_S;

/** Auth admin (App Router) : cookie pdj-admin signé. */
export async function isAdminRequest(): Promise<boolean> {
  const store = await cookies();
  return verifyAdminCookieValue(store.get("pdj-admin")?.value);
}

/** Vérifie le header Authorization: Bearer <API_SECRET_TOKEN> (appels VPS). */
export function verifyBearer(authHeader: string | null): boolean {
  const token = process.env.API_SECRET_TOKEN;
  return !!token && authHeader === `Bearer ${token}`;
}
