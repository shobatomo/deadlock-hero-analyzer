# FYTH 任意回答フィードバック：開発環境・実装引き継ぎ

## 対象と環境確認（2026-10-13 UTC）

- 環境が起動し、シェル・ファイル編集・npm registry・GitHub の読み取りを実際に利用できた。
- リポジトリ：`/workspace/deadlock-hero-analyzer`、origin は `https://github.com/shobatomo/deadlock-hero-analyzer.git`。
- 起動時は `work` ブランチ、HEAD `dfcb66bb28639479c0cfa153417a47783517e764`（main と同じ）、既存編集なし。
- `git ls-remote origin refs/heads/main refs/heads/fyth/public-preview-2026-10-09` で現在のリモートを確認。
- 対象 ref は `fyth/public-preview-2026-10-09`、HEAD `4a1b95c98610907de4ad0d96c3509169123c3510`。ユーザー受け入れ済み本番コミットと一致。
- `git fetch origin fyth/public-preview-2026-10-09` は成功。環境の fetch refspec が remote-tracking ref を作らなかったため、確認済み `FETCH_HEAD` から `git switch -c fyth/optional-feedback FETCH_HEAD`。既存編集を破壊する操作なし。
- 公開アプリは `public-app/`。別の fyth-daily-worker に対する操作なし。デスクトップ全体のコードや手順は前提にしない。
- 該当する AGENTS.md とローカル `.agents/skills` は見つからなかった。`/workspace/.agents` は空。`public-app/README.md` と公開バンドル検証スクリプトに従った。
- 初期 Node は `v24.19.0` / npm `11.9.0`。要求は Node 22。npm の既定キャッシュが書けなかったため、資格情報を扱わず `/tmp/fyth-npm-cache` を使い Node `v22.23.3` を実行した。

## 変更内容

質問：**おすすめを見て、使ってみたいヒーローはありましたか？**

選択肢は正確に次の3つ。

- 使ってみたいと思った
- 使ってみたいとは思わなかった
- まだ分からない

推薦が ready の結果画面だけに任意回答を追加。取得・推薦計算と既存カードを保持した。既存のフォント・色・ボタンを使用。native radio / fieldset / legend / form、44px 以上の選択対象、キーボード focus、状態読み上げ、モバイル縦配置、印刷非表示。

GET `/api/feedback` は受付可否、POST は JSON `{choice: "選択肢"}` のみを許可。ID・履歴・自由記述・余分なキーは拒否し、ブラウザ送信は cookies を省略、referrer を送らない。API は no-store、ログ出力や新しい永続記録なし。Vercel の rewrite とローカルルーティングを追加したが、Vercel 実環境は未検証。

本番 writer は実装していない。`createPublicApp({feedbackStore})` の dependency injection 境界のみ。既定の `null` では GET enabled=false、POST 503 not_stored。UI は操作無効化し、送信されないと表示する。環境変数だけで有効にする仕組みはない。

Store 契約：`increment(choice)` が永続集計への commit を確認した後だけ `{status:'stored'}` を返す。commit されなかったことが確定した場合のみ `{status:'not_stored'}`。例外・timeout・不明な結果は unknown。モックはテスト内だけにあり、本番の成功代替として使わない。

UI は選択必須、同期 ref のロックで連続送信を防止、成功後は同じ表示から再送不可。確定未保存なら手動で再試行可。応答喪失は commit 後の場合があるため unknown として再送停止し、成功とは表示しない。choice のみの送信と個別記録なしの条件では、再読み込み・別タブ・別端末をまたぐ厳密な一人一回答や永続 idempotency は実現できない。自動再試行は禁止。指標は匿名の回答件数であり、ユニーク利用者数ではない。

## 再現手順（秘密情報不要）

既存作業がある環境では `git status --short` と ref を先に確認し、この手順で無条件にブランチを切り替えない。

