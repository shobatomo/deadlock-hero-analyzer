# 同期の実行元・結果を分けて記録する案

基準: `d97c89c0744a4e68ead84a8ce7c9f47bb15b481c`。ローカル実装のみ。本番DB、認証、権限、環境変数、公開設定は変更していない。commit / push / deploy も未実施。

## 目的と確認できること

従来の `accounts.last_success_at` / `sync_status` は実行元を問わず更新される。今回の案は、既存の同期と別の `sync_runs` に開始・終了を記録する。手動更新が成功しても、cron側の記録なし・失敗・終了未記録が残る。

実行元はサーバーのルートに固定する。本文・クエリ・ヘッダーから受け取らない。

| source | 呼び出し経路 | 意味 |
| --- | --- | --- |
| `manual` | 認証済み POST `/api/deadhub/sync` | 手動更新の要求 |
| `registration` | 認証済み POST `/api/deadhub/register` | 登録と直後の同期。登録処理自体の失敗や再試行も含む |
| `cron_endpoint` | 既存のcron認証を通った GET `/api/deadhub/cron` | cronエンドポイントを通った要求 |

`cron_endpoint` はVercelスケジューラーの実行証明ではない。同じ認証情報で手動実行しても同じ記録になる。`x-vercel-cron` 等は信用しない。確認APIは常に `cron_origin_verified:false` を返す。

## 最小の保存項目

`run_id`（ランダムUUID）、`owner_id`（既存の所有者UUID）、`source`、DB時計による `started_at` / `finished_at`、許可した `outcome` / `result_code`、`processed_count` の8列。

Steam ID、試合ID・試合内容、HTTPリクエスト、URL、ヘッダー、IP、cookie、token、秘密、例外メッセージ・スタックは保存・診断ログ出力しない。所有者UUIDは利用者との関連を持つ識別子として扱う。確認APIには所有者UUID・run UUIDも返さない。

| 記録 | 判定 |
| --- | --- |
| `latest:null` | 保存された実行記録なし。未実行と断定しない |
| `started`, `finished_at:null` | 開始済み、終了記録なし。実行中・中断・終了書込み失敗のどれかは断定しない |
| `success`, `complete` | 既存のsyncが全処理・共有ロック解放を終えてsuccessを返した |
| `partial`, `page_limit` | 既存のページ上限。完了と扱わない |
| `skipped` | `not_registered`, `busy`, `cooldown`, `shared_busy`。同期成功ではない |
| `failed` | 許可済みの固定エラーコード。それ以外の例外は `sync_failed` |

`processed_count` は従来の `sync.processed`。再取得・upsertした既存行も含み、新規試合数ではない。0件の取得完了も成功。既存試合だけを再取得した場合も成功。失敗・スキップは件数不明としてnull。成功/partialの戻り値の形が想定外なら、同期の返却値は変えず、実行記録だけを `failed / unexpected_result` とする。

開始は共有ロック取得より前、登録経路では登録処理より前に独立コミットする。終了は同期関数全体の完了後に別トランザクションで書く。これにより、共有ロック取得前のスキップや、ロック解放時の失敗も区別する。プロセス停止時に終了を書き足したり成功を推定したりしない。

更新は所有者・run UUID・`outcome='started'` を条件とし、一度確定した行を書き換えない。同時実行は別行を持つ。取得順は `started_at DESC, run_id DESC`。遅れて完了した古い実行が最新実行を上書きしない。同一開始時刻のタイブレークはUUIDであり、厳密な実行順証明ではない。

## 確認API

既存セッションの認証を通った GET `/api/deadhub/sync-runs`。所有者は認証済みidentityからのみ取得し、利用者は自分の記録だけ読める。Cache-Controlは既存どおりprivate/no-store。新しい画面、ポーリング、通知、監視サービスは追加していない。

閲覧条件は、有効な既存セッションがあり、現在の許可アカウントに含まれ、保存セッションの所有者UUIDがそのアカウントに一致すること。セッショントークンはハッシュ化して既存ストアに照会する。期限切れ・失効でセッションが返らない場合、未許可アカウント、不整合な所有者、重複cookie、未ログインは401となり、監査ストアを読まない。cron用Bearerだけでもこの確認APIは読めない。全利用者を一覧する管理者用APIは設けていない。

