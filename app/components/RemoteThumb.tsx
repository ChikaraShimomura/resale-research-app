"use client";

import { useState } from "react";

// 外部ホットリンク画像（中古サイトの1点物・失効しやすい）の安全なサムネ。
// 読み込み失敗時は壊れた画像アイコンではなくグレーのプレースホルダに差し替える。className でサイズ/角丸を指定。
export default function RemoteThumb({ src, alt = "", className = "" }: { src?: string; alt?: string; className?: string }) {
  const [bad, setBad] = useState(false);
  if (!src || bad) return <div className={`${className} bg-gray-100`} aria-hidden="true" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setBad(true)} className={`${className} object-cover bg-white`} />
  );
}
