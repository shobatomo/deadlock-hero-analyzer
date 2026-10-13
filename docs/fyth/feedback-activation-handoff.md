# 承認済み3択：正式SQL・adapter・本人用手順

## 今回の到達点

対象は Vercel deadlock-fyth / prj_eknZdUrfiSOL4eOdfK3OEODut17w / team_H1BMitz1DUJuT83Bx7ofDF8X、Supabase Deadlock FYTH / adxoqjgmhmortztqngcz / ap-northeast-1 / PostgreSQL17.11。

承認された同一アプリ方式を実装準備した。既存readerコード/設定/権限は不変。任意理由・行動analytics・新規イベント保存は含まない。実Supabase接続/変更、資格情報操作、push/deployは未実施。3択回答もまだ実DBに保存されていない。

正式migration: `supabase/migrations/20261013111933_fyth_feedback_daily_counts.sql`。Supabase CLI2.120.0のmigration newで生成後、SQLを記入。ホストCLIがread-only homeへの書込で失敗したため、資格情報を持たないnetwork-noneの使い捨てcontainerで生成した。ホストhomeや既存CLI認証設定はmountしていない。

正式SQLはpasswordなし、app roleをNOLOGINで作る。既存role名/schema名が衝突すればtransactionごと失敗し、勝手に既存roleやschemaを変更しない。non-superuser管理者でも所有権を移すため、migration実行管理者に新規owner/maintenanceへのSET membershipのみ（INHERIT FALSE）を付与し、schema作成後SET LOCAL ROLE ownerで限定DDLを行う。アプリはsubmitter membershipのINHERIT TRUE/SET FALSEだけ。

## Adapter

`public-app/backend/feedback-store.js` は専用login `fyth_feedback_app_login` と指定project refの直結/poolerだけを受理。TLS certificate検証を強制しURI query flagsは除去。接続Poolはmax1/instance、connect2秒、statement2秒、lock500ms、client query3秒、READ COMMITTED startup設定。poolerがこれらを受理するかは実環境で未確認。

固定SQL `SELECT fyth_feedback_private.increment_choice($1) AS status` を1回だけautocommitでawaitする。パラメータはchoiceだけ。queryの完了前にstoredを返さず、結果不明/driver失敗は再試行せず上位APIでunknown。not_storedだけ確定未加算として扱う。既存reference readerのexecutorは使わない。

`FYTH_FEEDBACK_ENABLED` が正確にtrueの場合だけ接続値を読む。false/未設定はPoolを作らず停止、trueでもmissing/wrong target/invalid configurationは受付false。module importやPool作成だけではネットワーク接続しない。本人が秘密設定を入れるまでfalseを維持する。Frontendは未接続で無効、commit確認のみ成功、unknown再送停止。通常集計30日とbackup残存可能性を案内する。

## 完了した隔離検証

Docker公式postgres:17.11-bookworm、digest sha256:3645570cccdfa447589da9f57dd740faa29b30938e861289a5574b6ca6b03826、network none、port公開/host DB mountなし、trust認証の合成roleだけ。passwordを作らず、テスト後containerを削除する。

`tests/fyth-feedback-sql.mjs` で以下を実PG17.11上で確認：

- superuserでないCREATEROLE管理者から正式migration適用成功。readerのACL/config不変。
- 6つの非管理roleすべてがtable直接SELECT/INSERT/UPDATE/DELETE/TRUNCATE/CREATEを拒否される。
- appはowner/reader/submitterへのSET ROLE、既存reference読取、expiryを拒否される。maintenanceはincrementとtable読取不可。
- 正確な3choiceだけ集計、同じchoiceは同じday行の件数が増える。列はday/choice/countのみ。
- 不正choice/REPEATABLE READは加算なしで拒否。
- advisory lockが別sessionで保持中なら加算なしnot_stored。解放後復帰。
- 999件から8並行attemptで成功は1つだけ、結果1000、追加加算拒否。
- 前日の1000件は今日の上限に影響しない。session timezone変更でもUTC day。
- 無回答のままmaintenanceを実行し、day-29を保持、day-30以下を削除、30日付残る。
- 加算時も期限削除。実PGはadapterのstartup隔離設定を受理。
- pg_cronがない場合、Cron SQLは安全に停止する。実schedulerは未検証。

Adapter mock6件、既存API6件、UI11件、公開bundle検証を追加実行。独立reviewはadapterとSQLを確認し、重大な追加問題なし。realpooler、実Cron、TLS実接続、実password認証は未検証。