許可済みの利用者A/Bはそれぞれ自分の3実行元の時刻・結果・件数のみが対象。クエリやヘッダーの `owner_id` / `account_id` / `source` 指定では対象を変更できない。通常、招待利用者のcron欄には自分の記録がなく、設定済みcron所有者の記録を代わりに返すことはない。レスポンスはprivate/no-storeで、CORS許可ヘッダーは追加しない。

追加の通信不要テストでは、実際の `createSteamAuth.identify` とExpressルートを通し、2利用者の対象分離・上記拒否条件・外部所有者指定無視を確認した。セッション/監査ストアは合成データのテスト用実装。SQLには全4集計の所有者条件とトランザクションごとの所有者設定がある。使い捨てPostgreSQL 16.0でも、提案RLSによる他所有者のSELECT/INSERT/UPDATE拒否、所有者未設定時の非表示、列権限、終了済み行の再更新拒否を確認した。アプリの認証テストは合成ストア、DB権限テストは独立した使い捨てDBで実施しており、本番セッションや本番DBを使った検証ではない。

読み取り成功時は `available:true`, `evidence:'recorded_attempts_only'`, `observed_at` と、3実行元の `sources` を返す。各実行元には以下がある。

- `latest`: 最新の開始に対応する結果。記録なしならnull。
- `last_success`: 最後に開始された成功記録。後続の失敗時にも残る。
- `last_failure`: 最後に開始された失敗記録。後続のスキップや手動成功で消えない。
- `unfinished_count`: 終了未記録の件数。bigintの精度を失わないよう10進文字列。
- `oldest_unfinished_at`: 最古の終了未記録時刻。後続の成功でも消えない。

各結果は開始・終了時刻、outcome、固定result_code、processed_countだけを含む。既存のGET `/records` には依存させていないため、監査テーブルがない・読めない場合でも保存済み試合は従来どおり読める。

既存のcron設定は21:00 UTC（翌06:00 JST）の日次。cron側の最新開始時刻を確認すれば、手動更新に隠されず「予定時刻後も実行記録が増えていない」を調べられる。ただし未実行、起動前障害、認証拒否、開始記録失敗、導入前の履歴は、このAPIだけでは区別できない。スケジューラー起因の確認には、別途Vercel側の実行履歴と照合が必要。自動判定・通知は今回追加していない。

## 記録障害時の扱い

既存の同期処理・成功条件・HTTP status/body・再試行条件を維持するため、監査のみの障害では同期を止めない。

- 開始書込み失敗: 同期を続け、終了書込みを試みない。終了だけの偽の成功行を作らない。
- 終了書込み失敗: 元の同期結果/例外をそのまま返す。開始行が残っている可能性がある。
- DBコミット応答消失: 書込み成否は不明。自動再試行で成功を捏造しない。後で確認APIを読む。
- 同期レスポンスには `X-Deadhub-Sync-Recording: recorded | unavailable` を追加する。これは同期の成否とは別。記録先が未構成の場合もunavailable。
- 読取り失敗: `available:false`, `evidence:'unavailable'`, `sources:null`。記録なしの空配列に偽装しない。
- 診断ログは `DEADHUB_SYNC_AUDIT_START_FAILED`, `...FINISH_FAILED`, `...READ_FAILED` の固定文字列だけ。ログ出力自体の障害も元の同期結果を変えない。

開始記録が失敗して記録が残らないこともあるので、APIの読み取り成功は過去の記録が完全である保証ではない。記録追加により通常の同期1回あたり独立した書込みトランザクションが2回増える。既存のDBタイムアウト設定は維持。追加遅延・本番DB負荷は未計測。実行時間切れの場合は終了未記録となり得る。

