import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/app/lib/prisma";
import { generateCode } from "@/app/lib/auth-helpers";
import { sendTwoFactorEmail } from "@/app/lib/email";

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return NextResponse.json({ error: "メールアドレスまたはパスワードが間違っています" }, { status: 401 });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "メールアドレスまたはパスワードが間違っています" }, { status: 401 });
  }

  const code = generateCode();
  await prisma.twoFactorCode.create({
    data: {
      userId: user.id,
      code,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  await sendTwoFactorEmail(email, code);

  return NextResponse.json({ userId: user.id, message: "認証コードを送信しました" });
}