```bash
cd /workspace/deadlock-hero-analyzer/public-app
npm --cache /tmp/fyth-npm-cache exec --yes --package=node@22 -- node --version
npm --cache /tmp/fyth-npm-cache exec --yes --package=node@22 -- npm --cache /tmp/fyth-npm-cache ci --registry=https://registry.npmjs.org
npm --cache /tmp/fyth-npm-cache exec --yes --package=node@22 -- npm --cache /tmp/fyth-npm-cache --prefix frontend ci --registry=https://registry.npmjs.org
npm --cache /tmp/fyth-npm-cache exec --yes --package=node@22 -- npm run build
npm --cache /tmp/fyth-npm-cache exec --yes --package=node@22 -- npm test
npm --cache /tmp/fyth-npm-cache exec --yes --package=node@22 -- npm start
```

ローカル URL は `http://127.0.0.1:3031`。実 Steam ID や DB 接続を設定しなくてもバンドル・モック検証できる。通常 npm test は API 3 件・UI 7 件と公開バンドル検証。ビルドを先に実行する。

別ターミナルで実ブラウザ検証：

```bash
npm --cache /tmp/fyth-npm-cache install --prefix /tmp/fyth-browser-tools --no-audit --no-fund --package-lock=false playwright@1.58.2
cd /workspace/deadlock-hero-analyzer
npm --cache /tmp/fyth-npm-cache exec --yes --package=node@22 -- node tests/fyth-feedback-browser.mjs
```

システム Chromium `/usr/bin/chromium` を使う。異なる環境では `FYTH_CHROMIUM_PATH`、`FYTH_PLAYWRIGHT_MODULE`、`FYTH_TEST_BASE_URL` を指定できる。診断と保存 API はローカル browser route モックで、外部 API・DB は呼ばない。スクリーンショットは `/tmp/fyth-*.png`。

公開バンドルは許可ファイル・bytes・SHA256 を `public-app/public-manifest.json` で照合するため、ソース変更後に明示的に対象一覧と hash を更新した。検証は対象追加を無制限に許す方式に変えていない。テストファイルは配布済み JS には import されない。

## 将来の DB・最小権限・有効化手順（このタスクでは未実施）

`feedback-schema-draft.sql` はレビュー用 SQL 草案。生成済み・検証済み migration ではなく、実行していない。日付（UTC）・選択肢・件数の3列、日付と選択肢の複合 PK、atomic upsert。今日と前29日の30日付を保持し、古い日付は更新時および UTC 日替わりの清掃で削除する。30日保持の対象はこの新規集計テーブル。バックアップ・基盤ログ等の保持設定も公開前に運用担当が確認する。

1. 別途承認を得て、正しい Supabase プロジェクト・Postgres バージョン・現在の権限と公開 schema を管理者が確認する。既存 reader の資格情報を今回の作業に参照・入力しない。
2. 分離されたフィードバック保存サービスの設計を承認する。public-app に writer・service_role・CRON_SECRET を置かず、reader-only を維持する。保存サービスだけが専用の最小権限接続を持つ。公開アプリとの接続方法、期限・解除方法、サービス間認証は次の実装で具体化する必要がある。
3. 新規継続アクセスを承認した後、管理者が NOLOGIN owner / submitter / maintenance グループを作成する。owner はこの private schema のみを所有。submitter は increment 関数の EXECUTE のみ、テーブル直接 read/write 権限なし。maintenance は削除関数のみ。既存 reader、anon、authenticated、PUBLIC にアクセスを付与しない。
4. Supabase CLI の version / help を確認し、`supabase migration new fyth_feedback_daily_counts` で正式な migration ファイルを作成し、草案をレビューして取り込む。隔離ローカル DB で日付境界・同時 upsert・30日保持・不正選択肢・ロール別権限を SQL テストする。advisors も実施する。今回は CLI/DB の用意・実行を行っていない。
5. private schema を Data API の exposed schemas に追加しない。RLS 有効、政策なしで一般ロールを拒否。increment の SECURITY DEFINER は直接テーブル権限を渡さず atomic increment だけ許可するために限定使用する。所有者は NOLOGIN、search_path 空、名前は完全修飾、PUBLIC EXECUTE を revoke。owner 自身の table owner としての RLS bypass は意図した境界。grant と default privileges を管理者が監査する。
6. maintenance のみで毎日 UTC 00:00 に expiry を実行するスケジュールを承認・設定し、送信がない日も削除が続くことを検証する。増分更新の前にも expiry を行う。集計閲覧権限は別途必要な管理者だけにする。
7. 保存サービスは parameterized SQL で `select fyth_feedback_private.increment_choice($1) AS status` を実行し、commit 完了まで待つ。返却statusはstored/not_storedの2種類で、SQL草案のglobal lock/日次上限により拒否された場合だけnot_stored。body/choice/IP/ID/履歴をアプリログ・トレース・エラーレポートに新規記録しない。自動 DB/HTTP retry は行わない。結果不明は unknown。保存前に拒否できたものだけ not_stored。
8. 公開の匿名増分 API のため、公開前にサービス側の入力上限・同一 origin 制御・非個人単位のレート制御/負荷上限を設計・検証する。今回の same-origin チェックは browser cross-site の拒否であり、bot 防止や一人一回答の保証ではない。個人 IP 等を新規永続保存して防止しない。
9. 接続先サービスのプロトコル・認証・上限・timeout・停止手順を承認後、実 adapter を実装して injection する。確認済み保存・未保存・曖昧な失敗を end-to-end 検証する。保存機能の有効化は adapter 接続後だけ。未接続時はこのまま安全に停止する。
10. migration 実適用・資格情報作成/付与・GitHub push/PR 公開・preview/production deploy は別承認で実施する。git 自動 deployment 無効を保持し、停止は adapter を null に戻す。

