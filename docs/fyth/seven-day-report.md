# FYTH 7日読み取りレポート

対象は Deadlock FYTH / `adxoqjgmhmortztqngcz`。UTC当日＋過去6日、各7行の保存件数を読みます。当日分は途中です。保存・保持期限・既存role/権限・環境変数・アプリ/API/UIは変更しません。

## 親が既存の管理コネクタで取得

1. `seven-day-usage.sql` を既存の承認済み管理経路で実行し、SELECT結果7行を取得。
2. `seven-day-feedback.sql` を同様に実行し、SELECT結果7行を取得。

両schemaのownerは別で、migration管理者のSET membershipはINHERIT FALSEの場合があります。アプリLOGIN・submitter・maintenance・reference readerへSELECTを追加しません。直接SELECT権限がない場合は、管理者の既存SET membershipを使い、usageは `fyth_usage_owner`、feedbackは `fyth_feedback_owner` として別々に読みます。既存管理方法で対応できない権限エラーを新規GRANTで解消せず、親へ報告します。

既存管理経路が対応する場合の実行ラッパーは、`BEGIN READ ONLY; SET LOCAL ROLE <該当owner>;`、対象ファイルのSELECT、`COMMIT;`。成功時はCOMMITし、失敗時はROLLBACKしてroleを戻します。コネクタがラッパー内のSELECT行を返せることを確認し、SELECT結果だけを以下の入力へ渡します。空のコネクタ応答や失敗を0件の行へ置き換えません。SQLファイル自体はWITH/SELECTのみで、加算/期限削除関数の呼出・DDL/DML・GRANTはありません。

取得SQLは日付を埋めるため、保存rowがない日も0件になります。件数はPostgreSQL bigintの精度を保つ10進文字列です。2テーブルを先にそれぞれ日別集計するので、usage5種×回答3種の結合による重複加算はありません。SQLは既存のday/event/choice/countだけを参照し、個人情報・生履歴・エラー本文を読みません。

## ローカル整形（DB接続なし）

親が返った7行ずつを `report-input.json` にまとめます。値はSQLのSELECT結果をそのまま使います。

    {"usage": [usageの7行], "feedback": [feedbackの7行]}

リポジトリのルートから:

    node tools/fyth-seven-day-report.mjs report-input.json

出力はUTC日付、5イベント件数、正確な3択の回答件数、各7日合計と読み方です。必要なら本人のローカル操作で標準出力を保存できます。スクリプトは環境変数・資格情報を参照せず、DBやネットワークへ接続しません。入力ファイルは本人が指定した集計JSONのみです。無関係な個人情報field、欠落、重複日付、期間不一致、不正件数は固定 `report_input_invalid` で拒否し、内容やパスをエラー表示しません。

2回の取得は別スナップショットで、取得の間にも件数が増えることがあります。UTC00:00をまたいで2回の取得を行うとwindow_end_utcが不一致になり、結合を拒否します。同じUTC日付範囲で両方を読み直してください。7日×2の行を取得できない場合もレポートを出しません。

## 解釈の限界

- 件数はユーザー数ではありません。同じ利用者の連続実行・本人テスト・新しい要求としての再試行を分離できません。
- readyはサーバー応答完了で、画面描画・本人の閲覧確認ではありません。
- usageと回答は個人単位に結合できません。途中の保存失敗、接続切断、UTC境界で各件数が一致しないことがあります。終端合計がrequestedを上回る場合も拒否・修正しません。
- 0件補完は、その日・項目の保存行がないことだけを意味します。計測開始前の利用がゼロだったとは言えず、未導入・受付停止・欠測・利用なしを区別できません。
- ユーザー離脱率、改善効果、ヒーロー別評価は計算・断定しません。少数データだけで断定的な変更提案を出しません。
- このtaskでは本番値を取得していません。fixtureは架空の例で、本番実績ではありません。

## 検証

    node --test tests/fyth-seven-day-report.test.mjs
    node tests/fyth-seven-day-report-sql.mjs

前者は期間/精度/欠落/識別情報排除/固定エラーのfixtureテスト。後者はネットワークなしの使い捨てPG17.11で、架空schema/table、SELECT-onlyのNOLOGINテストrole、READ ONLY transactionを使い、UTC境界・0日補完・二重加算なし・bigint・fixture不変を確認します。本番SQL実行、実管理経路の結果取得は親での未実施確認です。公開管理画面/API・資格情報・権限追加・定期実行はありません。
