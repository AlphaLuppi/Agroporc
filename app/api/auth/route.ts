import { NextRequest, NextResponse } from "next/server";
import { signAdminCookie, verifyAdminCookieValue, ADMIN_COOKIE_MAX_AGE } from "@/lib/adminAuth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const { password } = await request.json();
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword || password !== adminPassword) {
    return NextResponse.json({ error: "Mot de passe incorrect" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set("pdj-admin", signAdminCookie(), {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: ADMIN_COOKIE_MAX_AGE,
    path: "/",
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set("pdj-admin", "", { maxAge: 0, path: "/" });
  return response;
}

export async function GET(request: NextRequest) {
  const value = request.cookies.get("pdj-admin")?.value;
  return NextResponse.json({ admin: verifyAdminCookieValue(value) });
}
