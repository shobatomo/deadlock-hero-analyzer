# 公開前レビューの再現手順

作業branch fyth/optional-feedback、基点4a1b95c98610907de4ad0d96c3509169123c3510。実装/隔離テスト済み、実Supabase未接続。現在の正本はfeedback-activation-handoff.md、正式supabase/migrations SQL、public-app/backend/feedback-store.js。旧schema-draftは適用しない。connection-planのgateway案は比較資料であり、採用案は同一deadlock-fythの専用加算接続。

1. git status / log / showでcommitと範囲を確認。repo shobatomo/deadlock-hero-analyzer、公開rootはpublic-app。fyth-daily-workerに対する変更はない。
2. Node22、公式registryでpublic-appとfrontendのnpm ci。build→npm test。API6件、adapter8件、UI11件、public manifest/hash/import/余分なfile/compiled sensitive/source-map/routesを検証する。
3. `node tests/fyth-feedback-sql.mjs` はDockerのnetwork-none使い捨てPG17.11だけ。公式image digest固定。host mount、port公開、password、実project接続なし。non-super migration、role境界、既存readerACL、quota競合、UTC/30日、probeのmetadata SQLを確認しcontainer削除。
4. npm startを別terminalで起動し、tests/fyth-feedback-browser.mjsを実行。Playwright1.58.2は/tmp等のtool用directory、system Chromiumを使用。診断/保存はbrowser route mock、外部callなし。1280/390/320px、native keyboard、二重送信、retry/unknown/disabled、overflow/colorを検証。実Vercel/スクリーンリーダー試験ではない。
5. payloadはchoiceのみ、関数はfixed parameterized SQL、no retry、TLS検証、無効時connection未読。新規個別data/reason/action analyticsがないことをdiffで確認。既存reader3モジュール・推薦計算にdiffなし。
6. 新規sourceは本タスクの実装で、外部code/mediaを追加していない。package dependencies/lockfileは変更なし。既存画像credits・フォントSIL OFL1.1・権利表記を保持。Docker/CLI/Playwrightダウンロードやnode_modules/dist/screenshotsはgitに含めない。project全体のlicenseを新たに決める変更はしない。
7. staged file一覧、git diff --cached --check、secret-pattern scan、manifest検証を確認。Vercel auto deployment disabledを保持。commitはlocalのみ。push/PR公開/deployは別段階。

無効化中の接続確認は本人用ローカル `npm run feedback:check-connection`。APIを有効化せずmetadata SELECTのみ。日次削除失敗の自動停止は未実装で、Cron/監視/停止担当のgateを解消するまでProductionをtrueにしない。pg_cron有効化/登録追加承認、本人password/Production secret入力、実pooler/TLS/Vercel/Cron/backup確認は残っている。