再現：Node22で `npm --prefix public-app run build` → `npm --prefix public-app test`。Dockerが使える環境で `node tests/fyth-feedback-sql.mjs`。既存browser verifierも利用可能。Node24が標準なら `npm --cache /tmp/fyth-npm-cache exec --yes --package=node@22 -- ...` を使う。

## 親での実行前確認

1. `docs/fyth/feedback-preflight.sql` はread-only。対象project/current_user/version、新規role/schema衝突、pg_cron、timezone、既存PUBLIC grantを確認する。pg_authid/password/URL/users/dataは読まない。
2. 全roleはPUBLIC grantを継承する。新規grantは限定しても、既存のPUBLICが別の機密objectへアクセスを許す場合は止めて別review。既存全体grantをこのmigrationで変更しない。
3. 正式migration全文を親で確認し、同じprojectに限定して適用を判断する。子は実Supabaseへ適用していない。既存readerに変更がないこと、NOLOGIN/SET FALSE/RLS/private/public revokeを確認する。
4. `docs/fyth/feedback-retention-job.sql` は別実行案。pg_cronが既にある場合だけ、job名衝突なし・UTC/GMTで日次00:00を登録する。管理者のSET maintenance権限と実際のjob成功、監視/失敗復旧を実対象で確認。必要なextension追加/cron権限等が未承認なら止める。
5. 通常集計は30日、backup/PITRは別途残る可能性があるという承認。実際のbackup/log保持を確認して報告し、既存backup設定は無断変更しない。全コピー30日を保証しない。
6. 複数instance共通の同時増分1・1000/dayはDB関数で強制。appの30/min・同時2はprocessだけ。advisory namespace(190846237,1)の既存利用との競合確認とpooler接続方式の検証を行う。匿名回答件数であり一人一回答保証なし。

## 本人操作：passwordと秘密入力

この工程は子も親もpasswordを生成/参照/入力する必要がない。本人が行う。

1. 親による正式SQL/role/retention確認後、本人PCの信頼するpsqlを使い、Dashboardで確認した管理者のhost/port/user/CAによってTLS検証付きで対象projectに接続する。passwordは対話promptへ入力し、コマンド行やチャットへ貼らない。同じ承認済みmigration管理roleを使い、権限不足なら追加grantせず親へ戻す。
2. psqlで `\password fyth_feedback_app_login` を実行し、本人がpassword managerで作った専用passwordを2回入力する。SQL editorの履歴・repo・共有チャットに平文passwordを書く方法は使わない。
3. password設定後、本人の同じ管理者sessionで `ALTER ROLE fyth_feedback_app_login LOGIN;`。これはまだ自動実行していない。`fyth_reader`のpasswordや設定は変更しない。
4. Dashboardの接続方式に合わせ、専用userのURIを本人のpassword managerで組み立てる。直結userは `fyth_feedback_app_login`、poolerは `fyth_feedback_app_login.adxoqjgmhmortztqngcz`、DBはpostgres。passwordのURI percent-encodeに注意。公開アプリのadapterは別ref/reader/admin userを受理しない。
5. Vercelの確認済みdeadlock-fyth projectのProductionだけに `FYTH_FEEDBACK_DB_URL` secretを本人入力。`FYTH_FEEDBACK_DB_CA_CERT`は公開CA、`FYTH_FEEDBACK_ENABLED=false`を維持。Preview/Development、VITE_*、repo/.env/chatへ秘密を追加しない。gateway/service_role/一般writer/CRON_SECRETは不要。
6. 本人接続または親の承認済み検証でTLS・current_user・transaction isolation・pooler startup/timeoutを確認する。既存readerやtable直接権限を追加してエラーを直さない。失敗はURL/passwordを除いたエラーだけ共有する。
7. code公開/deployは親が許可範囲を確認して行う。migration/実job成功/backup期間/権限拒否/実接続の確認が終わってから、本人がProductionの `FYTH_FEEDBACK_ENABLED=true` を設定し、必要な反映deployを行う。接続確認前にtrueにしない。
8. 最初の実回答でUIのcommit確認、管理者のday/choice/count集計だけを確認する。個別イベントは作らない。問題時はfalseへ戻し、必要なら専用LOGIN無効化・接続終了。停止しても日次expiryは維持する。

上記は本人用future手順であり、password設定・LOGIN有効化・秘密入力・実DB操作・deployは未実施。ちょこちゃんへの継続的な新規閲覧権限や分析スケジュールもこの準備では追加していない。改善のための任意理由/行動測定は別承認の次段階。

