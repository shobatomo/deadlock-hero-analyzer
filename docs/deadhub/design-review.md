# Deadhub 情報区分のデザインレビュー

基準コミット: `24091648fb0cc603dc7954ba01cb496d5b98ba66`（回復量公開済み版）。独立したローカルcloneで作成。デザインのcommit / push / deployは未実施で、公開は別途承認待ち。

## 変更範囲

- `public-app/frontend/src/pages/Deadhub/Deadhub.jsx`: カレンダーの見出しを追加。日別サマリーと試合一覧を別の枠に分け、試合一覧に見出しを付与。狭い画面で与ダメージの補足が読みやすく折り返すよう調整。
- `public-app/frontend/src/pages/Deadhub/Deadhub.css`: カレンダーは先頭の記録セクションとして従来位置を維持。日別サマリーの淡い黄系ラベル、試合カード、境界線・余白を整理。勝敗表示は同じ中立色。カレンダーの状態別色やセルサイズのルールは変更しない。
- `public-app/frontend/src/pages/Deadhub/MatchTrends.jsx`: 見出し部分を意味に合うheader要素に変更。
- `public-app/frontend/src/pages/Deadhub/MatchTrends.css`: 推移セクションを控えめな青系の枠・背景で区分。見出し下の境界線と操作欄の枠を追加。グラフの値・線色・平均・操作は維持。
- `public-app/public-manifest.json`: 上記4ソースのハッシュだけを更新。
- `tests/deadhub-design-browser.mjs`: ローカル合成データによる配置・寸法・二色・コントラストの確認。
- このレビュー文書。

バックエンド、DB、認証、権限、環境変数、取得処理、集計・推薦ロジック、アイテムモーダルの実装には変更がない。回復量公開の差分は基準コミットに含まれており、今回の差分には混在させない。

## 表示方針

PCではカレンダーを左側の先頭、日別サマリーと試合一覧を右側に配置する従来の構成を維持。スマホではカレンダーが日別サマリーより先に表示される。推移グラフは日別記録の後。色に加え、明示的な見出し、独立した枠、境界線、余白でも区別できる。

カレンダーは記録あり／記録表示なしの二色。勝敗・成績に応じた色評価は追加しない。日付だけをセル内に表示し、取得状態・試合数は従来のアクセシブルなラベルに残す。既存の選択枠、キーボードフォーカス、月移動も維持。

## 最終検証結果

- Node 22.22.1、既存ローカル依存を使用。新規インストールなし。
- 既存 `deadhub-*.test.mjs`: **160件成功、失敗0、skip0**。
- Vite production build成功。配布物検査は **138ソース、55生成ファイル、source map 0、秘密情報パターン検出0、外部呼出し0**。
- Chromium画面テスト: **3幅 × 4状態 = 12ケース成功**。全件取得、部分合計、0を含む部分合計、全件未取得を確認。横はみ出し・ブラウザー例外なし。月移動、PCキーボード選択、スマホタップ、同期失敗時の表示保持も確認。
- 測定対象の見出し・説明・統計ラベル・値・補足の文字コントラスト比は **最小7.22:1**（閾値4.5）。これは対象要素の計算結果であり、サイト全体のアクセシビリティ認証を意味しない。

| 画面幅 | セル幅（px、端数丸めを除き均一） | 固定高さ（px） | 背景色数 |
|---:|---:|---:|---:|
| 1280 | 59.390625 | 54 | 2 |
| 390 | 41.421875 | 48 | 2 |
| 320 | 34 | 44 | 2 |

セル幅はレスポンシブで、同じ画面幅ではデータの値・欠損状態によって変化しない。高さは従来値の54 / 48 / 44pxを維持。

既存アイテムモーダルも3幅で再検証。PCクリック、スマホ長押し、短いタップで開かないこと、スクロール移動・pointercancelによる取消、Enter/Space、Escape、閉じるボタン、外側クリック、フォーカストラップと復帰、説明取得失敗時の名称・画像保持が成功。幅380px以下・高さ560px以下を維持。公開APIの保存済み説明fixtureを利用し、画像はローカルの代替画像で応答。新規ゲームAPI取得・本番同期は行っていない。

画面レビューで見つけた与ダメージ補足の不自然な折返しと、CSS読込順による推移背景色の上書きを修正済み。修正後のビルド・160件の回帰・画面・モーダル・配布物検査がすべて成功。

## 再現とレビュー資料

このcloneのルートでNode 22を使用:

```powershell
$cases=Get-ChildItem tests -Filter 'deadhub-*.test.mjs' | ForEach-Object FullName
node --experimental-test-module-mocks --import ./tests/deadhub-review-register.mjs --test $cases
node public-app/frontend/node_modules/vite/bin/vite.js build public-app/frontend
node public-app/scripts/verify-public-bundle.mjs
node tests/deadhub-design-browser.mjs <Playwrightのindex.mjs> <Chromiumの実行ファイル> <画面保存フォルダ>
```

レビュー用ディレクトリ: `C:/Users/Owner/AppData/Local/Temp/deadhub-design-review`。`screenshots/` に12全体画面とサマリー・試合一覧の切り出し、`modal/` に3幅のモーダル画面と結果、`item-modal-offline-browser.mjs` に外部通信を遮断した既存モーダルテストの実行ハーネスを保存。ハーネスはレビュー支援用で、配布アプリには含めない。

残る制約: ChromiumのPC/タッチエミュレーションによる確認で、実機Safari/Firefoxは未確認。画面の試合記録は合成データ。実ユーザーのログイン・本番データを用いた表示確認や新デザインの本番公開は実施していない。ローカル実装・検証のブロッカーはない。
