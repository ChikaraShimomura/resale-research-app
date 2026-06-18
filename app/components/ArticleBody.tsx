import Link from "next/link";
import type { ReactNode } from "react";

// 記事本文の軽量レンダラ。対応: 段落(空行区切り) / 箇条書き(- ) / **太字** / [テキスト](URL)リンク。
// 内部リンク(/で始まる)は next/link、外部は target=_blank。
function renderInline(text: string, kp: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((p, i) => {
    if (!p) return null;
    const key = `${kp}-${i}`;
    if (p.startsWith("**") && p.endsWith("**"))
      return <strong key={key} className="font-bold text-gray-900">{p.slice(2, -2)}</strong>;
    const m = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (m) {
      const [, label, href] = m;
      if (href.startsWith("/"))
        return <Link key={key} href={href} className="text-[#2D323B] font-medium underline underline-offset-2">{label}</Link>;
      return <a key={key} href={href} target="_blank" rel="noopener noreferrer" className="text-[#2D323B] font-medium underline underline-offset-2">{label}</a>;
    }
    return <span key={key}>{p}</span>;
  });
}

export default function ArticleBody({ body }: { body: string }) {
  const blocks = body.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return (
    <>
      {blocks.map((block, bi) => {
        const lines = block.split("\n");
        const isList = lines.length > 0 && lines.every((l) => /^-\s+/.test(l.trim()));
        if (isList) {
          return (
            <ul key={bi} className="my-3 space-y-1.5">
              {lines.map((l, li) => (
                <li key={li} className="flex gap-2 text-[14px] text-gray-700 leading-relaxed">
                  <span aria-hidden="true" className="mt-[8px] shrink-0 w-1.5 h-1.5 rounded-full bg-[#2D323B]" />
                  <span>{renderInline(l.replace(/^-\s+/, ""), `b${bi}-${li}`)}</span>
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={bi} className="my-3 text-[14px] text-gray-700 leading-relaxed">
            {renderInline(block, `p${bi}`)}
          </p>
        );
      })}
    </>
  );
}
