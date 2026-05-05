import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const { password } = await request.json();
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword || password !== adminPassword) {
    return NextResponse.json({ error: "Mot de passe incorrect" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set("pdj-admin", "1", {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60,
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
  const adminCookie = request.cookies.get("pdj-admin");
  return NextResponse.json({ admin: adminCookie?.value === "1" });
}
