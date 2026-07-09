import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

export const ADMIN_COOKIE = "pdj_admin";
const MAX_AGE_S = 60 * 60 * 24 * 30; // 30 jours

function secret(): string {
  const s = process.env.ADMIN_PASSWORD;
  if (!s) throw new Error("ADMIN_PASSWORD non défini");
  return s;
}

/** Jeton = HMAC(expiry) sous forme "expiry.signature". */
export function signAdminToken(): string {
  const expiry = Math.floor(Date.now() / 1000) + MAX_AGE_S;
  const sig = createHmac("sha256", secret()).update(String(expiry)).digest("hex");
  return `${expiry}.${sig}`;
}

export function verifyAdminToken(token: string | undefined): boolean {
  if (!token) return false;
  const [expiryStr, sig] = token.split(".");
  if (!expiryStr || !sig) return false;
  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry) || expiry < Math.floor(Date.now() / 1000)) return false;
  const expected = createHmac("sha256", secret()).update(expiryStr).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Vérifie le mot de passe fourni au login (comparaison à temps constant). */
export function checkPassword(input: string): boolean {
  const s = secret();
  const a = Buffer.from(input);
  const b = Buffer.from(s);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Lit le cookie admin (App Router) et renvoie true si valide. */
export async function isAdminRequest(): Promise<boolean> {
  const store = await cookies();
  return verifyAdminToken(store.get(ADMIN_COOKIE)?.value);
}

export const COOKIE_MAX_AGE = MAX_AGE_S;

/** Vérifie le header Authorization: Bearer <API_SECRET_TOKEN>. */
export function verifyBearer(authHeader: string | null): boolean {
  const token = process.env.API_SECRET_TOKEN;
  return !!token && authHeader === `Bearer ${token}`;
}
