#!/usr/bin/env bash
# Android(Termux)/住宅IP機 で「売切検知ワーカー＋ギャラリー取得ワーカー」を常駐させるループ。
# 使い方: bash ~/resale-research-app/scripts/termux-run.sh
# 事前: Android設定→アプリ→Termux→電池→「制限なし」/ 充電しっぱ / 家のWiFi接続。通知の Acquire Wakelock 推奨。
#  - 売切検知(liveness): 毎サイクル(既定1h)実行
#  - ギャラリー取得(gallery): GALLERY_EVERY_CYCLES ごと(既定6=約6h)＋起動直後に1回(バックフィル)。ONESHOTで1巡。
#  - eBay直近落札(ebay-sold): SOLD_EVERY_CYCLES ごと(既定24≒1日)。住宅IP必須(DC IPは403)。
#      現在出品相場→実落札中央値で利益判定を是正＋直近30日の落札件数(需要)を収集。
INTERVAL="${LIVENESS_INTERVAL_SEC:-3600}"          # 売切検知の間隔(秒・既定1h)
GALLERY_EVERY="${GALLERY_EVERY_CYCLES:-6}"          # 何サイクルごとにギャラリー取得するか(既定6≒6h)
SOLD_EVERY="${SOLD_EVERY_CYCLES:-24}"              # 何サイクルごとにeBay落札価格を取得するか(既定24≒1日)
cd "$HOME/resale-research-app" || exit 1

termux-wake-lock 2>/dev/null || true                # 省電力でCPUが寝て止まるのを防ぐ(Termux:API無ければ無視)

echo "ワーカー常駐開始: 売切検知=毎${INTERVAL}秒 / ギャラリー=${GALLERY_EVERY}サイクルごと / eBay落札=${SOLD_EVERY}サイクルごと。ログ: ~/liveness.log ~/gallery.log ~/ebaysold.log"
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

  # ③ eBay直近落札の取得(起動直後＝cycle0＋24サイクルごと≒1日・本番書込)。住宅IPのPixelだから403を避けられる。
  #    現在出品相場(吊り値)で過大評価された赤字商品を実落札で是正＋落札件数(需要)を収集。
  if [ $(( cycle % SOLD_EVERY )) -eq 0 ]; then
    echo "---- $(date) ebay-sold ----" >> "$HOME/ebaysold.log"
    EBAY_SOLD_DRY=0 node scripts/ebaySoldWorker.mjs >> "$HOME/ebaysold.log" 2>&1 \
      || echo "  (ebay-sold失敗・次回再試行)" >> "$HOME/ebaysold.log"
  fi

  cycle=$(( cycle + 1 ))
  sleep "$INTERVAL"
done
