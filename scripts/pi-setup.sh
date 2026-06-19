#!/usr/bin/env bash
# Raspberry Pi(Raspberry Pi OS / Debian系)で「楽天 売切/削除 見張りワーカー」を24/7常駐させる一括セットアップ。
# 使い方(Piのターミナルで1行・SSHならPCからコピペで貼れる):
#   sudo apt-get update && sudo apt-get install -y git && git clone https://github.com/ChikaraShimomura/resale-research-app.git && bash resale-research-app/scripts/pi-setup.sh
# KV鍵(2つ)は後から聞かれるので、PCの .env.local の値を貼る。
# Pi は cron で毎時自動実行＝Termuxのループ/wake-lock不要・電源入れっぱ＋家WiFiでOK・再起動後も自動再開。
set -e
say() { printf "\n\033[1m%s\033[0m\n" "$1"; }

say "[1/5] Node.js と git を入れています…"
need_node=1
if command -v node >/dev/null 2>&1; then
  maj="$(node -v | sed 's/v//; s/\..*//')"
  [ "${maj:-0}" -ge 18 ] 2>/dev/null && need_node=0
fi
if [ "$need_node" = 1 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - >/dev/null 2>&1 || true
  sudo apt-get install -y nodejs >/dev/null 2>&1 || true
fi
sudo apt-get install -y git >/dev/null 2>&1 || true
node -v >/dev/null 2>&1 || { echo "node の導入に失敗。'sudo apt-get install -y nodejs' を手動で試してください。"; exit 1; }
echo "  node $(node -v) / git $(git --version | awk '{print $3}') OK"

say "[2/5] コードを最新にしています…"
cd "$HOME/resale-research-app"
git pull --ff-only >/dev/null 2>&1 || true
echo "  OK"

say "[3/5] KVの鍵を設定します（PCの .env.local の値を貼ってEnter）"
if [ -f .env.local ] && grep -q "KV_REST_API_TOKEN" .env.local; then
  echo "  既に .env.local があります。作り直す場合は rm .env.local してから再実行。スキップします。"
else
  printf "  KV_REST_API_URL を貼ってEnter: "; read -r KV_URL
  printf "  KV_REST_API_TOKEN を貼ってEnter: "; read -r KV_TOKEN
  KV_URL="${KV_URL#KV_REST_API_URL=}"; KV_URL="${KV_URL#KV_REST_API_TOKEN=}"
  KV_TOKEN="${KV_TOKEN#KV_REST_API_TOKEN=}"; KV_TOKEN="${KV_TOKEN#KV_REST_API_URL=}"
  KV_URL="$(printf '%s' "$KV_URL" | tr -d ' \t"'"'"'\r')"
  KV_TOKEN="$(printf '%s' "$KV_TOKEN" | tr -d ' \t"'"'"'\r')"
  [ -n "$KV_URL" ] && [ -n "$KV_TOKEN" ] || { echo "  鍵が空です。中止。"; exit 1; }
  printf "KV_REST_API_URL=%s\nKV_REST_API_TOKEN=%s\n" "$KV_URL" "$KV_TOKEN" > .env.local
  echo "  .env.local を作成しました"
fi

say "[4/5] お試し実行（DRY＝書き込みなし）"
LIVENESS_DRY=1 node scripts/sourceLivenessWorker.mjs || { echo "  実行に失敗。鍵が正しいか確認してください。"; exit 1; }

say "[5/5] 毎時の自動実行を cron に登録（本番）"
NODE_BIN="$(command -v node)"
LINE="0 * * * * cd $HOME/resale-research-app && { git pull -q 2>/dev/null; LIVENESS_DRY=0 $NODE_BIN scripts/sourceLivenessWorker.mjs; } >> $HOME/liveness.log 2>&1"
( crontab -l 2>/dev/null | grep -v "sourceLivenessWorker.mjs" ; echo "$LINE" ) | crontab -
echo "  cron登録完了: 毎時0分に本番実行（git pullで自動更新つき）。ログ: ~/liveness.log"

say "✅ ラズパイ常駐セットアップ完了！"
echo "  ・電源入れっぱ＋家のWiFi接続でOK（スリープ無し・再起動後も cron で自動再開）"
echo "  ・状態確認: tail -f ~/liveness.log"
echo "  ・PC側からの確認: node scripts/livenessStatus.mjs"
echo "  ・スマホ(Pixel)側のワーカーはもう止めてOK（Termuxのループを Ctrl+C → アプリ終了）"
echo "    ※Pi稼働を確認してから止めると安全（少しの二重稼働は無害）"
