"use server";
// メアド+パスワード認証のServer Action群（Supabase Auth）。env未設定なら無効を返す（認証は任意・非破壊）。
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { createSupabaseServerClient, isSupabaseConfigured } from "../lib/supabase/server";
import { migrateDeviceDataToAccount } from "../lib/auth/migrate";
import { recordRegisteredUser } from "../lib/auth/admin";
import { recordFunnelEvent } from "../lib/funnelServer";
import { captureSignupReferral } from "../lib/referralServer";
import type { AuthState } from "./types";

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

// eBayのエラー文をユーザー向け日本語に丸める（内部メッセージを露出しない）。
function jpError(msg: string): string {
  const m = (msg || "").toLowerCase();
  if (m.includes("invalid login")) return "メールアドレスかパスワードが違います。";
  if (m.includes("already") && m.includes("regist")) return "このメールアドレスは既に登録済みです。";
  if (m.includes("password")) return "パスワードは8文字以上にしてください。";
  if (m.includes("email")) return "メールアドレスの形式を確認してください。";
  if (m.includes("rate") || m.includes("too many")) return "回数が多すぎます。時間をおいて再度お試しください。";
  return "うまくいきませんでした。時間をおいて再度お試しください。";
}

// サインイン成功時、この端末(rr_did)のゲストデータをアカウントへ引き継ぐ。
async function migrateOnSignIn(userId: string): Promise<void> {
  const did = (await cookies()).get("rr_did")?.value;
  if (did) await migrateDeviceDataToAccount(did, `acct:${userId}`);
}

// 会員登録(ログイン)コンバージョンを計上。from=どのナッジ経由かの帰属（不明/未知は無視）。
async function recordSignup(formData: FormData): Promise<void> {
  await recordFunnelEvent("signup");
  const from = String(formData.get("from") ?? "").trim();
  if (from) await recordFunnelEvent(`signup_from_${from}`); // allowlist 外は recordFunnelEvent 側で無視
}

// ログイン後の遷移先。フォームの next を受けるが、オープンリダイレクト防止のため
// 「自サイト内の相対パス（/で始まり//や/\で始まらない）」のみ許可。それ以外は既定の /catalog。
function safeNext(formData: FormData): string {
  const raw = String(formData.get("next") ?? "").trim();
  if (raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\")) return raw;
  return "/catalog";
}

export async function signInAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  if (!isSupabaseConfigured()) return { error: "現在ログイン機能は無効です。" };
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "メールアドレスとパスワードを入力してください。" };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: jpError(error.message) };
  if (data.user) {
    await migrateOnSignIn(data.user.id);
    await recordSignup(formData);
    await recordRegisteredUser(data.user.email); // 身内指定の候補リストに記録
  }
  // 申込導線(from=checkout)から来た場合は /pricing?resume=<plan> へ戻し、Checkout を自動再開できるようにする。
  redirect(safeNext(formData));
}

export async function signUpAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  if (!isSupabaseConfigured()) return { error: "現在ログイン機能は無効です。" };
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email) return { error: "メールアドレスを入力してください。" };
  if (password.length < 8) return { error: "パスワードは8文字以上にしてください。" };
  // 利用規約・プライバシーポリシーへの同意はサーバー側でも必須化（直POST/JS無効で未同意登録を防ぐ）。
  if (String(formData.get("agree") ?? "") !== "on") return { error: "利用規約とプライバシーポリシーへの同意が必要です。" };

  // 確認メール経由でも帰属を保てるよう、from を confirm リンクに引き継ぐ。
  const from = String(formData.get("from") ?? "").trim();
  const fromQ = from ? `&from=${encodeURIComponent(from)}` : "";
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${await origin()}/auth/confirm?next=/catalog${fromQ}` },
  });
  if (error) return { error: jpError(error.message) };
  // メール確認OFFなら即セッション → 移行してアプリへ。ONなら確認メール待ち（登録計上は confirm 側）。
  if (data.session && data.user) {
    await migrateOnSignIn(data.user.id);
    await recordSignup(formData);
    await recordRegisteredUser(data.user.email); // 身内指定の候補リストに記録
    await captureSignupReferral(); // 紹介コード(ref cookie)があれば成果1件を計上
    redirect("/catalog");
  }
  return { message: "確認メールを送りました。メール内のリンクを開くと登録が完了します。" };
}

export async function signOutAction(): Promise<void> {
  if (isSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  redirect("/catalog");
}

export async function requestResetAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  if (!isSupabaseConfigured()) return { error: "現在ログイン機能は無効です。" };
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "メールアドレスを入力してください。" };

  const supabase = await createSupabaseServerClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${await origin()}/auth/confirm?next=/reset-password/update`,
  });
  // メール存在の有無を漏らさないため、常に同じ成功メッセージを返す。
  return { message: "パスワード再設定メールを送りました（登録があれば届きます）。" };
}

export async function updatePasswordAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  if (!isSupabaseConfigured()) return { error: "現在ログイン機能は無効です。" };
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) return { error: "パスワードは8文字以上にしてください。" };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: jpError(error.message) };
  redirect("/catalog");
}
