# 独立レビューと修正結果

2026-10-13、独立エージェントによる読み取りレビューとモック再実行を実施。編集と外部変更は担当エージェントのみ。レビュー担当は資格情報・DB・push・deployを扱っていない。

## 指摘と対応

| 指摘 | 対応 |
| --- | --- |
| 中：malformed/oversize JSONが共通エラーになり、未保存が確定してもUIがunknownで止まる | feedbackだけに400/413 not_stored/retryableを追加。unsupported charset/encodingも415 not_stored。sink未到達と応答本文を検証。diagnosisの既存error JSONは維持 |
| 中：timeout後も保存処理が残るため無制限の並行起動が可能 | 匿名プロセスguard（30/min、同時2）を保存前に追加。timeout後もpromise実終了まで枠を保持。429/not_storedとwindow更新、実完了後の枠解放をテスト |
| 接続前必須：無回答期間の30日削除 | daily expiry・監視・失敗時停止・復旧を接続の有効化条件として具体化。backupを含む保持条件も未確定のまま有効化しない |
| 管理者による全件削除手順なし | 別承認の特定table TRUNCATE/期間DELETE手順を文書化。runtimeには削除権限を付与しない。実行なし |
| 非回帰テストがready fixture中心 | missing input、取得失敗、abort、中止後再試行、nonreadyでfeedback API未呼出をUIテスト追加。診断APIのparse/error応答維持もテスト追加 |

レビューでは、choice-only/no-cookie/no-referrer、正確な質問/選択肢、readyの任意導線、確定保存時のみ成功、unknownロック、native radio/legend/status、44px target、private集計3列と限定function権限を確認した。修正後の独立再レビューでも重大な追加問題なし。独立でAPI5件の成功を確認し、担当が診断非回帰を含む最終一式を検証する。

## 差分と限界

今回の追加差分はbackend guard/parser契約、API・UI非回帰テスト、接続案とレビュー記録。推薦計算・既存データ取得ロジックは変更していない。公開manifestの対象/hashを更新し、配布検証を継続する。

guardは各processの安全弁であり、Vercelの複数instanceを横断するquotaではない。SQL草案のglobal advisory lockと日次1000件の予算が承認・実検証されるまで本番接続しない。識別子なしでは一人一回答を保証できない。スクリーンリーダー実機、実SQLの権限/日付境界/並行更新、gateway、Supabase Cron、Vercel runtime、実保存は未検証。機能は既定未接続のまま。


## 最終確認

担当による最終実行はAPI6件、UI11件、public bundle（103 source / 55 artifact / sensitive hits 0）、Chromium4シナリオ、git diff --checkすべて成功。独立担当はSQL/接続案を再確認し、重大な追加問題なし。追加助言に従い、READ COMMITTED/autocommit固定と草案の異なる分離レベル拒否、poolerとdriverの実接続枠検証を追記した。SQL草案の実行・DB権限付与・データ削除・外部設定・push/deployは行っていない。
