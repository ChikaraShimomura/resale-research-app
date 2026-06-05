import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/app/lib/prisma";
import { generateCode } from "@/app/lib/auth-helpers";
import { sendTwoFactorEmail } from "@/app/lib/email";

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();

  if (!email || !password || password.length < 8) {
    return NextResponse.json({ error: "メールアドレスとパスワード（8文字以上）を入力してください" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "このメールアドレスはすでに登録されています" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({ data: { email, passwordHash } });

  const code = generateCode();
  await prisma.twoFactorCode.create({
    data: {
      userId: user.id,
      code,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10分
    },
  });

  await sendTwoFactorEmail(email, code);

  return NextResponse.json({ userId: user.id, message: "認証コードを送信しました" });
}
