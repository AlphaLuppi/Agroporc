import { NextRequest, NextResponse } from "next/server";
import { checkPassword, signAdminToken, ADMIN_COOKIE, COOKIE_MAX_AGE } from "@/lib/adminAuth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const { password } = (await request.json()) as { password?: string };
    if (!password || !checkPassword(password)) {
      return NextResponse.json({ error: "Mot de passe invalide" }, { status: 401 });
    }
    const res = NextResponse.json({ ok: true });
    res.cookies.set(ADMIN_COOKIE, signAdminToken(), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: COOKIE_MAX_AGE,
    });
    return res;
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }
}
