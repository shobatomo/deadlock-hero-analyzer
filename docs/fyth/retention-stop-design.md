# 保持期限異常時の集計停止 — 調査・設計のみ

Base fdd172bbb27c8628a5539b129d303ae729375ca8。実DB、role/権限、関数、migration、ENV、受付、公開は変更していません。既存SQLをネットワークなしのPG17.11 fixtureで検証しました。backupとusage自然Cron確認は親の別工程です。

## 既存で防いでいること

feedback increment_choice、usage increment_eventは、UTC transaction日付todayに対する `day < today - 29` のDELETEと当日countのINSERT/UPSERTを同じautocommit statement内で実行します。例外をcatchして部分commitするSQLはありません。DELETEがlock/timeout等で失敗すれば加算もcommitされず、DELETE成功後のINSERT失敗もDELETEをrollbackします。成功した新規加算と同時に古い行を残す通常経路はありません。重複する追加DELETEやappの直接SELECT/DML権限は不要です。

feedbackはREAD COMMITTED検証、全体advisory lock、1000/day上限をDELETEより前に確認します。busy/上限拒否では加算も削除も実行しません。usageは固定event検証後にDELETEを実行。無アクセス、runtime OFF、無効入力、feedback拒否だけが続く場合、inline削除は動きません。

DB statement/lock timeoutで例外になる場合はstatement全体rollback。client timeout/通信断だけではrollbackしたと断定できません。COMMIT後の応答喪失なら加算＋削除とも保存済みの可能性があり、APIはunknown/再送不可、usageは再試行なしです。既存の判断を変えません。

## 残る障害ケース

| 障害 | 新しい件数 | 古い集計 | 判断と対処 |
|---|---|---|---|
| Cron失敗・未実行、次の正常加算あり | 正常加算できた分は保存 | その加算で削除される | inlineの保護は有効。ただし無アクセス時の保護が失われるのでCronを復旧 |
| Cron失敗・未実行、無アクセス/全拒否/OFF | 保存なし | 次の正常加算/正常expiryまで残り得る | 停止だけでは解決しない。既存maintenanceで削除・確認が必要 |
| expired DELETEがlock/statement timeout | 該当加算は未commit | rollbackで残る | 加算は既に防止。古い行の存在とjob障害を確認し、競合解消とmaintenance復旧 |
| DELETE後のINSERT/UPSERT失敗 | 未commit | 削除もrollbackして残る | 同上。追加の非transaction削除を挟まない |
| COMMIT後の応答喪失 | 保存済みかもしれない | 成功transactionなら削除済み | unknownのまま再試行しない。失敗表示だけで期限異常とは断定しない |
| cleanup成功でも日次jobが将来停止 | 直後は保持範囲内 | 次のUTC日付境界以降に古くなり得る | 現時点の0旧行だけで将来の保持運用を保証しない |
| DB停止/接続不能 | 新規commitなし。ただし進行中は不明 | 保存済み行は残る | 受付を止めても消せない。復旧後にexpiryと状態確認 |
| backup/restoreの残存コピー | 通常DBと別 | appのDELETEでは消えない | parentのbackup調査へ。これを集計停止で解決したとしない |

UTC当日+過去29日のfilterは維持。日次jobの通常実行窓はfeedback00:00UTC/09:00JST、usage00:05UTC/09:05JST。UTC00:00～usage実行までの短いズレ、短いtransactionの日付境界越えは既存構成の性質です。厳密な720時間/全コピー消去は保証しません。新しい停止猶予を決めてもDELETE cutoffを変更しません。

## timeoutの具体的な差

アプリfeedbackはconnect2s/query3s/statement2s/lock500ms/API5s。usageはconnect1s/query1s/statement800ms/lock100ms、queue最大4。client待ち行列/応答期限はDBのrollback保証ではありません。通常はautocommitで長いtransactionを作りません。

usage jobはcommand内にstatement5s/lock500msがあります。repositoryのfeedback job草案と配布済みmanual stage2 commandには明示timeoutがなく、実executor設定に依存します。SET LOCAL ROLEではALTER ROLEのsession設定が再適用されないため、アプリroleの設定からCronの上限を推定しません。親が実cron.job commandとexecutor設定を非秘密で確認する必要があります。

優先する小さい変更案は、確認後にfeedbackの既存job commandへusageと同じSET LOCAL statement_timeout5s/lock_timeout500msを加えること。新role/grant/tokenは不要ですが、実job更新は別承認・操作です。これは待ちっぱなしを防ぐだけで、自動停止・削除成功を保証しません。

