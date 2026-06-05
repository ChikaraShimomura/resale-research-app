export interface Genre {
  id: string;
  label: string;
  emoji: string;
  description: string;
  color: string;
}

export const GENRES: Genre[] = [
  { id: "trading-card", label: "トレカ", emoji: "🃏", description: "ポケモン・遊戯王・ワンピースなど", color: "bg-red-50 border-red-200 text-red-700" },
  { id: "gunpla", label: "ガンプラ", emoji: "🤖", description: "MG・RG・HGなど", color: "bg-blue-50 border-blue-200 text-blue-700" },
  { id: "lego", label: "LEGO", emoji: "🧱", description: "テクニック・スターウォーズなど", color: "bg-yellow-50 border-yellow-200 text-yellow-700" },
  { id: "game", label: "ゲーム", emoji: "🎮", description: "Switch・PS5ソフト・本体", color: "bg-purple-50 border-purple-200 text-purple-700" },
  { id: "cosme", label: "コスメ・美容", emoji: "💄", description: "日焼け止め・スキンケアなど", color: "bg-pink-50 border-pink-200 text-pink-700" },
  { id: "figure", label: "フィギュア", emoji: "🗿", description: "アニメ・ゲームキャラクターなど", color: "bg-indigo-50 border-indigo-200 text-indigo-700" },
  { id: "toy", label: "おもちゃ", emoji: "🧸", description: "人気キャラクター・知育玩具など", color: "bg-orange-50 border-orange-200 text-orange-700" },
  { id: "electronics", label: "家電・ガジェット", emoji: "📱", description: "スマホ周辺・イヤホンなど", color: "bg-cyan-50 border-cyan-200 text-cyan-700" },
  { id: "sports", label: "スポーツ用品", emoji: "⚽", description: "シューズ・ウェアなど", color: "bg-green-50 border-green-200 text-green-700" },
  { id: "fashion", label: "ファッション", emoji: "👕", description: "ブランド・限定品など", color: "bg-rose-50 border-rose-200 text-rose-700" },
];
