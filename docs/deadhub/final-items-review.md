# 終了時所持アイテム表示 — レビュー案

基点: 845c16a9a08bfde5410fe8b19f4ce970b5ad2ffc。公開・実DB変更・権限変更は未実施。

## 取得・保存

既存の metadata 一括取得へ include_player_items=true を追加する。account_ids / only_filtered_players=true、既存のページ数・間隔・取得窓を維持し、試合別の追加問い合わせや解析キュー要求はしない。

日本語 assets はプロセス内で6時間キャッシュし、同時取得をまとめる。失敗時は60秒間再取得を控え、既存キャッシュがあれば再利用する。コールドスタート時には再取得が必要。公開応答は約6.4MB（2026-10-16確認）、上限12MiB・5秒。保存するのはID・名称・画像URLだけで、assetsの全応答や生の試合データは保存しない。

type=upgrade かつ sold_time_s===0 の装備だけを残す。sold_time_s が正の整数の売却・上位化前の旧品と、catalogで確認できた ability/weapon は除外し、flags は判定に使わない。明示的な売却済みレコードは不明IDでも所持対象外にできる。それ以外の不明ID、装備の時刻欠損、不正な一覧、利用可能なassetsがない場合は null とする。部分的な候補を完全な所持品として保存しない。明示的な空配列、または全レコードを非所持と判定できた場合のみ [] とする。同じ所持IDは一つにまとめ、順番をゲーム内スロット順と主張しない。

保存先は既存 matches の同じ owner_id / match_id 行。final_items JSONB に [{id,name,image}] を保存し、SQL NULL の再取得結果は coalesce で既存値を保持する。[] は確認済みの空一覧なので更新できる。既存成績の意味・分析・同期処理の構造は変えない。

## DB変更案と適用順

final-items-schema-proposal.sql は未適用のレビュー案。nullable JSONB列1つと配列数・サイズの制約を既存 private テーブルへ追加する。既存のowner別RLSと SELECT/INSERT/UPDATE 権限を使い、新たなGRANT、ロール、公開APIテーブル、関数は追加しない。

新規作成用 schema.sql にも同じ列と制約を反映する。稼働中DBへ schema.sql 全体を再適用せず、差分案のみをレビューする。DB上の適用・制約・RLS実行検証は今回行っていない（保存テストはSQL契約のモック）。

本人承認後にDB案を適用し、その後コードを公開する必要がある。先にコードを公開すると列不足で取得・同期が失敗する。旧コードは追加列をSELECT/INSERT/UPDATEの対象にしない。新規行の列値はNULL、既存行のアイテム値は旧コードの更新でも保持されるため、コードを戻す場合も列と保存データを残せる。

DDLは対象テーブルのACCESS EXCLUSIVEロックと既存行のCHECK検証走査を伴う。走査対象は本人の19件だけでなくmatchesテーブル全体。デフォルトなしnullable列なので既存データの書き直しは不要だが、ロック中の読み取り・同期は待機またはtimeoutし得る。ロック待ち3秒・各statement10秒で、失敗時はトランザクションを中断する。実行者にはテーブル定義変更権限が必要。既存アプリロールのtable-level SELECT/INSERT/UPDATEが新列にも及ぶため、新しいGRANTは不要。CHECKはSQL NULL、または32要素以下かつJSONBのテキスト表現が65,536 bytes以下の配列を許可する。各要素のid/name/image検証はアプリ側が行う。SQLは一度の適用用で、再実行時に既存列を変更・上書きする処理はない。

## 保存済み試合の補完範囲

既存行のfinal_itemsはすべてNULLで始まる。未完了windowがない通常同期は、開始を max(initial_from, coverage_until−7×24時間)、終端を今回の同期開始時刻（秒切捨て）とする。前回のcoverage_untilがなければ開始はinitial_from。last_success_atや最新試合日時はこの計算に使わない。initial_fromは初回登録時の30日前で固定される。「現在から直近7日」ではなく、前回完了した取得窓の終端からの7日重複であり、同期間隔が空くと対象期間も長くなる。