追加テストでは「開始書込みに失敗 → 同期コールバックは0件成功を返す → 後の読取りは成功するが履歴は空」を再現。同期応答は `recording:unavailable` 相当のヘッダー、確認APIは `available:true` でも `evidence:'recorded_attempts_only'` とする。`latest:null` は「記録なし・実行有無は不明」であり「未実行」の判定ではない。読取り自体が失敗した場合の `available:false / sources:null` とも区別した。また、秘密・cookie・Authorization・URL・アカウント・試合IDを模した値を例外に含め、開始/終了/読取りの各失敗で固定コード以外がログやHTTP応答へ出ないことを確認した。

## スキーマ・アクセス・保持期間の提案

`sync-runs-schema-proposal.sql` は適用用の提案で、本番には実行していない。既存のprivate schema/server roleを前提とし、新テーブルだけを対象とする。accountsがまだない場合も記録するため、accountsへの外部キーは付けない。

- 新テーブルでRLSをenable/forceし、所有者UUIDのSELECT/INSERT/UPDATEポリシーを分離。
- サーバーロールはSELECT、開始3列へのINSERT、終了4列へのUPDATEのみ。実行元・所有者・開始時刻は変更不可。終了済み行は再更新不可。
- PUBLICとanon/authenticated/service_roleの新テーブルへの既定由来grantも取り除く。既存テーブル・ロール属性・所属・認証関数・環境変数は変更しない。
- DELETE/TRUNCATE、新しいSECURITY DEFINER関数、Data API公開は追加しない。
- 保持期間は現時点では無期限。自動削除なし。導入90日を目安に件数・用途を確認し、期限・アーカイブ・削除を別途合意する。90日到達で自動削除する意味ではない。

