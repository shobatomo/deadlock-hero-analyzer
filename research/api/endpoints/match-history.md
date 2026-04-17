# Endpoint

GET /v1/analytics/match-history

---

## Description

プレイヤーのマッチ履歴情報を取得

---

## Request Example

https://api.deadlock-api.com/v1/analytics/match-history?account_id=888807526

---

## Response Fields

| field | type | description |
|------|------|-------------|
| account_id | number | アカウントID |
| match_id | number | マッチID |
| hero_id | number | 使用ヒーローID |
| hero_level | number | ヒーローレベル |
| start_time | number | 試合開始時刻（Unixタイムスタンプ） |
| game_mode | number | ゲームモード |
| match_mode | number | マッチモード |
| player_team | number | プレイヤーのチーム（0または1） |
| player_kills | number | キル数 |
| player_deaths | number | デス数 |
| player_assists | number | アシスト数 |
| denies | number | デナイ数 |
| net_worth | number | ネットワース |
| last_hits | number | ラストヒット数 |
| team_abandoned | boolean | チームが放棄したかどうか |
| abandoned_time_s | number | 放棄時刻（秒、nullの場合は未放棄） |
| match_duration_s | number | 試合時間（秒） |
| match_result | number | 試合結果（0: 勝利、1: 敗北） |
| objectives_mask_team0 | number | チーム0のオブジェクトマスク |
| objectives_mask_team1 | number | チーム1のオブジェクトマスク |
| brawl_score_team0 | number | チーム0のブラウルスコア（nullの場合は該当なし） |
| brawl_score_team1 | number | チーム1のブラウルスコア（nullの場合は該当なし） |
| brawl_avg_round_time_s | number | ブラウル平均ラウンド時間（秒、nullの場合は該当なし） |

---

## Notes

- hero_idでheroes endpointと紐付く
- account_idはクエリパラメータで指定
- 返される配列は、最新の試合から順に並んでいる
- match_resultは0が勝利、1が敗北を表す
- brawl関連のフィールドは、ブラウルモードの場合のみ値が設定される
