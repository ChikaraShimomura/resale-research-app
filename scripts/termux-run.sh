#!/usr/bin/env bash
# Android(Termux)/住宅IP機 で「中古カタログの発掘・構築・精緻化ワーカー」を常駐させるループ。
# 使い方: bash ~/resale-research-app/scripts/termux-run.sh
# 事前: Android設定→アプリ→Termux→電池→「制限なし」/ 充電しっぱ / 家のWiFi接続。通知の Acquire Wakelock 推奨。
#  - eBay落札発掘(ebay-discover): SOLD_EVERY_CYCLES ごと(既定24≒1日)。住宅IP必須(DC IPは403)。
#      「売れた出品(Sold)」をキーワード別にスクレイプ→KV ebay_sold_seed。中古カタログ(build)がハードオフ照合で
#      「実際に売れた実績つき」の利益商品を作る＝現在出品でなく実売起点で発掘（ユーザー指摘2026-06-23）。
#  - 中古カタログ構築(build): 3サイクルごと(≒3h)。seed × ハードオフ現在庫 から利益候補。Anthropic不使用＝無料。
#  - ハードオフ売切検知(hardoff-liveness): 毎サイクル(既定1h)。used_catalog のハードオフ実ページを叩いて
#      売切(schema.org)/削除(404)なら used_source_status を立てる→getUsedCatalogが一覧から非表示(カタログ隠しのみ・dealには触れない)。
#  - 無在庫売切→自動停止(dropship-stop): 毎サイクル。ebay_deals の「無在庫の出品中(deal.dropship=true)」品のハードオフ実ページを叩いて
#      売切/削除なら deal.sourceStatus を立てる→reconcile/auto-stopがeBay出品を自動停止。dropship以外は絶対に触らない(有在庫保護)。
#  - 型番リファイン(refine): 1サイクル(既定1h)内に REFINE_SUBINTERVAL(既定20分)ごとの小バッチ。型番確定＋競合数焼き込み。
# ※ 旧「楽天の売切検知(liveness)」「楽天ギャラリー取得(gallery)」は無在庫モデルの遺物のため撤去(2026-06-28)。
#   売切検知はハードオフ版に置換(2026-06-28)＝事業の仕入れ元がハードオフのため。
CYCLE_INTERVAL="${CYCLE_INTERVAL_SEC:-${LIVENESS_INTERVAL_SEC:-3600}}"  # 1サイクルの長さ(秒・既定1h)。①②の頻度カウントと③の総待ちに使う(旧LIVENESS_INTERVAL_SECも互換で受ける)。
SOLD_EVERY="${SOLD_EVERY_CYCLES:-6}"               # 何サイクルごとにeBay落札を発掘するか(既定6≒6h・候補の多様化を速める。2026-07-01: 24→12→6)
REFINE_SUBINTERVAL="${REFINE_SUBINTERVAL:-600}"    # 型番リファインの小バッチ間隔(秒・既定600=10分)。1サイクル内で複数回回す(2026-07-01: 20分→12分→10分で確定回転UP・captchaは wlog:refine の検問数で監視し、出たら間隔を戻す)。
cd "$HOME/resale-research-app" || exit 1

# 自己更新の罠対策：走行中の bash は起動時にパースした本体を実行し続けるので、git pull で
# このスクリプト自体が変わっても新ジョブが反映されない(手動再起動が必要だった)。起動時の内容を
# 記録し、毎サイクルの git pull 後に変化を検知したら exec で自分を再読込＝スクリプト更新を自動適用する。
SELF="$HOME/resale-research-app/scripts/termux-run.sh"
SELF_SUM="$(cksum "$SELF" 2>/dev/null)"

termux-wake-lock 2>/dev/null || true                # 省電力でCPUが寝て止まるのを防ぐ(Termux:API無ければ無視)

# 各ジョブの結果(時刻/終了コード/gitコミット/ログ末尾)を KV に push＝PC側から遠隔でログを見られるようにする。
wl() { node scripts/workerLog.mjs "$1" "$2" "$3" >/dev/null 2>&1 || true; }  # wl <key> <logfile> <exit>

