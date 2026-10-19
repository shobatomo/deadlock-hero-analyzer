# ヒーロー別の試合一覧：公開前レビュー

基準 SHA: `2d36aeee9d1f22993822b9f0a2ed6b67410b15f7`（`deadhub/record-mvp`）。ローカル実装のみで、commit / push / deploy は実施していない。

## 変更内容

試合一覧の「一覧のヒーロー」で選ぶと、現在の月に保存されている同じヒーローの試合を日付をまたいで表示する。既存カードの成績・最終アイテム・説明モーダルを再利用し、絞り込み中のカードには年月日・時刻・JSTを表示する。

- 初期表示は従来どおり選択日。「絞り込みを解除」またはカレンダーの日付選択で日別表示に戻る。
- 別の月へ移動しても選んだヒーローは維持する。その月にいなければ0試合と空状態を表示し、他のヒーローへ勝手に切り替えない。
- 空の日にも絞り込みを使用できる。ヒーロー未取得は独立した選択肢として明記する。
- 月の読み込み中は前月の行を表示せず、一覧の操作を一時無効にする。既存の古い応答を無視する仕組みを使用する。
- 日別サマリーとカレンダーの記録色は絞り込みの影響を受けない。既存の推移グラフのヒーロー・指標選択も独立したまま。
- グラフの `trendHeroes` / `trendHeroId` を再利用する。グラフ本体・数値計算・アイテムモーダル本体は変更しない。
- NULLは未取得、数値0は0、アイテムNULLは未取得、アイテム空配列は取得済みデータ上の所持なしとして既存どおり区別する。

## 調査したデータ範囲

`public-app/backend/deadhub/app.js` の既存 `GET /api/deadhub/records?month=YYYY-MM` は、`store.snapshot` に対象月を渡す。`public-app/backend/deadhub/store.js` の `snapshot` は `monthBounds` で日本時間の月初以上・翌月初未満の保存済み行を取得し、`started_at DESC, match_id DESC` で返す。LIMIT / OFFSET / cursor はなく、この月の保存済み行をまとめて返す。

`observed.count` は保存済み全期間の件数であり、一覧の月内件数には使用しない。一覧は `view.month === month` の応答だけを対象にする。追加の月の先読み・全期間の読み込み・別API・同期処理は追加していない。絞り込みと解除、同月の日付選択では通信は増えない。月移動は既存の記録読み込みを使う。

画面に対象年月・JST・月内の保存済み件数と「全履歴ではありません」を明記した。別の月は既存カレンダーで切り替える。保存済み記録の完全性や未取得項目の補完は保証しない。

## 検証結果

- Node 22.22.1: 167テスト成功（既存160 + 一覧の新規7）。新規テストは日跨ぎ、解除、空の日、未知ヒーロー、グラフ独立性、月切替中、遅れた応答、既存モーダル、更新後に消えたヒーローを検証。
- Vite本番用ビルド成功。
- 新しい一覧のChromium確認: 1280 / 390 / 320pxの3ケース成功。キーボード操作・スマホ長押し・月移動・フィルター解除・空状態・NULL/0・アイテム状態を確認。横はみ出し・ページエラーなし。
- 新しい一覧の有効な操作要素、注記、件数、日時の測定文字コントラストは最低8.54:1。全アクセシビリティ項目の認証を意味しない。
- 既存の配色・日別値・カレンダー回帰12ケース成功。カレンダーのセル高54 / 48 / 44pxと記録有無の2色表示を維持。
- 既存モーダルの3幅回帰成功。クリック、長押し、短いタップの抑止、スクロール・pointercancel取消、Escape、フォーカスと復帰、閉じるボタン、外側クリック、説明取得失敗時の名称・画像維持を確認。
- 公開用バンドル検証成功: 138ソース / 55生成物 / ソースマップ0 / 機密パターン検出0 / 外部通信0。

テストは全て合成記録・既存のアイテム説明fixtureを使用。実ユーザーの記録、実DB、外部APIへアクセスしていない。新一覧の画面では画像欠損時の名称表示を再現し、既存モーダル回帰の画像はローカル代替画像を使う。Chromiumの画面幅・タッチエミュレーションであり、実機Safari/Firefoxは未確認。

## 再実行

リポジトリルートで、既存依存関係とNode 22以降を使用する。

```powershell
$cases = Get-ChildItem tests -Filter 'deadhub-*.test.mjs' | ForEach-Object FullName
node --experimental-test-module-mocks --import ./tests/deadhub-review-register.mjs --test $cases
node public-app/frontend/node_modules/vite/bin/vite.js build public-app/frontend
node tests/deadhub-hero-history-browser.mjs <playwright-index.mjs> <chromium.exe> <output-directory>
node tests/deadhub-design-browser.mjs <playwright-index.mjs> <chromium.exe> <output-directory>
node public-app/scripts/verify-public-bundle.mjs
```

画面証跡、完全オフラインの既存モーダル検証runner、各ログ、差分と結果JSONは `C:/Users/Owner/AppData/Local/Temp/deadhub-hero-history-review` に保存する。

## 変更範囲と制約

製品コードは `Deadhub.jsx` / `Deadhub.css` と対応するmanifestのメタデータだけ。テストは新規UI・ブラウザテストと、既存グラフテストのセレクター・領域名の調整。この文書を含め7ファイル。

月をまたぐ一括一覧・追加ページング・永続的なフィルター保存は今回の対象外。勝因推定、推薦、ビルドの優劣判定は追加していない。DB、認証、権限、環境変数、同期処理、外部API取得は変更していない。元の作業コピーと公開済み配色の作業コピーは保持した。
