"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Mail, Lock } from "lucide-react";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState<"register" | "verify">("register");
  const [userId, setUserId] = useState("");
  const [code, setCode] = useState("");

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (password !== passwordConfirm) { setError("パスワードが一致しません"); return; }
    if (password.length < 8) { setError("パスワードは8文字以上で入力してください"); return; }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      setUserId(data.userId);
      setStep("verify");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/verify-2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, code, rememberMe: true }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      router.push("/search");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <Link href="/" className="font-bold text-2xl text-indigo-600 mb-8">輸出で副業しようよ</Link>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm w-full max-w-sm p-8">
        {step === "register" ? (
          <>
            <h1 className="text-xl font-bold text-gray-900 text-center mb-6">新規登録</h1>
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">メールアドレス</label>
                <div className="relative">
                  <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                    className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="you@example.com" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">パスワード（8文字以上）</label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input type={showPw ? "text" : "password"} required value={password} onChange={e => setPassword(e.target.value)}
                    className="w-full pl-9 pr-10 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="パスワード" />
                  <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">パスワード確認</label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input type={showPw ? "text" : "password"} required value={passwordConfirm} onChange={e => setPasswordConfirm(e.target.value)}
                    className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="パスワード（再入力）" />
                </div>
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <button type="submit" disabled={loading}
                className="w-full py-3 bg-indigo-600 text-white rounded-xl font-medium text-sm hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                {loading ? "送信中..." : "登録してコードを受け取る"}
              </button>
            </form>
            <p className="text-sm text-gray-500 text-center mt-4">
              すでにアカウントをお持ちの方は{" "}
              <Link href="/login" className="text-indigo-600 hover:underline">ログイン</Link>
            </p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold text-gray-900 text-center mb-2">メール認証</h1>
            <p className="text-sm text-gray-500 text-center mb-6">
              <span className="font-medium text-gray-700">{email}</span> に<br />
              6桁のコードを送信しました
            </p>
            <form onSubmit={handleVerify} className="space-y-4">
              <input
                type="text" inputMode="numeric" maxLength={6} required
                value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))}
                className="w-full text-center text-3xl font-bold tracking-widest py-4 border-2 border-gray-300 rounded-xl focus:outline-none focus:border-indigo-500"
                placeholder="000000"
              />
              {error && <p className="text-sm text-red-500 text-center">{error}</p>}
              <button type="submit" disabled={loading || code.length !== 6}
                className="w-full py-3 bg-indigo-600 text-white rounded-xl font-medium text-sm hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                {loading ? "確認中..." : "確認して登録完了"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
