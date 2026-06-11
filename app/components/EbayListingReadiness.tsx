"use client";
import { useEffect, useState } from "react";
import { BadgeCheck, AlertTriangle } from "lucide-react";

interface Readiness {
  connected: boolean;
  marketplace?: string;
  fulfillmentPolicies?: number;
  paymentPolicies?: number;
  returnPolicies?: number;
  locations?: number;
  ready?: boolean;
}

export default function EbayListingReadiness() {
  const [data, setData] = useState<Readiness | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/ebay/listing-readiness")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ connected: false }))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="mt-3 h-28 bg-gray-50 rounded-2xl animate-pulse" />;
  // 未連携時は何も出さない（EbayConnect が連携を案内する）
  if (!data?.connected) return null;

  const items = [
    { label: "配送ポリシー", ok: (data.fulfillmentPolicies ?? 0) > 0 },
    { label: "支払いポリシー", ok: (data.paymentPolicies ?? 0) > 0 },
    { label: "返品ポリシー", ok: (data.returnPolicies ?? 0) > 0 },
    { label: "在庫ロケーション", ok: (data.locations ?? 0) > 0 },
  ];
  const missingPolicy = !items[0].ok || !items[1].ok || !items[2].ok;

  return (
    <section className="mt-3 bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
      <h3 className="text-sm font-black text-gray-800 mb-1">写真だけ出品の準備状況</h3>
      <p className="text-[11px] text-gray-400 mb-3">
        出品APIで下書きを作るのに必要な項目です（{data.marketplace}）
      </p>
      <ul className="space-y-2">
        {items.map((it) => (
          <li key={it.label} className="flex items-center gap-2 text-sm">
            {it.ok ? (
              <BadgeCheck size={18} className="text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle size={18} className="text-amber-500 shrink-0" />
            )}
            <span className={it.ok ? "text-gray-700" : "text-gray-500"}>{it.label}</span>
            <span className={`ml-auto text-xs font-bold ${it.ok ? "text-emerald-600" : "text-amber-500"}`}>
              {it.ok ? "OK" : "未設定"}
            </span>
          </li>
        ))}
      </ul>

      {data.ready ? (
        <p className="mt-3 text-[13px] font-bold text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">
          準備OK！次のアップデートで「下書き自動作成」が使えるようになります。
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {missingPolicy && (
            <a
              href="https://www.bizpolicy.ebay.com/businesspolicy/manage"
              target="_blank"
              rel="noopener noreferrer"
              className="block text-[13px] font-bold text-[#BF0000] bg-[#BF0000]/5 border border-[#BF0000]/20 rounded-lg px-3 py-2 active:bg-[#BF0000]/10"
            >
              eBayでビジネスポリシーを設定する ›
            </a>
          )}
          <p className="text-[11px] text-gray-400 leading-relaxed">
            ※ ビジネスポリシー（支払い・返品・配送）はeBayの「アカウント設定 ＞ ビジネスポリシー」で有効化＆作成できます。在庫ロケーションは準備が整い次第、このアプリから作成できるようにします。
          </p>
        </div>
      )}
    </section>
  );
}
