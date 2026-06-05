import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { generateToken } from "@/app/lib/auth-helpers";

export async function POST(req: NextRequest) {
  const { userId, code, rememberMe } = await req.json();

  const record = await prisma.twoFactorCode.findFirst({
    where: {
      userId,
      code,
      used: false,
      expiresAt: { gt: new Date() },
    },
  });

  if (!record) {
    return NextResponse.json({ error: "認証コードが無効または期限切れです" }, { status: 401 });
  }

  await prisma.twoFactorCode.update({ where: { id: record.id }, data: { used: true } });
  await prisma.user.update({ where: { id: userId }, data: { emailVerified: true } });

  const token = generateToken();
  const expiresAt = rememberMe
    ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30日
    : new Date(Date.now() + 24 * 60 * 60 * 1000);      // 1日

  await prisma.session.create({ data: { userId, token, expiresAt } });

  const res = NextResponse.json({ success: true });
  res.cookies.set("session_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });

  return res;
}
