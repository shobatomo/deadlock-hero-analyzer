# FYTH 保存先接続の具体案（承認待ち・秘密値なし）

## 確定した対象（親スレッドの現物確認に基づく）

- Vercel アプリ：`deadlock-fyth`
- Vercel project ID：`prj_eknZdUrfiSOL4eOdfK3OEODut17w`
- Vercel team ID：`team_H1BMitz1DUJuT83Bx7ofDF8X`
- Supabase：`shobatomo's Org / Deadlock FYTH`
- Supabase project ID/ref：`adxoqjgmhmortztqngcz`
- Supabase organization_id：`fdecwkwvvhpabavyrdhn`
- Supabase region：`ap-northeast-1`
- 確認時 status：`ACTIVE_HEALTHY`、Postgres：`17.11`

以上は対象識別の確定のみ。実DB変更・資格情報操作・権限付与・Cron登録・push・deployの承認ではない。現物確認は親によるSupabase list_projectsの結果で、この環境からDBへ接続して確認したという意味ではない。

最新の最小構成提案は **同じdeadlock-fythアプリに集計加算関数EXECUTEだけの専用接続を追加し、既存readerを不変にする方式**。以下の分離サービス案は、現在のreader-only運用境界を厳密に維持する場合の比較案として残す。分離サービスを新規作成する承認は得ていない。同一アプリ案のLOGIN名は `fyth_feedback_app_login`、server-only Production設定は `FYTH_FEEDBACK_DB_URL` / `FYTH_FEEDBACK_DB_CA_CERT`、gateway URL/tokenは不要。アプリ全体に限定加算能力が増えることとREADMEの境界変更は別途承認が必要。

## 推奨する最小構成

現在の制約を保つ場合の構成：

`ブラウザ → 既存公開アプリ /api/feedback → 専用保存サービス → Supabase private schema の increment_choice(text)`

ブラウザ body は正確に `{choice: "3つの選択肢のいずれか"}`。既存公開アプリも body を choice だけに作り直して保存サービスへ送る。ID、元リクエストの headers、cookies、IP、User-Agent、Referer、診断結果を転送しない。サービス間認証は body に混ぜず、サーバー限定 Authorization header で行う。

専用保存サービスは、別 Vercel プロジェクト **`fyth-feedback-gateway`（新規作成案、未作成）** の Node Function 1つを候補とする。別プロジェクトなので診断用 reader/個人IDにアクセスできない。既存 fyth-daily-worker のリポジトリ・プロジェクトを流用しない。公開アプリは現在のリポジトリ `shobatomo/deadlock-hero-analyzer` / `public-app`、対象 ref `fyth/public-preview-2026-10-09` を維持する。

gateway のエンドポイント案は POST `/api/feedback`、body 1KB 上限、3つの選択肢のみ。GET の管理データ・任意 SQL・counts 読み取り・個別イベントの API は作らない。接続は TLS 検証付き専用 Postgres LOGIN、許可は private 関数の EXECUTE のみ。READ COMMITTED固定の1回の parameterized SQL/autocommit を await し、DB driver が commit 完了を確認した場合だけ stored を返す。既存 `sql-executor.js` は fyth_reader/fyth_writer 用なので、既存 reader のロールや許可を増やして再利用しない。

保存サービス側でも、全インスタンス共通の上限を持つ。最小案では新しいRedisや個人別カウンタを追加せず、private増分関数で **transaction advisory lock 1つ（同時増分1件）と、UTCの日次回答合計1000件の上限** を確認してからatomic upsertする。どちらも拒否時は既存行を変更せず `not_stored` を返す。上限1000/dayとadvisory lockのnamespace `(190846237,1)` は承認・競合確認が必要。日次合計は既存3列の集計から計算するため個別回答・追加永続記録は生まれない。翌UTC日には新しいdayが使われて上限が復帰する。

