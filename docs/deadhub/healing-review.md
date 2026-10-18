# 回復量表示 — ローカルレビュー

基準は `deadhub/record-mvp` の `2cc9b7e0e16c7b4861442f17059a4eedaeac6282`。実装はTemp内の独立したローカルcloneで作成し、既存ワークスペースと別件の未コミット調査は変更していない。commit / push / deploy / 本番DB適用 / 権限変更 / 秘密参照 / 新規ゲームAPI取得は実施していない。

## 変更内容

- `provider.js`: 既存bulk metadataの本人の `final_stats.player_healing` だけを投影。`self_healing` / `teammate_healing` は加算せず、時系列の最大値・総和・他のプレイヤーの値にも置換しない。既存のリクエストパラメーター、同期期間、取得回数は変わらない。
- `shared/deadhub.mjs` / `store.js`: nullableな `player_healing` を保存・取得・日別集計の対象に追加。既存の `(owner_id,match_id)` upsertを使い、`coalesce(excluded.player_healing,stored.player_healing)` により欠損で既知値を消さない。再同期の既知値は置換し、加算しない。PostgreSQL bigintの文字列表現はJSON応答で数値化する。
- `Deadhub.jsx` / `Deadhub.css`: 試合詳細と日別合計に「回復量」、補足「API提供値」を表示。`NULL` は「未取得」、0は「0」。一部欠損なら例 `2,462（部分合計 · 取得 2/3 試合分）`。回復対象が自己＋味方であるとは断定しない。最終スナップショットが試合終了時点まで揃わない可能性を注記。日付セル・推移グラフ・推薦計算は変更しない。
- `schema.sql`: 新規構築用のテーブル定義を更新。既存DB向けの適用候補は `healing-schema-proposal.sql` に分離。既存DBへの適用時にschema.sql全体を実行しない。
- `public-manifest.json`: 変更した配布ソース5件のハッシュだけ更新。
- `deadhub-healing-data.test.mjs` / `deadhub-ui-offline.test.mjs` / `deadhub-healing-postgres.mjs` / `deadhub-healing-browser.mjs`: 投影、欠損/0、UI、実PostgreSQL、画面テスト。

## SQLと展開順序

`healing-schema-proposal.sql` はレビュー用の単独SQLで、Supabase migration履歴には登録していない。ローカルSupabase CLIが利用できないため、CLI由来のmigrationファイルは作成していない。SQLは使い捨てPostgreSQL 16で実行確認済み。本番は未適用。

追加は `deadhub_private.matches.player_healing bigint NULL CHECK (player_healing >= 0)` の1列。default、バックフィル、インデックス、権限、RLS、認証、cronの変更はない。既存行はNULLのまま。ALTER TABLE/COMMENTを実行できるテーブル所有者、または適切な所有権を持つ承認済み移行ロールが必要。アプリ用 `deadhub_app_login` の通常のSELECT/INSERT/UPDATEだけではDDLを実行できず、DDL権限を追加しない。既存のテーブル単位SELECT/INSERT/UPDATEが維持されていれば新列にも適用されるため、新たなGRANTは不要。本番の実際の所有者・権限は未照会。

承認後の安全な順序:

1. 対象DBと `matches` の所有者、既存列・制約・テーブル単位の権限を確認する。列が既に存在する場合は型・nullable・制約と適用履歴を確認し、SQLを重ねて実行しない。
2. テーブル所有者側で単独SQLを適用する。列追加にはACCESS EXCLUSIVEロックが必要で、CHECK検証の走査が発生しうる。`lock_timeout=3s`、`statement_timeout=10s` をトランザクション内で指定。タイムアウト時はロールバックし、トランザクション終了とDB状態を確認してから別の適用時間を検討する。アプリの同期中を避ける。
3. 列型・NULL許容・制約を確認後、アプリを展開する。先にコードを展開するとSELECT/INSERTが未存在列を参照して失敗する。旧コードは新列を省略した明示的列リストで動作するため、SQL先行は互換性がある。
4. 通常同期後、取得できた試合の値と未取得/0/部分合計を確認する。同期ロジックは変更しておらず、過去の全試合を再取得しない。現在の再照会窓に入らない古い試合の値はNULLのままになりうる。
5. コードを戻す場合はnullable列を残す。保存値を失うDROP COLUMNを通常のロールバック手順に含めない。

