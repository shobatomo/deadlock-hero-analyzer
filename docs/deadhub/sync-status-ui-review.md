# 同期の実行状況 UI — ローカルレビュー

基準: `deadhub/record-mvp` / `9bbf0d9796e6646608f41b42f6e75f99226566d7`。
この変更はローカル実装のみ。commit / push / deploy は行っていない。

## 表示と読取り

- 登録・同期パネルの最終照会時刻の近くに「同期の実行状況」を追加。初期状態は閉じており、カレンダーを従来どおり主画面に置く。
- 開くと既存の `GET /api/deadhub/sync-runs` を同一オリジンのセッションで読む。クライアントから所有者・アカウント・取得経路を指定しない。バックエンド・認証・RLS・DB・環境変数の変更なし。
- 手動更新、初回登録時の取得、定期取得用の経路を分け、成功 / 失敗 / 一部取得 / スキップ / 未完了（終了記録なし）を明記。日時は JST。
- 開き直し・「状況を再確認」・手動更新や登録の応答後に再読取り。閉じている間や月・日・ヒーローの選択では読まない。自動ポーリングや通知は追加しない。
- 記録なしは未実行の証明ではない。読取り失敗や不正な応答は「実行の有無・結果は不明」。この補助表示の失敗でカレンダーや保存済み試合を消さない。
- 定期取得用の経路は手動呼出しも含むため、スケジューラーが予定どおり起動した証明には使わない。
- 直近の成功でも以前の失敗と未完了件数を残す。終了記録がない状態から実行中・中断・監査記録の欠損を断定しない。
- 処理件数の 0 を保持。再取得を含む件数であり、新規試合数や全履歴の取得保証とは表示しない。
- 読取りは8秒で打切り。閉じる・ログアウト・利用者変更時に中止し、中止を無視する遅延応答も表示しない。API の自由文エラーや未知の結果コードを画面へ出さない。

## 変更ファイル

1. `public-app/frontend/src/pages/Deadhub/Deadhub.jsx` — 折りたたみ表示の配置と同期後更新。
2. `public-app/frontend/src/pages/Deadhub/SyncRunDetails.jsx` — 独立した読取り・状態表示・再確認。
3. `public-app/frontend/src/pages/Deadhub/SyncRunDetails.css` — 控えめな表示、PCの3列とスマホの1列。
4. `public-app/frontend/src/pages/Deadhub/syncRunView.mjs` — 固定 API 契約の検証、日本語文言、JST 表示。
5. `public-app/public-manifest.json` — 変更ソースのハッシュと追加ファイル。
6. `tests/deadhub-sync-status-ui-offline.test.mjs` — 24テスト。状態、欠損、失敗、タイムアウト、競合、ログアウト、利用者切替、既存画面の維持。
7. `tests/deadhub-sync-status-browser.mjs` — 1280 / 390 / 320px、各7状態、キーボード・タッチ、再確認、コントラスト、はみ出し。
8. `tests/fixtures/deadhub-sync-runs.mjs` — 合成データ。実ユーザーや本番の実行を表すものではない。
9. この文書。

## ローカル検証手順

Node.js 22 を使用。インストール済みの依存関係だけを使用する。

```powershell
$cases=Get-ChildItem tests -Filter 'deadhub-*.test.mjs' | ForEach-Object FullName
node --experimental-test-module-mocks --import ./tests/deadhub-review-register.mjs --test $cases
node public-app/frontend/node_modules/vite/bin/vite.js build public-app/frontend
node public-app/scripts/verify-public-bundle.mjs
node tests/deadhub-sync-status-browser.mjs <playwright/index.mjs> <chromium.exe> <出力先>
node tests/deadhub-hero-history-browser.mjs <playwright/index.mjs> <chromium.exe> <別の出力先>
```

ブラウザーテストはローカルのビルド済み画面と模擬 API 応答を使用する。外部通信は拒否し、実同期・実 cron・本番 DB への操作はしない。スクリーンショットには模擬データの注記を入れる。ローカル結果と画像はレビュー成果物の `RESULT.json` と `browser/` に保存。

## 検証限界と公開前の承認範囲

- 本番の認証済みユーザーによる実行記録の表示、自然なスケジューラー起動は未確認。模擬データの画面テストを本番の実行証拠として扱わない。
- 前工程の本番 DB 検証では `SET LOCAL ROLE deadhub_app_login` が `ERROR: 42501: permission denied to set role "deadhub_app_login"` で拒否された。今回その操作を再試行せず、別経路による代替検証や権限追加もしていない。本番ロールでのその検証は未確認のまま。
- ローカル Chromium のタッチエミュレーションで確認。実機 Safari / Android の検証は含まない。
- 公開にはこの9ファイルの差分をレビューし、別途 commit / push / deploy の GO が必要。新しい DB マイグレーション、認証・権限・環境変数変更、通知、外部監視はこの変更の承認範囲に含めない。
- 公開後に実データで確認する場合は通常の本人ログインと正規の既存操作を使う。権限を迂回する検証を行わず、自然 cron の証拠は別に扱う。