今回追加した公開アプリのguardは **各プロセス30送信/60秒、同時保存2件** で、複数Vercelインスタンスの合計を保証しない。一方、DBの上記上限は全gateway共通。専用DB roleには **CONNECTION LIMIT 2、default_transaction_isolation=read committed、statement_timeout 2秒、lock_timeout 500ms** を提案。負荷制御は保存前に行い、関数が `not_stored` を返した場合gatewayは429/not_storedとRetry-Afterを返す。driver/transportの不確定な失敗はunknown。SQL草案はread committed以外を保存前に拒否する。pooler利用時はLOGIN CONNECTION LIMITだけで全クライアント接続数が制限されると見なさず、driver poolのmax=1/instanceとpoolerの接続上限・transaction modeを実検証する。advisory lockはtransaction単位で、session lockやセッション依存SETは使わない。

これは保存件数とDB処理を制限する最小構成であり、ネットワーク入口の大量リクエストまで防ぐものではない。gatewayは非公開token認証、1KB上限、token検証前にDB接続しない、platformの既定DoS保護を前提とする。追加の全体minute quotaが必要なら、匿名の一時共有カウンタ/基盤ルールを別承認で追加する。その場合も個人IP・Steam ID・個別回答を新規永続保存しない。全体予算はBotによる集計汚染や枠の占有を完全には防げず、指標は「回答件数」であり人数ではない。公開初期に日次上限へ達した場合は勝手に上限を増やさず、ユーザーへ状況を報告して承認を得る。

## 分離を選ぶ理由と代替案

| 方式 | 構成・利点 | 境界/制約 |
| --- | --- | --- |
| 推奨：別保存サービス + private限定関数 | DB credentialは保存サービスだけ。既存reader権限は維持。保存サービスを独立停止・監査できる | 新規サービスとサービス間tokenが必要。公開アプリにも「増分だけ」の間接的な継続書込アクセスは増えるため承認が必要。分離自体は乱用防止にはならない |
| 同じVercel公開アプリに専用DB LOGIN + private限定関数 | 1つのアプリ、追加のnetwork hopなし。EXECUTEだけなら最小DB権限にできる | 技術的には可能。ただし現在の「public-appにwriter資格情報を置かない」運用境界を変更し、同じruntimeがreaderと増分資格情報を持つ。READMEの変更と明示承認が必要 |
| ブラウザからSupabase限定RPC | 公開publishable keyでRPCだけを許可し、table権限を与えず増分する構成は可能 | exposed schemaの関数とanon EXECUTEが必要。サイトを経由せず誰でも呼べる。現在のprivate/reader-only境界を変更する。関数内部の全体quotaなど防御が必須で、keyはBot防止にならない。今回のprivate草案をそのまま公開しない |
| Supabase Edge Functionを保存サービスにする | 別Vercelプロジェクトを省き、同じprivate関数を専用DB接続で呼べる | 限定DB接続とpooler互換性・秘密設定が必要。service_roleを安易に使うとこの用途以外の広い権限になり、今回の最小構成では使わない |