RLSとSQL権限は別であること、UPDATEにもSELECTが必要であることを[Supabaseの公式資料](https://supabase.com/docs/guides/database/postgres/row-level-security)で確認。利用したPostgresベストプラクティスに従い、所有者・実行元・開始時刻の索引と、未終了/成功/失敗の部分索引を用意する。テーブル追加は既存データをバックフィルせず、初期状態を「記録なし」とする。

## 検証結果

2026-10-19、同じ作業フォルダー・Node 22・同じテスト操作で検証を完了。モデルや実行環境を変更せず、別経路へ迂回していない。前回の承認レビュー障害は今回再発せず、コマンドが実行された。今回、アプリ実装・SQL案・テスト内容を追加変更する必要はなかった。

| 検証 | 結果 | 範囲 |
| --- | --- | --- |
| Deadhub回帰 | 178/178成功 | tests/deadhub-*.test.mjs。同期記録11件、既存の認証・データ取得・表示・モーダル等 |
| PostgreSQL統合 | 8/8成功 | PostgreSQL 16.0、Temp内の新規クラスタ、127.0.0.1、合成データのみ |
| localhost HTTP / bundle | 成功 | 139ソース・55成果物、機密パターン0、ソースマップ0、既存FYTH API 4経路・SPA 3経路、Deadhub未設定時の閉鎖動作 |
| Chromium | 3/3成功 | 1280/390/320px、合成API応答、外部通信0、横方向のはみ出しなし |
| ビルド | 成功（前回実施済み） | 画面JS/CSSは基準公開版と同じ名前・SHA-256。今回フロントエンド変更なし |

実DB統合では、所有者別の履歴、cron記録なしを手動成功が変えないこと、cron失敗の保持、未終了の永続化、完了順が逆転した場合の最新判定、実際の共有ロックによる同時実行スキップ、0件成功・既存試合のみ再取得、監査テーブル欠損中の同期/記録閲覧、終了書込み失敗、不正な状態/コード/件数の拒否を確認した。過剰な既定grantを模した環境でも新テーブルの権限を絞れている。

ブラウザーでは、月内ヒーロー一覧、日付・月切替、グラフの独立、未取得と0の区別、キーボード操作、スマホの短いタップでは開かず長押しで開くアイテムモーダル、Escapeとフォーカス復帰を確認。PC一覧・390pxモーダル・320px一覧の保存画像も目視確認した。これは既存画面の回帰であり、今回新設した確認API用の画面を追加したわけではない。

使い捨てクラスタは C:/Users/Owner/AppData/Local/Temp/deadhub-sync-runs-pg-tmyu1U。終了フックの停止成功、postmaster.pidの消失、ログの「database system is shut down」を確認。フォルダーは検証証跡として保持し、再帰削除は行っていない。本番/既存DBへの接続なし。

成果物フォルダー C:/Users/Owner/AppData/Local/Temp/deadhub-sync-audit-review に、全回帰のregression.tap、browser/browser-results.jsonと画像、VALIDATION-RESULT.json、最新LOCAL-RESULT.jsonとsync-runs.patchを保存。以前の承認レビュー失敗はRETRY-RESULT.jsonに履歴として残すが、現在の未完了項目ではない。

残る制約は本番固有のもの。本番DBのバージョン・実際の権限/所属・API公開設定・性能/遅延は未確認。実セッションでの新APIと、Vercelスケジューラーによる次回実行の照合は公開後に別途必要。localhost HTTPのbundle検証はDeadhub未設定時の確認であり、実DB付き認証APIの本番エンドツーエンド検証ではない。

## 本番化に必要な別途のGO

承認対象は `docs/deadhub/sync-runs-schema-proposal.sql` の新テーブル追加と下記の限定権限、および別途のコード公開。このターンではどれも本番に実行していない。

| 本番DBで提案する操作 | 対象と制限 |
| --- | --- |
| CREATE TABLE | `deadhub_private.sync_runs` だけ。上記8列、状態整合性CHECK、UUID主キー。既存行の変更・移送・バックフィルなし |
| CREATE INDEX | 新テーブルの最新検索1本、未終了/成功/失敗用の部分索引3本 |
| ENABLE / FORCE RLS | 新テーブルだけ。SELECTは本人、INSERTは本人のstarted、UPDATEは本人のstartedから終了状態への1回のみ |
| REVOKE | 新テーブルだけのPUBLIC・既存サーバーロール・anon/authenticated/service_roleの直接grantを一旦除去。グローバル既定権限や他テーブルは変更しない |
| GRANT SELECT | 既存サーバーロール `deadhub_app_login`。行は所有者RLSに従う |
| GRANT INSERT（列限定） | `run_id, owner_id, source` の3列のみ。開始時刻・初期状態はDB既定値 |
| GRANT UPDATE（列限定） | `finished_at, outcome, result_code, processed_count` の4列のみ |

既存private schemaへのUSAGEは既存構成を前提とする。新しいrole、LOGIN/所属変更、他schemaへのアクセス、DELETE/TRUNCATE、SECURITY DEFINER関数、公開Data APIは不要。開始時刻・実行元・所有者の書換え、完了済み行の再更新も許可しない。SQL案はBEGIN/COMMIT内の追加であり、既存アカウント・試合テーブルのALTERや既存行へのDMLは含まない。

保持方針の承認対象は「当面無期限保持・自動削除なし」。90日は運用見直しの目安であり、期限削除ではない。今回、保持ジョブも削除権限も追加しない。保存内容は8列に限定するが、owner UUIDは識別子なので利用者データとして扱う。期間変更・アーカイブ・削除を行う場合は対象・手順を別途合意する。

1. ローカル検証結果と、上記のDB操作・権限・保持方針をレビューする。検証のブロッカーは解消済み。
2. 本番スキーマ/新テーブル権限変更とコード公開について、明示的なGOを得る。この作業にはその許可は含まれていない。
3. 承認後に新テーブルだけのマイグレーションを適用し、権限/RLSを確認。コードのcommit/push/deployを行う。環境変数やcronスケジュールの追加変更は不要。
4. 認証済みAPIで各実行元の独立と記録ヘッダーを確認し、次回の実際の予定実行後にVercel履歴とcron記録を照合する。cronエンドポイントを手動実行しただけで日次実行を確認済みとしない。

コードのロールバックでは新テーブルを削除しない。古いコードは新テーブルを参照しないため、記録を保存したまま戻せる。自動削除や修復タスクは作らない。