最終結果：API6 + adapter6 + UI11、公開bundle105 sources/55 artifacts/sensitive hits0、Chromium4シナリオ、差分check成功。正式SQL最終版はnetwork-none PG17.11で再実行して全境界検証成功。専用ownerの将来functionのPUBLIC EXECUTE defaultもrevokeし、隔離probeで拒否を確認。test runnerは初期化用temporary serverを誤検知しないようTCP readinessを使用。使い捨てDBはすべて削除済み。

実接続前の追加read-only確認：通常/エラー/audit SQLログがchoiceのbind値を個別記録しないこと。preflightにpg_settingsの非秘密metadataのみを追加。特にlog_parameter_max_length_on_error等を確認し、必要ならログ設定の変更は別review（既存全体設定をこのmigrationで変更しない）。アプリのbody/errorログは追加していない。バックアップの実保持と同様に、この確認が終わるまで有効化しない。

## 最終gateの現状（親への明示）

日次削除失敗時の**自動**受付停止は、現時点では設計/運用要件であり実装されていない。公開APIはCron状態を読み取らず、FYTH_FEEDBACK_ENABLEDによる起動時gateだけ。加算時expiryはあるが、無回答期間のjob失敗を検知する代替ではない。Cron有効化/登録/成功監視と停止担当が確定するまでProductionをtrueにしない。将来コードで自動fail-closedを担保するなら、対象jobだけの最終成功/失敗を取得する限定health経路とその権限・初回run条件を別途レビューする。現roleへcron全体閲覧やVercel自動更新tokenを勝手に追加しない。

停止のfalse設定は既存deployへ即時反映されないため、設定後の反映deployが必要。緊急に新規加算を止める場合、親が専用role範囲で `REVOKE fyth_feedback_submitter FROM fyth_feedback_app_login` を確認して実施する案を用意する。NOLOGINだけでは既存sessionを終了できない。既に進行中の処理は結果不明の可能性がある。ここでは停止SQL・LOGIN変更・deployを実行していない。

## 無効のまま接続確認する具体的手順

新規コマンド `npm run feedback:check-connection` は本人によるローカル明示実行だけ。通常のruntime disabledとは別の手動probeとして、専用接続値を読み、metadataのSELECT1文だけを実行する。public APIを有効にせず、加算/expiry関数呼出・counts row読取・DB変更はしない。current/session role、隔離レベル、timeout、関数ACL/tableACL/schemaCREATE/ownerとmaintenanceへのSET権限を確認する。出力はpassed/failedとwrites0/cron_verifiedfalse/backup_verifiedfalseのみ。raw error/URL/password/CA値は表示しない。

本人PCのpublic-appでnpm ci後、Bash例：

```bash
read -r -s -p '専用接続URI（表示しません）: ' FYTH_FEEDBACK_DB_URL
export FYTH_FEEDBACK_DB_URL
export FYTH_FEEDBACK_ENABLED=false
# 公開CAが必要なら、本人の公開CAファイルから設定する。
# FYTH_FEEDBACK_DB_CA_CERTは秘密鍵ではない。URIをコマンド行へ貼らない。
npm run feedback:check-connection
unset FYTH_FEEDBACK_DB_URL FYTH_FEEDBACK_DB_CA_CERT
```

CA設定が必要な場合は本人のshellで `FYTH_FEEDBACK_DB_CA_CERT="$(cat /本人の公開CAファイル)"` をexportする。上のコマンドは子で実行していない。Node22が必要。Vercel Productionもfalseを維持する。このローカル成功は専用接続のmetadata確認に限り、Vercel runtime/network、Cron、backup、実保存の成功ではない。Vercelにprobeの公開URLや管理tokenを追加しない。

## 親による実対象のread-only監査結果

親の報告：正しいproject/PG17.11、postgresは非superuser CREATEROLE、4role/schema/object衝突なし。既存PUBLICはpublic schema USAGEとDB CONNECT/TEMPORARYがあるが、reference fyth_private USAGE、業務table/column、非system関数のPUBLICアクセスなし。「EXECUTEだけ」は新規業務権限の意味で、既存PUBLIC権限を変更しない。log_statement=ddl、error bind length=0、pgaudit none/parameter off。正常bind length=-1なので、parameterized SQLと入力値入りerror/log禁止を維持する。

pg_cron1.6.4はavailable/preloadedだが未インストール。拡張有効化とexpiry登録は親の追加承認待ち。DB/session UTC、cron GMT。backup実保持は現connectorで確認できず、本人Dashboard確認が残る。Free orgという情報だけから保持日数を推測しない。これらは親の監査報告で、子が実対象へ接続した結果ではない。
