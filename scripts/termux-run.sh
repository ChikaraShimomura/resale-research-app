#!/usr/bin/env bash
# Android(Termux)で売切ワーカーを「毎時ずっと」動かす常駐ループ。
# 使い方: bash ~/resale-research-app/scripts/termux-run.sh
# 事前に: Android設定→アプリ→Termux→電池→「制限なし」/ 充電しっぱ / 家のWiFi接続。
# 任意: Termux:API を入れると termux-wake-lock でドーズ(省電力での停止)を防げる。
INTERVAL="${LIVENESS_INTERVAL_SEC:-3600}"  # 既定1時間ごと
cd "$HOME/resale-research-app" || exit 1

termux-wake-lock 2>/dev/null || true  # 省電力でCPUが寝て止まるのを防ぐ(Termux:APIが無ければ無視)

echo "売切ワーカー常駐開始（${INTERVAL}秒ごと・本番モード）。ログ: ~/liveness.log"
while true; do
  echo "---- $(date) ----" >> "$HOME/liveness.log"
  git pull --ff-only >/dev/null 2>&1 || true   # 最新のワーカーコードへ毎回自動更新（PC側で直したら勝手に反映）
  LIVENESS_DRY=0 node scripts/sourceLivenessWorker.mjs >> "$HOME/liveness.log" 2>&1 || echo "  (この回は失敗・次回に再試行)" >> "$HOME/liveness.log"
  sleep "$INTERVAL"
done
