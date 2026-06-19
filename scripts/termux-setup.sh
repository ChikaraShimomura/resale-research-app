#!/usr/bin/env bash
# Android(Termux)で「楽天 売切/削除 見張りワーカー」を動かすための一括セットアップ。
# 使い方(スマホのTermuxで1行):
#   pkg install git -y && git clone https://github.com/ChikaraShimomura/resale-research-app.git && bash resale-research-app/scripts/termux-setup.sh
# KV鍵(2つ)だけ後から聞かれるので、PCの .env.local からスマホへ移して貼り付ける。
set -e
say() { printf "\n\033[1m%s\033[0m\n" "$1"; }

say "[1/4] 必要なものを入れています (node / git)…"
pkg update -y >/dev/null 2>&1 || true
pkg install -y nodejs git >/dev/null 2>&1
node -v >/dev/null 2>&1 || { echo "node の導入に失敗。pkg install nodejs を手動で試してください"; exit 1; }
echo "  node $(node -v) / git $(git --version | awk '{print $3}') OK"

say "[2/4] コードを最新にしています…"
cd "$HOME/resale-research-app"
git pull --ff-only >/dev/null 2>&1 || true
echo "  OK"

say "[3/4] KVの鍵を設定します（PCの .env.local からコピーした値を貼ってEnter）"
if [ -f .env.local ] && grep -q "KV_REST_API_TOKEN" .env.local; then
  echo "  既に .env.local があります。作り直す場合は rm .env.local してから再実行。スキップします。"
else
  printf "  KV_REST_API_URL を貼ってEnter: "; read -r KV_URL
  printf "  KV_REST_API_TOKEN を貼ってEnter: "; read -r KV_TOKEN
  if [ -z "$KV_URL" ] || [ -z "$KV_TOKEN" ]; then echo "  鍵が空です。中止。"; exit 1; fi
  printf "KV_REST_API_URL=%s\nKV_REST_API_TOKEN=%s\n" "$KV_URL" "$KV_TOKEN" > .env.local
  echo "  .env.local を作成しました"
fi

say "[4/4] お試し実行（DRY＝書き込みなし）"
LIVENESS_DRY=1 node scripts/sourceLivenessWorker.mjs || { echo "  実行に失敗。鍵が正しいか確認してください。"; exit 1; }

say "✅ セットアップ完了！"
echo "  常時稼働(毎時・本番)を始めるには、次の1行を実行:"
echo "      bash ~/resale-research-app/scripts/termux-run.sh"
echo "  ※先にAndroidの設定→アプリ→Termux→電池→「制限なし」にし、充電しっぱ＋家のWiFiで。"
