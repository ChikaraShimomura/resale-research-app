#!/usr/bin/env bash
# Android(Termux)/住宅IP機 で「売切検知ワーカー＋ギャラリー取得ワーカー」を常駐させるループ。
# 使い方: bash ~/resale-research-app/scripts/termux-run.sh
# 事前: Android設定→アプリ→Termux→電池→「制限なし」/ 充電しっぱ / 家のWiFi接続。通知の Acquire Wakelock 推奨。
#  - 売切検知(liveness): 毎サイクル(既定1h)実行
#  - ギャラリー取得(gallery): GALLERY_EVERY_CYCLES ごと(既定6=約6h)＋起動直後に1回(バックフィル)。ONESHOTで1巡。
#  - eBay落札発掘(ebay-discover): SOLD_EVERY_CYCLES ごと(既定24≒1日)。住宅IP必須(DC IPは403)。
#      「売れた出品(Sold)」をキーワード別にスクレイプ→KV ebay_sold_seed。refresh(GitHub)が楽天マッチして
#      「実際に売れた実績つき」の利益商品を作る＝現在出品でなく実売起点で発掘（ユーザー指摘2026-06-23）。
INTERVAL="${LIVENESS_INTERVAL_SEC:-3600}"          # 売切検知の間隔(秒・既定1h)
GALLERY_EVERY="${GALLERY_EVERY_CYCLES:-6}"          # 何サイクルごとにギャラリー取得するか(既定6≒6h)
SOLD_EVERY="${SOLD_EVERY_CYCLES:-24}"              # 何サイクルごとにeBay落札価格を取得するか(既定24≒1日)
cd "$HOME/resale-research-app" || exit 1

termux-wake-lock 2>/dev/null || true                # 省電力でCPUが寝て止まるのを防ぐ(Termux:API無ければ無視)

echo "ワーカー常駐開始: 売切検知=毎${INTERVAL}秒 / ギャラリー=${GALLERY_EVERY}サイクルごと / eBay落札発掘=${SOLD_EVERY}サイクルごと。ログ: ~/liveness.log ~/gallery.log ~/ebaysold.log"
cycle=0
while true; do
  # 最新のワーカーコードへ毎回自動更新(PCで直せば次サイクルで反映)
  git pull --ff-only >/dev/null 2>&1 || true

  # ① 売切/削除検知(毎回・本番)
  echo "---- $(date) ----" >> "$HOME/liveness.log"
  LIVENESS_DRY=0 node scripts/sourceLivenessWorker.mjs >> "$HOME/liveness.log" 2>&1 \
    || echo "  (liveness失敗・次回再試行)" >> "$HOME/liveness.log"

  # ② ギャラリー取得(起動直後＝cycle0＋6サイクルごと・ONESHOTで1巡)
  if [ $(( cycle % GALLERY_EVERY )) -eq 0 ]; then
    echo "---- $(date) gallery ----" >> "$HOME/gallery.log"
    ONESHOT=1 CAP_PER_CYCLE="${CAP_PER_CYCLE:-30}" node scripts/galleryWorker.mjs >> "$HOME/gallery.log" 2>&1 \
      || echo "  (gallery失敗・次回再試行)" >> "$HOME/gallery.log"
  fi

  # ③ eBay落札発掘(起動直後＝cycle0＋24サイクルごと≒1日・本番書込)。住宅IPのPixelだから403を避けられる。
  #    「売れた出品」をキーワード別に集めて種(ebay_sold_seed)を作る→refreshが楽天マッチ。実売起点の発掘。
  if [ $(( cycle % SOLD_EVERY )) -eq 0 ]; then
    echo "---- $(date) ebay-discover ----" >> "$HOME/ebaysold.log"
    EBAY_SOLD_DISCOVER=1 EBAY_SOLD_DRY=0 EBAY_USED_GENRES=1 node scripts/ebaySoldWorker.mjs >> "$HOME/ebaysold.log" 2>&1 \
      || echo "  (ebay-discover失敗・次回再試行)" >> "$HOME/ebaysold.log"
  fi

  # ④ 中古カタログ(ハードオフ中古ジャンル)を週1で更新（2026-06-26 時計のみ→拡張：オーディオ/カメラ/ゲーム機/エフェクター）。
  #    候補構築(キャッシュ ebay_sold_seed × ハードオフ現在庫) → 型番リファイン(ブランド+型番でeBay落札→実値・同一型番のみ採用)。
  #    住宅IPのPixelだからHard Off/eBay落札とも取得可。168サイクル≒7日ごと(cycle%168==3でずらす)。
  if [ $(( cycle % 168 )) -eq 3 ]; then
    echo "---- $(date) used-watch-catalog ----" >> "$HOME/usedcatalog.log"
    if node scripts/used/buildUsedSampleFromCache.mjs >> "$HOME/usedcatalog.log" 2>&1; then
      node scripts/used/refineUsedCatalogEbay.mjs >> "$HOME/usedcatalog.log" 2>&1 \
        || echo "  (型番リファイン失敗・次週再試行)" >> "$HOME/usedcatalog.log"
    else
      echo "  (時計サンプル構築失敗・次週再試行)" >> "$HOME/usedcatalog.log"
    fi
  fi

  cycle=$(( cycle + 1 ))
  sleep "$INTERVAL"
done
