# ガイド動画の生成パイプライン

サイトのガイド実画面から、縦型(1080×1920)の解説動画を自動生成するツール一式。
**やさしい音声ナレーション（edge-tts / Nanami）＋ lo-fiチルBGM**つき。
通し版（フル）と、**STEPごとの短い動画（ショート）**を両方出力する。

## 生成物（出力先 public/videos/）
| フル動画 | 内容 | 埋め込み先 |
|---|---|---|
| `guide-overview.mp4` | はじめてガイド（5ステップ概要・約1分） | `/guide` |
| `ebay-seller-guide.mp4` | eBayセラー登録（約2分） | `/guide/ebay-seller` |
| `payoneer-withdraw-guide.mp4` | Payoneer出金ガイド（約1分） | `/guide/payoneer-withdraw` |

ショートは `public/videos/shorts/<フル名>-<segkey>.mp4`（例 `ebay-seller-guide-step2.mp4`）。
各 `*-poster.jpg` はサムネイル（自動生成）。

## ファイル
- `capture2.mjs` / `capture_ebay.mjs` … ガイド実画面を要素単位でスクショ → `raw/*.png` ＋ `manifest.json`
- `composer.html` … 1枚のスライド(見出し＋画面＋やさしい字幕)を 1080×1920 で描画するテンプレ
- `plans.json` … スライド台本（字幕・最低表示秒数）。**字幕を直すならここ**
- `narration.json` … スライドごとの**読み上げ台本**（音声・スライドと1:1）。**ナレーションを直すならここ**
- `segments.json` … **STEPごとのショート動画の分け方**（どのスライドを1本にするか）
- `generate_bgm.mjs` … lo-fiチルBGMループ `bgm.wav` を合成（外部素材なし・76BPM）
- `produce.mjs` … ★メイン。TTS(Nanami)→声に合わせて各スライド尺を自動調整→描画→クロスフェード結合→声＋BGMをミックス→フル＋ショートを `public/videos/` に出力
- `raw/` … ガイド実画面のスクショ（素材） / `audio/cache/` … TTSキャッシュ（テキスト単位）

## 再生成
```bash
# 0) 画面が変わったら撮り直す（任意・要 npm run dev → :3001）
node video-slides/capture2.mjs && node video-slides/capture_ebay.mjs

# 1) 字幕(plans.json) / ナレーション(narration.json) / 分割(segments.json) を編集

# 2) BGMを作り直す（任意）
node video-slides/generate_bgm.mjs

# 3) フル＋ショートを生成（要ネット: edge-tts。ffmpeg必須）
node video-slides/produce.mjs
```

## 調整ポイント（produce.mjs 冒頭の定数）
- `VOICE` … 声。`ja-JP-NanamiNeural`(女性・優しい) / `ja-JP-KeitaNeural`(男性) など
- `RATE` … 話す速さ（`-8%` でゆっくりめ）
- `BGM_VOL` … BGM音量（`0.10`。上げると存在感アップ）
- BGMを既製曲に差し替えたいときは `bgm.wav` を好きな音源で上書き（要・利用可能な権利）

## YouTube に切り替える場合
`GuideVideo` / `GuideVideoShorts` は `youTubeId` 対応に拡張可。YouTube化後は `public/videos/*.mp4` を消すとデプロイが軽くなる。