echo "中古カタログ・ワーカー常駐開始: eBay落札発掘=${SOLD_EVERY}サイクルごと / カタログ構築=2サイクルごと / ハードオフ売切検知=毎サイクル / 無在庫売切→自動停止=毎サイクル / 型番リファイン=${REFINE_SUBINTERVAL}秒ごと（1サイクル=${CYCLE_INTERVAL}秒）。ログ: ~/ebaysold.log ~/usedcatalog.log ~/hardoff.log"
cycle=0
while true; do
  # 最新のワーカーコードへ毎回自動更新(PCで直せば次サイクルで反映)。pull結果＋現在のgitコミットをKVに記録＝旧コードで止まってないか遠隔で分かる。
  git pull --ff-only > "$HOME/gitpull.log" 2>&1; gitrc=$?
  wl meta "$HOME/gitpull.log" "$gitrc"

  # このスクリプト自体が更新されていたら exec で再読込＝新ジョブ/変更を自動適用（手動再起動が要らなくなる）。
  # cksum が無い環境では SELF_SUM/NEW_SUM が空で一致し再起動しない（安全側）。
  NEW_SUM="$(cksum "$SELF" 2>/dev/null)"
  if [ -n "$NEW_SUM" ] && [ "$NEW_SUM" != "$SELF_SUM" ]; then
    echo "termux-run.sh が更新された→ exec で再読込して新ループを適用 ($(date))"
    exec bash "$SELF"
  fi

  # ① ハードオフ売切検知(毎サイクル・本番書込・サイクル先頭で即実行)。出品中(ebay_deals)＋used_catalog のハードオフ実ページを照合し、
  #    売切(schema.org)/削除(404)なら deal.sourceStatus＋used_source_status を立てる→eBay自動停止/一覧から非表示。
  #    無在庫の欠品リスクに直結するため重いdiscover/buildより前に置く。fail-open(不明は止めない)＝シグナルが出ない品は何もしない安全側。
  echo "---- $(date) hardoff-liveness ----" >> "$HOME/hardoff.log"
  HARDOFF_LIVENESS_DRY=0 node scripts/used/hardoffLivenessWorker.mjs >> "$HOME/hardoff.log" 2>&1; hrc=$?
  [ "$hrc" -ne 0 ] && echo "  (hardoff-liveness失敗・次回再試行)" >> "$HOME/hardoff.log"
  wl hardoff "$HOME/hardoff.log" "$hrc"

  # ①b 無在庫(dropship)出品の売切検知(毎サイクル・本番書込)。ebay_deals の「無在庫の出品中(deal.dropship=true)」品のハードオフ実ページを
  #    照合し、売切/掲載終了なら deal.sourceStatus を立てる→reconcile/auto-stop が eBay 出品を自動停止（欠品キャンセル防止）。
  #    ①(カタログ照合)を補完＝カタログから外れた無在庫出品の売切も取りこぼさない。dropship 以外の deal は絶対に触らない（有在庫保護）。
  #    対象0件(無在庫の出品が無い)なら即終了＝軽い。有在庫のみ運用なら実質no-op。
  echo "---- $(date) dropship-stop ----" >> "$HOME/hardoff.log"
  MUKAIKO_STOP_ENABLED=1 MUKAIKO_STOP_DRY=0 node scripts/used/mukaikoStopWorker.mjs >> "$HOME/hardoff.log" 2>&1; drc=$?
  [ "$drc" -ne 0 ] && echo "  (dropship-stop失敗・次回再試行)" >> "$HOME/hardoff.log"
  wl dropship "$HOME/hardoff.log" "$drc"

  # ② eBay落札発掘(起動直後＝cycle0＋24サイクルごと≒1日・本番書込)。住宅IPのPixelだから403を避けられる。
  #    「売れた出品」をキーワード別に集めて種(ebay_sold_seed)を作る→中古カタログ(build)がハードオフ照合。実売起点の発掘。
  if [ $(( cycle % SOLD_EVERY )) -eq 0 ]; then
    echo "---- $(date) ebay-discover ----" >> "$HOME/ebaysold.log"
    EBAY_SOLD_DISCOVER=1 EBAY_SOLD_DRY=0 EBAY_USED_GENRES=1 node scripts/ebaySoldWorker.mjs >> "$HOME/ebaysold.log" 2>&1; rc=$?
    [ "$rc" -ne 0 ] && echo "  (ebay-discover失敗・次回再試行)" >> "$HOME/ebaysold.log"
    wl discover "$HOME/ebaysold.log" "$rc"
  fi

  # ③ 中古カタログの候補構築(build)を【2時間ごと】に更新（Anthropic不使用＝無料。2026-07-01: 3h→2hで候補取得を速める）。
  #    キャッシュ ebay_sold_seed × ハードオフ現在庫 から利益候補を作る。確定相場は build が型番単位で引き継ぐ(崩落しない)。
  if [ $(( cycle % 2 )) -eq 0 ]; then
    echo "---- $(date) used-catalog build ----" >> "$HOME/usedcatalog.log"
    node scripts/used/buildUsedSampleFromCache.mjs >> "$HOME/usedcatalog.log" 2>&1; brc=$?
    wl build "$HOME/usedcatalog.log" "$brc"
    [ "$brc" -ne 0 ] && echo "  (候補構築失敗・次回再試行)" >> "$HOME/usedcatalog.log"
  fi

  # ④ 型番リファインを【小バッチ(既定12件)・サイクル内で複数回】実行（ユーザー指示2026-06-27）。
  #    一気に全件やるとeBayのcaptchaで弾かれる→毎回 warmup 付きの小バッチを「細かく・多く」回す方が弾かれにくく、
  #    未確認の型番を着実に確定できる。REFINE_SUBINTERVAL(既定20分)ごとに回す。
  #    件数は REFINE_BATCH（既定12・captcha閾値の十数件未満・毎回新セッションwarmup）で調整可。
  #    この内側ループが1サイクル(=$CYCLE_INTERVAL秒)ぶんの待ちを兼ねる＝①②のスケジュールは1サイクル単位で進む。
  spent=0
  while [ "$spent" -lt "$CYCLE_INTERVAL" ]; do
    echo "---- $(date) used-catalog refine batch ----" >> "$HOME/usedcatalog.log"
    REFINE_LIMIT="${REFINE_BATCH:-30}" node scripts/used/refineUsedCatalogEbay.mjs >> "$HOME/usedcatalog.log" 2>&1; rrc=$?
    [ "$rrc" -ne 0 ] && echo "  (型番リファイン失敗・次バッチ再試行)" >> "$HOME/usedcatalog.log"
    wl refine "$HOME/usedcatalog.log" "$rrc"
    # 次の小バッチまで待つ。ただしサイクルを超えない範囲で（残り時間が短ければそのぶんだけ）。
    remain=$(( CYCLE_INTERVAL - spent ))
    nap="$REFINE_SUBINTERVAL"; [ "$nap" -gt "$remain" ] && nap="$remain"
    sleep "$nap"
    spent=$(( spent + nap ))
  done

  cycle=$(( cycle + 1 ))
done