## 自動受付停止の最小設計案（未実装）

DB側の既存increment関数内で、同schemaのprivate singleton「削除成功lease」を確認してから加算を受理する案。既存expire_countsが削除とlease更新を同一transactionで行い、成功COMMITだけがleaseを更新します。Cron失敗や未実行で更新されなければ、次の締切後にincrementは固定not_storedを返します。診断本体は現状どおり影響させません。新しいVercel更新token、別監視サービス、appへのcron catalog閲覧、広い権限追加は不要です。

各schemaのNOLOGIN ownerが自身の小さな運用markerを所有し、既存maintenanceのexpiry EXECUTEだけで更新。app LOGINは既存increment EXECUTEだけ、markerの直接読書きは不可。新しいschema/table/関数インターフェースを公開せず、既存関数定義の変更とprivate運用状態追加のmigrationを別途レビューします。これは今回の収集3fieldとは別の非個人運用状態であることも確認します。

例の停止締切は、feedback翌日の00:05UTC、usage翌日の00:10UTC（予定job+5分の確認猶予）。5分は設計例で未承認。初回markerなし/状態不明はfail-closed。確認猶予、成功判定、初回正常expiryでのbootstrap、復旧後の再開条件を本人/親が決めてから実装します。単なる古いrowの有無チェックは無アクセス時に実行されず、単なるcron失敗時ENV変更は継続アクセスと反映deployが必要になるため、この案より大きい構成です。

stopは「新規加算拒否」の意味です。見た目のfeedbackフォームまで自動disabledにするなら別の限定状態取得/表示設計が必要で、今回追加しません。すでに進行中のSQLはCOMMITし得るため瞬時全停止とは言いません。marker期限が過ぎても古いrowを削除できるのはmaintenanceだけで、停止とpurge復旧の両方が必要です。lease成功後に削除能力が壊れた場合、締切まではinline失敗により該当加算をrollbackし、以後はleaseで拒否する想定です。

## 既存権限で可能な確認と別承認操作

親の既存管理経路: 対象named jobのactive/schedule/command/timezone/latest successful runを読む。既存owner SET権限で各counts tableの `EXISTS(day < UTCtoday -29)` と最古日を読み、件数/booleanだけ確認。app/submitter/maintenanceへSELECTを付けない。job成功だけでold-row不存在を省略しない。

別途必要な実操作: job command更新、lease migration/既存関数改訂、初回expiry/bootstrap、停止時の限定maintenance実行、再開、必要時の各単独flagfalseと反映deploy。いずれも今回実行なし。NOLOGINだけでは既存sessionを止めず、false ENVだけでは既存deployへ即時反映されない。緊急のsubmitter membership revokeは対応featureのみを止める別レビュー操作で、既存statementをkillする保証はなく、古いrowも消えません。

## 検証

`node tests/fyth-retention-failures.mjs`: 既存SQLの正常削除+加算、expired行lock timeout、DELETE後INSERT制約失敗のrollback、feedback quota/advisory拒否前の削除省略、maintenance失敗で旧行残存、SET ROLEでtimeoutが入らないこと、既存maintenanceの復旧を検証。leaseは純粋fixtureモデルのみで、DB関数/marker/migrationは作成していません。

References: https://www.postgresql.org/docs/17/sql-set-role.html ; https://www.postgresql.org/docs/17/functions-datetime.html .


## 親側の実DB読取結果（本taskで変更なし）

親報告: job1はactive/UTC00:00、2026-10-14の実行成功。job2はactive/UTC00:05、commandのstatement5s/lock500msを確認、履歴はまだなく初回予定は2026-10-15 09:05JST。初回予定前の履歴なしを故障とは扱いません。backup設定はconnectorに取得機能がなく未確認です。

現時点の自動停止は未実装です。job1の明示timeoutの有無とexecutor設定を確認してから、最小変更として既存job1 commandだけへstatement5s/lock500msを追加する相談ができます。role/grant/login/接続予算の差分はなく、変更は親の既存管理権限によるjob更新のみ。競合が長い場合は削除を打ち切って古い行を残すため、失敗確認と復旧が必要です。

日次のnamed-job成功/期限超過行確認＋既存maintenanceでの削除復旧による当面運用は、検出までの時間・担当者不在・DB停止・restore・backupコピーを自動で解決しません。受付停止しても旧行は消えません。初回確認を含め、毎日09:05JST以降の確認担当と、異常時の限定停止/削除/再開手順を決める必要があります。自動停止案はsingleton leaseと既存関数改訂が別承認となる設計案に留まります。
