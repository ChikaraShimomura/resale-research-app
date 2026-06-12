import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import BottomNav from "../components/BottomNav";
import { PRIVACY_MD } from "./content";

export const metadata: Metadata = {
  title: "プライバシーポリシー",
  description:
    "輸出ラボのプライバシーポリシー。取得する情報・Cookie・アクセス解析(Google Analytics)・eBay連携・楽天アフィリエイト・第三者提供・外部送信などの取り扱いについて。",
  alternates: { canonical: "https://www.yushutsu-fukugyo.com/privacy" },
};

// ── このポリシーで使うMarkdown構文だけを描画する軽量レンダラ ──
// 対応: 見出し(#/##/###) / 段落 / 箇条書き(-) / 表(|...|) / インライン(**太字** `コード` URL メール)
function renderInline(text: string, kp: string) {
  const parts = text.split(
    /(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s)）、]+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g
  );
  return parts.map((p, i) => {
    if (!p) return null;
    const key = `${kp}-${i}`;
    if (p.startsWith("**") && p.endsWith("**"))
      return <strong key={key} className="font-bold text-gray-900">{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`"))
      return <code key={key} className="bg-gray-100 text-gray-800 rounded px-1 py-0.5 text-[12px] font-mono break-all">{p.slice(1, -1)}</code>;
    if (/^https?:\/\//.test(p))
      return <a key={key} href={p} target="_blank" rel="noopener noreferrer" className="text-[#BF0000] underline break-all">{p}</a>;
    if (/@/.test(p))
      return <a key={key} href={`mailto:${p}`} className="text-[#BF0000] underline break-all">{p}</a>;
    return <span key={key}>{p}</span>;
  });
}

function splitRow(line: string) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((s) => s.trim());
}

function PrivacyBody({ md }: { md: string }) {
  const lines = md.split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      if (level === 1) out.push(<h1 key={k} className="text-xl font-black text-gray-900 mb-1">{renderInline(h[2], `h${k}`)}</h1>);
      else if (level === 2) out.push(
        <h2 key={k} className="flex items-center gap-2 text-[15px] font-black text-gray-900 mt-7 mb-2">
          <span aria-hidden="true" className="w-1 h-4 bg-[#BF0000] rounded-full shrink-0" />{renderInline(h[2], `h${k}`)}
        </h2>
      );
      else out.push(<h3 key={k} className="text-sm font-black text-gray-800 mt-4 mb-1.5">{renderInline(h[2], `h${k}`)}</h3>);
      k++; i++; continue;
    }

    if (line.trim().startsWith("|") && lines[i + 1] && /^\s*\|[-\s|]+\|\s*$/.test(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) { rows.push(splitRow(lines[i])); i++; }
      out.push(
        <div key={k} className="overflow-x-auto my-3">
          <table className="w-full text-[12px] border border-gray-200 rounded-lg border-separate border-spacing-0">
            <thead>
              <tr className="bg-gray-50">
                {header.map((c, ci) => (
                  <th key={ci} className="text-left font-bold text-gray-700 px-2.5 py-2 border-b border-gray-200 whitespace-nowrap">{renderInline(c, `th${k}-${ci}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci} className="align-top px-2.5 py-2 text-gray-600 border-b border-gray-100">{renderInline(c, `td${k}-${ri}-${ci}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      k++; continue;
    }

    if (/^\s*-\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*-\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*-\s+/, "")); i++; }
      out.push(
        <ul key={k} className="space-y-1.5 my-2">
          {items.map((it, ii) => (
            <li key={ii} className="flex gap-2 text-[13px] text-gray-600 leading-relaxed">
              <span aria-hidden="true" className="mt-[7px] shrink-0 w-1 h-1 rounded-full bg-[#BF0000]" />
              <span>{renderInline(it, `li${k}-${ii}`)}</span>
            </li>
          ))}
        </ul>
      );
      k++; continue;
    }

    out.push(<p key={k} className="text-[13px] text-gray-600 leading-relaxed mb-3">{renderInline(line, `p${k}`)}</p>);
    k++; i++;
  }
  return <>{out}</>;
}

export default function PrivacyPage() {
  return (
    <div className="min-h-dvh bg-[#F5F7FA] pb-nav">
      <header className="bg-[#BF0000] sticky top-0 z-20 shadow-sm" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="px-3 py-3 flex items-center gap-2 max-w-2xl mx-auto">
          <Link href="/search" aria-label="戻る"
            className="w-10 h-10 flex items-center justify-center rounded-full bg-white/20 text-white text-xl font-bold shrink-0 active:scale-95">
            ‹
          </Link>
          <h1 className="text-white font-black text-base">プライバシーポリシー</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-3">
        <article className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <PrivacyBody md={PRIVACY_MD} />
        </article>
      </main>

      <BottomNav />
    </div>
  );
}
