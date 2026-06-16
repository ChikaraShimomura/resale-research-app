import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ARTICLES, getArticle } from "../articles";
import ArticleBody from "../../components/ArticleBody";
import BottomNav from "../../components/BottomNav";
import JsonLd from "../../components/JsonLd";
import { ArrowLeft, ArrowRight } from "lucide-react";

const SITE = "https://www.yushutsu-fukugyo.com";

export function generateStaticParams() {
  return ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const a = getArticle(slug);
  if (!a) return { title: "記事が見つかりません", robots: { index: false } };
  const url = `${SITE}/guide/${a.slug}`;
  return {
    title: a.title,
    description: a.metaDescription,
    alternates: { canonical: `/guide/${a.slug}` },
    openGraph: { title: a.title, description: a.metaDescription, type: "article", url },
    twitter: { card: "summary_large_image", title: a.title, description: a.metaDescription },
  };
}

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const a = getArticle(slug);
  if (!a) notFound();

  const url = `${SITE}/guide/${a.slug}`;
  const related = ARTICLES.filter((x) => x.slug !== a.slug);

  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        headline: a.title,
        description: a.metaDescription,
        inLanguage: "ja",
        mainEntityOfPage: url,
        author: { "@type": "Organization", name: "輸出ラボ" },
        publisher: { "@type": "Organization", name: "輸出ラボ" },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "ホーム", item: SITE },
          { "@type": "ListItem", position: 2, name: "ガイド", item: `${SITE}/guide` },
          { "@type": "ListItem", position: 3, name: a.title, item: url },
        ],
      },
      ...(a.faq.length
        ? [{
            "@type": "FAQPage",
            mainEntity: a.faq.map((f) => ({
              "@type": "Question",
              name: f.q,
              acceptedAnswer: { "@type": "Answer", text: f.a },
            })),
          }]
        : []),
    ],
  };

  return (
    <div className="min-h-dvh bg-[#F5F7FA] pb-nav">
      <JsonLd data={ld} />

      <header className="bg-gradient-to-r from-[#BF0000] to-[#9E0000] shadow-sm sticky top-0 z-20"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="px-3 py-2.5 flex items-center gap-2 max-w-2xl mx-auto">
          <Link href="/guide" aria-label="ガイドへ戻る"
            className="w-9 h-9 flex items-center justify-center rounded-full bg-white/20 text-white shrink-0 active:scale-95">
            <ArrowLeft size={18} />
          </Link>
          <span className="text-white font-black text-[15px] tracking-tight truncate">ガイド</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-5">
        {/* パンくず */}
        <nav className="text-[11px] text-gray-400 mb-3" aria-label="パンくず">
          <Link href="/" className="hover:text-[#BF0000]">ホーム</Link>
          <span className="mx-1">›</span>
          <Link href="/guide" className="hover:text-[#BF0000]">ガイド</Link>
        </nav>

        <article className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h1 className="text-xl font-black text-gray-900 leading-snug mb-3">{a.title}</h1>
          <p className="text-[14px] text-gray-700 leading-relaxed">{a.lead}</p>

          {a.sections.map((s, i) => (
            <section key={i} className="mt-6">
              <h2 className="flex items-center gap-2 text-[16px] font-black text-gray-900 mb-1">
                <span aria-hidden="true" className="w-1 h-5 bg-[#BF0000] rounded-full shrink-0" />
                {s.h2}
              </h2>
              <ArticleBody body={s.body} />
            </section>
          ))}

          {a.faq.length > 0 && (
            <section className="mt-8">
              <h2 className="flex items-center gap-2 text-[16px] font-black text-gray-900 mb-3">
                <span aria-hidden="true" className="w-1 h-5 bg-[#BF0000] rounded-full shrink-0" />
                よくある質問
              </h2>
              <div className="space-y-3">
                {a.faq.map((f, i) => (
                  <div key={i} className="bg-[#F5F7FA] rounded-xl p-3.5">
                    <p className="text-[13px] font-black text-gray-800 mb-1">Q. {f.q}</p>
                    <p className="text-[13px] text-gray-600 leading-relaxed">A. {f.a}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </article>

        {/* CTA */}
        <div className="mt-5 grid grid-cols-1 gap-2">
          <Link href="/ranking" className="flex items-center justify-center gap-1.5 h-12 bg-[#BF0000] text-white font-black text-sm rounded-xl active:bg-[#9E0000]">
            🔥 いま稼げる利益商品ランキングを見る <ArrowRight size={16} />
          </Link>
          <Link href="/search" className="flex items-center justify-center gap-1.5 h-11 bg-white border border-gray-200 text-gray-700 font-bold text-[13px] rounded-xl active:bg-gray-50">
            利益商品をさがす
          </Link>
        </div>

        {/* 関連記事（内部リンク） */}
        <section className="mt-7">
          <h2 className="text-[13px] font-black text-gray-700 mb-2">関連記事</h2>
          <div className="space-y-2">
            {related.map((r) => (
              <Link key={r.slug} href={`/guide/${r.slug}`}
                className="flex items-center gap-2 bg-white border border-gray-100 rounded-xl px-3.5 py-3 shadow-sm active:bg-gray-50">
                <span className="text-[13px] font-bold text-gray-800 leading-snug flex-1 min-w-0">{r.title}</span>
                <ArrowRight size={14} className="text-gray-400 shrink-0" />
              </Link>
            ))}
          </div>
        </section>
      </main>

      <BottomNav />
    </div>
  );
}