PostgreSQLの根拠: [ALTER TABLEの所有権・ロック・列追加・CHECK検証](https://www.postgresql.org/docs/16/sql-altertable.html)、[テーブルと列の権限](https://www.postgresql.org/docs/16/sql-grant.html)。

## 検証

Node 22.22.1、既存ロックに対応するローカル依存を使用。新規インストール・ゲームAPI呼び出しなし。

- `deadhub-*.test.mjs`: **160件成功、失敗0、skip0**。回復量の追加10件を含み、既存の認証境界、アイテム説明、推移、同期状態なども回帰確認。
- `deadhub-healing-postgres.mjs`: **6件成功**。新しいloopback専用PostgreSQL 16クラスタに基準コミットのaccounts/matches定義だけを作り、既存行追加後にSQL案を適用。既存行保持、nullable、負数拒否、provider→store→DB→JSON、欠損時保持、既知0、後日補完、再同期重複なし、owner条件、旧列リストの書込み互換性を確認。既存DBには接続せず、テストクラスタは停止済み。これはRLSポリシーを含まないテーブル単位ハーネスであり、本番権限/RLSの実行確認ではない。
- Vite production build成功。配布物検査: **138ソース、55生成ファイル、source map 0、秘密情報パターン検出0、外部呼出し0**。
- Chromium: **1280 / 390 / 320px × 4状態 = 12ケース成功**。部分合計、0を含む部分合計、全件取得、全件未取得を確認。日付セル高さ54 / 48 / 44pxを維持。横はみ出し・ブラウザー例外なし。PCキーボード/スマホタップ、同期失敗時保持、月移動での表示復帰も確認。合成APIのみ、外部リクエスト遮断。画面には合成データであることを明示。

初回検証ではテストfixtureの時刻に既存providerが受け付けないミリ秒を含めたためDB連携テストが失敗し、fixtureだけを修正。回帰ランナーの `--experimental-test-module-mocks` 不足も修正して再実行した。配布物検査のlocalhost接続はsandbox制約で一度失敗し、同じローカル検査を許可された実行環境で完了。製品コードを緩めて通したものではない。

基本の再現コマンド（このcloneのルートで実行、Node 22）:

```powershell
$cases=Get-ChildItem tests -Filter 'deadhub-*.test.mjs' | ForEach-Object FullName
node --experimental-test-module-mocks --import ./tests/deadhub-review-register.mjs --test $cases
node --import ./tests/deadhub-review-register.mjs --test tests/deadhub-healing-postgres.mjs
node public-app/frontend/node_modules/vite/bin/vite.js build public-app/frontend
node public-app/scripts/verify-public-bundle.mjs
node tests/deadhub-healing-browser.mjs <Playwrightのindex.mjs> <Chromiumの実行ファイル> <画面保存フォルダ>
```

DBテストはWindowsの `C:/Program Files/PostgreSQL/16/bin` またはLinuxの `/usr/lib/postgresql/16/bin` を使用。別途Dockerを起動する既存 `deadhub.test.mjs` 全体は今回実行していない。

## 残る未確認事項

- `2462` は以前保存された本人の正規化スナップショット値を参考にした数値。今回のbulk `final_stats` fixtureは合成であり、実取得に成功した証拠として扱わない。現在のbulk応答でのfield有無と実際の補完件数は未確認。
- 自己・味方・自然回復・吸収などの含有範囲は未確定。表示はAPI提供値に限定。
- 最終スナップショットが試合終了時点に一致する保証、古い全履歴の補完、本番のSQLロック時間・実権限・Vercel実行は未確認。
- 武器/スピリット別ダメージ、推移グラフへの回復量追加、推薦ロジック変更は含めない。
