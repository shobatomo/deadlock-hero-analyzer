# 保存済み全期間グラフ：ローカルレビュー

基準SHA: `6d6540b3c03ed1f2082e6113ed06bb28fb9f1583`。ローカル実装・検証のみ。commit / push / deploy、本番DB・認証・権限・環境変数の変更は行わない。

## 表示と計算

- 推移グラフに「表示中の月／保存済み全期間」を追加。初期値は従来の月表示。カレンダーと日別記録が先に表示される構成を維持する。
- 全期間は本人の保存済み個別試合を参照する。生涯の履歴を保証しない旨、JSTの実記録範囲・確認日時・全件数・選択ヒーロー件数・描画範囲を表示。全期間統計の合計から時系列を推定しない。
- ヒーローごとに開始日時・試合IDの昇順で200試合ずつ表示する。前後のページですべての保存済み試合に到達できる。全期間表示中のカレンダー月移動はグラフの範囲を変更しない。
- K/D/Aは回数、分間ダメージは各試合の敵ヒーローへのダメージ÷秒数×60。時間0または未取得は欠損。NULLと数値0を区別し、欠損で線を切る。
- 5試合平均は同じヒーローの連続5試合の単純平均。月・年・ページをまたぐ直前4試合も取得し、5件に欠損があれば平均を表示しない。古い別の試合で補完しない。ページ外の4試合は描画件数に含めない。
- 同じ指標の縦軸は全期間・全判別済みヒーローの最大値で統一する。未判別ヒーローは比較対象外として件数を明記する。
- 読み込み失敗・タイムアウト時は前回成功したグラフと範囲を明示して残す。初回失敗を0試合と表示しない。月表示・カレンダー・保存済み一覧・全期間統計は利用可能なまま。
- 期間・ヒーロー変更、アンマウント後の古い成功/失敗応答を無視する。8秒タイムアウト、AbortController、応答対象のヒーロー/ページ確認を併用する。

## 参照経路と上限

`GET /api/deadhub/trend-history?hero_id=<任意>&page=<1から>`。ページサイズはサーバー固定200。省略時は保存済み件数の多いヒーロー（同数ならID順）の1ページ目。

既存の検証済みセッションだけからownerを得る。URLのowner/account/userやヘッダーで対象を変更できない。既存の `tx` の所有者設定、SQLのowner条件、RLSを使う。追加権限・マイグレーション・新しい同期・外部ゲームAPIは不要。既存ルートと同じprivate/no-store。

新しい読み取りだけを `REPEATABLE READ READ ONLY` にし、件数・ヒーロー一覧・最大値・ページを同一スナップショットで取得する。既存トランザクションの動作は変更しない。返却行はmatch_id、started_at、hero_id、kills、deaths、assists、hero_damage、duration_sの8項目だけ。owner、最終アイテム、アカウント情報は返さない。

一回の応答は最大204試合（描画200+計算用4）、ヒーロー概要は最大512件。513種類以上の保存済みヒーローがある場合は明示的な取得失敗とし、黙って切り捨てない。ページ不正・範囲外は400。完全な件数とページ行数を共有バリデーターで照合し、不正・欠けた応答を表示しない。自動で全ページを先読みせず、各ページの操作時だけ取得する。

ページ間で保存内容が増減すると順番や総ページ数は変わり得る。各リクエスト内は一貫しており、確認日時と描画範囲は実際に受け取ったスナップショットに対応する。全期間集計・OFFSETは保存件数に応じてDBで走査するため、極端に多い記録では既存のDBタイムアウトに達し得る。その場合も短い履歴を全件として表示しない。

月表示の既存の全行取得は今回変更していない。数値の精度・APIスナップショットの時点に関する既存の制約も維持する。

## 検証と再実行

すべて合成データ。PostgreSQLテストは新規作成した使い捨てローカルクラスタだけを使用し、既存DB URLや資格情報を受け取らない。本番RLSや権限を変更しない。

```powershell
$cases = Get-ChildItem tests -Filter 'deadhub-*.test.mjs' | ForEach-Object FullName
node --experimental-test-module-mocks --import ./tests/deadhub-review-register.mjs --test $cases
node --import ./tests/deadhub-review-register.mjs tests/deadhub-trend-history-postgres.mjs '<PostgreSQL bin directory>'
node public-app/frontend/node_modules/vite/bin/vite.js build public-app/frontend
node public-app/scripts/verify-public-bundle.mjs
node tests/deadhub-trend-history-browser.mjs '<playwright-index.mjs>' '<chromium.exe>' '<output-directory>'
node tests/deadhub-current-month-browser.mjs '<playwright-index.mjs>' '<chromium.exe>' '<output-directory>'
node tests/deadhub-statistics-browser.mjs '<playwright-index.mjs>' '<chromium.exe>' '<output-directory>'
```

新規テストは複数月・年、405試合の全ページ照合、1万試合の末尾到達、同時刻bigint ID順、0件・未取得・0、ページ境界平均、ヒーロー選択、認証済み所有者分離、SELECTのみの権限、RLS、並行追加とスナップショット、応答競合、タイムアウト、エラー時の既存UI維持を対象とする。Chromiumでは1280 / 390 / 320px、タッチとキーボード、JST（端末タイムゾーンはLos Angeles）、今月への操作と全期間統計も確認する。実機Safari / Firefoxは検証対象外。

最終の実行件数・ログ・スクリーンショット・差分SHA256は、別添レビュー成果物の `RESULT.json` と `AUDIT.md` を参照。