Supabase 公式の [Postgres roles](https://supabase.com/docs/guides/database/postgres/roles) と [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)、Supabase スキルを確認した。changelog.md は HTTP 403 で読めなかったため迂回していない。実 DB 実装前に再確認が必要。これはローカル mock 検証の阻害要因ではない。

## 今回の検証結果

- Node 22.23.3 で install / build / npm test 成功。
- API モック 3 件、React UI 7 件が成功。choice allowlist、過大 body、不正 JSON、余分なキー、cross-site、未接続、確定未保存、例外、不明結果、timeout を確認。
- 公開バンドル：source_files=103、artifact_files=55、source_maps=0、sensitive_pattern_hits=0、api_routes=4、spa_routes=2、外部呼び出し=0。
- Chromium：1280px のキーボード送信成功、390px の確定未保存→再試行成功、320px の結果不明→ロック、390px の未接続→送信0回の4シナリオ成功。連続 Enter でも各送信は1回。Space / ArrowDown / Tab / Enter、選択肢の44px以上の高さ、横 overflow なし、pageerror 0を確認。
- スクリーンショットの目視確認で新規パネルの文字色を既存の明るいカードに合わせた。browser verifier に文字色の回帰チェックも追加。
- 最終変更後に build、全テスト、browser verifier、git diff --check を再実行して成功。
- 現在のリモート対象 ref は再確認でも 4a1b95c。変更はローカル作業ブランチ fyth/optional-feedback の未コミット差分。push / PR / deploy はなし。
- 未実施：実 Supabase migration 適用・SQL ロール動作/同時 upsert/日付境界テスト、保存 service/adapter、資格情報作成/参照/入力/付与、実データ取得と実保存、Vercel runtime 検証、GitHub 公開とデプロイ。
- ブロッカー：現在の reader-only 構成では実保存できないため、受付を安全に停止している。別途承認後の分離保存サービス・最小権限接続・清掃スケジュールと実検証が必要。Supabase changelog の取得は403で停止し、迂回なし。


## 独立レビュー後の追補

[レビュー・修正記録](feedback-review.md) と [接続方式・具体的承認対象](feedback-connection-plan.md) を追加。従来の「分離サービスが必要」は、今のpublic-appにwriter資格情報を置かない境界を維持する場合の推奨という意味。限定RPCの同アプリ方式も技術的には可能だが、境界変更の明示承認が必要。

feedback専用parserエラーを確定未保存に修正、匿名process単位30/min・同時2の保存guardを追加。timeout後は実書込の終了まで枠を保持する。API 6件・UI 11件へ拡充し、既存診断の取得失敗/abort/nonreadyも確認する。共有quota・daily expiry・backupを含む30日保持・project ID確定は実接続前の要件で、外部操作は未実施。

最小保存案は新規共有counterサービスを必須にせず、SQL草案にglobal advisory lock（同時増分1）と既存3列の合計による1000件/UTC日の予算を追記した。承認待ち・未実行で、role接続数/lock namespace/上限/日付境界の実検証が必要。
