import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { cookies } from "next/headers";

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get("session_token")?.value;

  if (token) {
    await prisma.session.deleteMany({ where: { token } });
  }

  const res = NextResponse.json({ success: true });
  res.cookies.delete("session_token");
  return res;
}