未完了windowがあれば保存済みwindow_from/window_untilとcursor_match_idをそのまま再開する。既にカーソルが通過したページを巻き戻さず、補完目的で範囲を広げない。APIは from <= started_at < until と match_id <= cursor（存在時）を条件に、新しいmatch_id順で取得する。1回は30件×最大3ページ（最大90件）、ページ間2.1秒、全体45秒、連続実行は60秒待ち。残りは次の同期へ持ち越す。metadataのリクエスト数は従来と同じだがitems分だけ応答量が増え、assetsのキャッシュがなければ最大5秒・12MiBの公開取得が1回追加される。APIが返すitemsを検証できた試合だけ補完され、再取得件数と補完件数は一致するとは限らない。

assetsの取得待ちも45秒の同期予算を消費する。metadataが3ページとも12秒近くかかる場合は36+4.2+5=45.2秒（DB処理時間を除く）となるため、キャッシュがないと中断・次回再開になる条件は増える。既に保存したページは保持される。キャッシュはプロセス単位で、コールドスタート間では共有しない。

保存済み19試合を全件走査する分岐はない。19件のstarted_at/match_idとaccountのinitial_from/coverage_until/window/cursorが今回提供されていないため、実際の補完件数は確定できない（0〜19件）。全19件が対象範囲内・残りページ内にあり、APIが返してitemsを検証できれば全19件が補完対象になる。範囲外の試合は0件、部分的に入るならその部分だけ。古い全履歴の自動バックフィルはしない。履歴の完全性と正確なゲーム内スロット順は保証しない。

processedは処理したAPIレコード数で、アイテム補完数ではない。試合全体の同期成功・coverage更新もアイテム取得の成功を保証しない。取得できないまま次の通常同期窓から外れた古い試合は、自動では補完されない。19件だけが対象窓のAPI応答に含まれ、全件のitemsが有効なら1ページで19件を補完できる。

## 表示と個人データ境界

アイコンを選択・タップ・キーボードフォーカスすると日本語名を表示する。画像が欠損・失敗した場合は枠内に名称を3行まで表示し、選択した名前の全文を下に表示する（名称の保存上限は120文字）。null は「未取得」、[] は「取得済みデータ上は所持アイテムなし」。許可した公式画像ホストのHTTPSだけを使い、Referrerは送らない。アイテム情報は従来の本人認証済み records 応答に含め、ユーザーIDをクライアント入力から受け取る経路を増やさない。

## 参照

- [Deadlock API の公式 OpenAPI](https://api.deadlock-api.com/openapi.json)
- [日本語 items assets](https://api.deadlock-api.com/v1/assets/items?language=japanese)
- [PostgreSQL ALTER TABLE: ロック・検証走査・nullable列追加](https://www.postgresql.org/docs/current/sql-altertable.html)
- [PostgreSQL GRANT: テーブルと列の権限](https://www.postgresql.org/docs/current/sql-grant.html)

## 検証結果

Node 22.22.1 と既存ロックどおりの依存関係で、既存100件と追加21件の計121件が成功。追加テストはアイテム選別・欠損と空一覧・assetsキャッシュ・再同期保持・同一試合のowner分離・既存認証境界・タップとキーボード・画像失敗を検証した。保存はSQL契約のモックであり、実DBの制約・RLS実行を検証したものではない。

本番ビルド成功。Chromeで1280・390・320pxの各幅において、通常12点・空一覧・未取得・画像失敗・長い名称の計15ケースが成功。横はみ出し、44px以上の操作領域、タップ、キーボード、同期後のカレンダーと分析表示を確認した。ダミーデータとlocalhostのみを使い、公式の公開アイコン2枚はローカルfixtureで応答した。実ユーザー・実Steam認証・実APIキー・実DBは使っていない。

詳細レポートと18枚のダミー画面は作業領域の validation-support に保存。実DBに対するmigration適用・SQL実行、コミット・push・デプロイは未実施。

2名の独立レビューでは所持判定・欠損時保持・本人分離・画像URL・DB互換性の修正必須欠陥は見つからず、追加21件のオフラインテストの再実行と、実store.acquire/syncを使う取得窓・カーソル・ページ上限の6モックケースが成功した。同期期間の「直近7日」という説明をcoverage_until基準の正確な式とカーソル再開条件へ修正し、追加取得コストとDBロックの影響を明記した。これらは実PostgreSQLでのDDL・CHECK・RLS実行検証ではない。