分離はDBの技術的必須条件ではなく、**今の公開アプリをreader-onlyのまま保つ制約を満たす推奨案**。承認後に同じアプリの限定RPC案を選ぶなら、より少ない構成にできる。一方、分離でも新しい継続アクセスの承認は省略できない。Postgres関数/RPCとEXECUTEの既定公開を明示revokeする仕様は [Supabase公式](https://supabase.com/docs/guides/database/functions) を確認した。

## ユーザーが承認する対象

対象project/team/refは冒頭の現物確認値に確定した。適用先を名前だけで推測せず、このIDを使う。本番/previewの適用範囲、許可origin、接続方式、保持条件、管理担当と実行承認は引き続き未確定。秘密ファイル・資格情報の参照で対象を確認する方法は採用していない。

| 対象 | 提案する変更/アクセス範囲 | 実行前に確定する識別子 |
| --- | --- | --- |
| 既存Vercel公開アプリ | サーバーからgatewayの増分APIだけを呼ぶadapterとserver-only設定を追加。診断DB readerは変更なし | `deadlock-fyth` / `prj_eknZdUrfiSOL4eOdfK3OEODut17w` / `team_H1BMitz1DUJuT83Bx7ofDF8X`。Productionのみ接続、Preview未接続の案。許可originとrepo/ref/public-appの一致を実行前確認 |
| 新規Vercel保存サービス案 | `fyth-feedback-gateway`を作成、Node Function1つ。Git自動deploy停止、診断readerやworker設定なし | team ID・作成承認・実project ID・region・費用/DB全体上限 |
| Supabase | `fyth_feedback_private` schema、`daily_counts(day,choice,count)` table、`increment_choice(text)` と `expire_counts()` | `Deadlock FYTH` / `adxoqjgmhmortztqngcz`、org `fdecwkwvvhpabavyrdhn`、`ap-northeast-1`、Postgres `17.11`。このproject内の新規feedback schemaだけが変更対象 |
| 所有ロール | `fyth_feedback_owner` NOLOGIN、feedback schema/table/2関数だけの所有、アプリからSET ROLE不可 | 対象projectと所有範囲。既存private/reference schemaは対象外 |
| 増分グループ | `fyth_feedback_submitter` NOLOGIN、schema USAGE、incrementのみEXECUTE、直接table権限なし | 対象projectとこの関数だけのgrant |
| 保存接続LOGIN | `fyth_feedback_gateway_login`、submitterだけのメンバー、NO SUPERUSER/CREATEDB/CREATEROLE/REPLICATION/BYPASSRLS、接続数2 | 新規継続アクセスの承認、期限/rotation/解除担当。既存fyth_reader/fyth_writerをgrantしない |
| 清掃グループ | `fyth_feedback_maintenance` NOLOGIN、expireのみEXECUTE、直接table権限なし | Supabase Cron jobの実行と限定roleへの切替方法の検証 |
| 清掃スケジュール | job名 `fyth-feedback-expire-daily`、UTC毎日00:00、expiryのみ。成功時刻監視、失敗時受付停止と承認済み範囲の復旧 | cron timezone、管理担当、監視/通知先、基盤ログ保持。通知の送信権限は別確認 |
| 乱用対策 | DB global同時1・1000件/day、role接続2、process30/min、入口1KB。追加個人カウンタなし | 1000件/day・advisory lock namespace・timeout値・接続数の承認。追加minute quotaを選ぶなら基盤/費用/TTLを別承認 |
| 管理・削除 | 既存管理者だけの集計SELECTと期限削除/承認済み全件削除。gatewayとreaderに管理権限なし | 閲覧担当と削除担当、削除対象期間または全件、backup retention |

資格情報の設定先は次の通り。**値はこの文書・チャット・repo・Libraryへ記載しない。今回は生成/参照/入力していない。**

| 設定名（案） | 設定先 | 内容とスコープ |
| --- | --- | --- |
| `FYTH_FEEDBACK_GATEWAY_URL` | 既存公開Vercelのserver-only env、対象環境だけ | 承認済みgatewayの固定HTTPS endpoint。任意URL入力にしない。非秘密 |
| `FYTH_FEEDBACK_GATEWAY_TOKEN` | 既存公開Vercelとgatewayのserver-only secret、環境別 | このgatewayへの増分POSTだけの専用token。reader/DB/adminには使えない。新規継続書込アクセスとして承認 |
| `FYTH_FEEDBACK_DB_URL` | gatewayだけのserver-only secret、対象環境だけ | `fyth_feedback_gateway_login`専用接続。既存reader URLやservice_roleは入力しない |
| `FYTH_FEEDBACK_DB_CA_CERT` | gatewayだけのserver-only env | CA証明書（非秘密）、TLS証明書検証を有効。URLのssl flagsで検証を無効化しない |
| role/job設定 | Supabase管理者による承認済みmigration/Cron | browserやpublic-appへmaintenance/admin credentialを新規設定しない |

`VITE_*`には秘密設定を置かない。previewは本番書込を利用せず、未接続または別の承認済みテストDBと別tokenを使う。環境変数を設定しただけで成功扱いにせず、adapterの接続・期限削除・権限拒否テストが終わるまでは受付false。

## 日次集計の30日保持・停止・削除

ライブtableはUTCの今日と前29日の計30日付、最大90行。choice/dayのatomic upsertだけで個別行は作らない。送信時expiryに加え、**送信ゼロの日も動く毎日expiryが有効化の必須条件**。[Supabase Cron](https://supabase.com/docs/guides/cron)でSQLジョブを作れるが、今回はscheduleもSQL実行もしていない。

ジョブ登録案は管理者が、transaction内で `SET LOCAL ROLE fyth_feedback_maintenance` して `SELECT fyth_feedback_private.expire_counts()` を呼ぶ方式。cron登録権限・SET ROLE可否・UTC・失敗時のrollbackを隔離DBで検証する。アプリやgatewayにはcron編集権限を渡さない。正常実行時刻だけを監視し、expiry未完了が検知されたら新規受付を停止し、管理者が同じ限定expiryを復旧実行する。これには新規通知/運用設定の別承認が必要。

実際の「30日保持」を保証するには、live tableだけでなく **DBバックアップ/PITR、SQL/HTTPログ、トレース、監視のコピー**を含めて確認する。backupに古い集計が残る場合、live deletionだけで30日以内に全コピー削除とは言えない。既存projectのbackup設定を無断変更せず、tableを含むbackupを30日条件に合う方式へできるか管理者が確認する。満たせない場合は保持定義または別project/storage設計をユーザーと確定するまで「30日保持」の実保存を有効化しない。自由記述や個別回答をログへ追加しない。

停止は①公開appのadapterをnullへ戻す（既定で受付false）②gateway token失効③必要なら専用LOGINを無効化/接続終了。これはfuture操作で今回は未実施。停止後も期限削除は継続させる。

全件削除の要求が来た場合は、**対象Supabase project refと、このtable全件という明示承認**を得てから管理者が `TRUNCATE TABLE fyth_feedback_private.daily_counts` を実行し、集計row数0を確認する。期間指定なら承認されたUTC日付範囲のDELETEのみ。gateway/submitter/maintenanceにTRUNCATE・任意DELETEを追加しない。schema/既存reference table/workerを削除しない。backup等の残存コピーは上記の保持手順に従う。期限削除は匿名集計だけなので特定の個人回答を探して削除する機能はなく、その目的のID記録を増やさない。

## 有効化前の確認と今回の未実施

正式migration生成、role/permission SQLテスト（anon/reader/submitterの拒否、increment/expire限定）、autocommit/READ COMMITTEDと異なる分離レベルの拒否、pooler/driver接続枠、同時upsert、UTC日替わり、30日境界、無回答期間のexpiry、全件削除復旧手順、DB advisory lockの競合/全体上限/翌UTC日復帰、commit後応答喪失、TLS、token rotation、設定漏れ時false、実環境end-to-endを検証する。どの接続方式を選んでも同じ保存結果契約を維持する。

今回できたのはコード・モック検証・未実行SQL草案・具体案まで。project識別子は親の現物確認で確定済み。資格情報、role/権限付与、Cron登録、SQL/削除、DB保存、外部公開、push、deployは行っていない。これらを一括の曖昧な承認にせず、上表の識別子と範囲を埋めた具体的な承認にする。


## 承認後の実装準備（2026-10-13）

同一アプリの専用adapterを準備し、正式migrationをCLIで生成した。最新の実行前検証・本人用手順は `feedback-activation-handoff.md`、正式SQLは `supabase/migrations/20261013111933_fyth_feedback_daily_counts.sql`。実Supabase未適用・passwordなし・app LOGINは無効。通常集計30日とbackup別途残存可能性の区別はユーザー承認済みで、実際のbackup保持期間は親で確認する。旧分離サービス案は比較資料であり新規サービスは作らない。
