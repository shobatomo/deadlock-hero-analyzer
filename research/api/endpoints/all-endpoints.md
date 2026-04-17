# API Endpoints

このドキュメントには、Deadlock APIのすべてのエンドポイント情報が含まれています。

---

## GET /v1/analytics/players-hero-stats

### Description

プレイヤーのヒーロー別統計情報を取得

### Request Example

https://api.deadlock-api.com/v1/analytics/players-hero-stats?account_id=888807526

### Response Fields

| field | type | description |
|------|------|-------------|
| account_id | number | アカウントID |
| hero_id | number | ヒーローID |
| matches_played | number | プレイした試合数 |
| last_played | number | 最後にプレイした時刻（Unixタイムスタンプ） |
| time_played | number | プレイ時間（秒） |
| wins | number | 勝利数 |
| ending_level | number | 平均終了レベル |
| kills | number | キル数 |
| deaths | number | デス数 |
| assists | number | アシスト数 |
| denies_per_match | number | 試合あたりのデナイ数 |
| kills_per_min | number | 分あたりのキル数 |
| deaths_per_min | number | 分あたりのデス数 |
| assists_per_min | number | 分あたりのアシスト数 |
| denies_per_min | number | 分あたりのデナイ数 |
| networth_per_min | number | 分あたりのネットワース |
| last_hits_per_min | number | 分あたりのラストヒット数 |
| damage_per_min | number | 分あたりのダメージ |
| damage_per_soul | number | ソウルあたりのダメージ |
| damage_mitigated_per_min | number | 分あたりの軽減ダメージ |
| damage_taken_per_min | number | 分あたりの受けたダメージ |
| damage_taken_per_soul | number | ソウルあたりの受けたダメージ |
| creeps_per_min | number | 分あたりのクリープキル数 |
| obj_damage_per_min | number | 分あたりのオブジェクトダメージ |
| obj_damage_per_soul | number | ソウルあたりのオブジェクトダメージ |
| accuracy | number | 命中率 |
| crit_shot_rate | number | クリティカルショット率 |
| matches | array | マッチIDの配列 |

### Notes

- hero_idでheroes endpointと紐付く
- account_idはクエリパラメータで指定
- 返される配列は、プレイヤーが使用した各ヒーローの統計情報を含む

---

## GET /v1/analytics/hero-stats

### Description

ヒーローごとの統計情報を取得

### Request Example

https://api.deadlock-api.com/v1/analytics/hero-stats

### Response Fields

| field | type | description |
|------|------|-------------|
| hero_id | number | ヒーローID |
| bucket | number | バケットID |
| wins | number | 勝利数 |
| losses | number | 敗北数 |
| matches | number | 総試合数 |
| matches_per_bucket | number | バケットあたりの試合数 |
| players | number | プレイヤー数 |
| total_kills | number | 総キル数 |
| total_deaths | number | 総デス数 |
| total_assists | number | 総アシスト数 |
| total_net_worth | number | 総ネットワース |
| total_last_hits | number | 総ラストヒット数 |
| total_denies | number | 総デナイ数 |
| total_player_damage | number | 総プレイヤーダメージ |
| total_player_damage_taken | number | 総受けたプレイヤーダメージ |
| total_boss_damage | number | 総ボスダメージ |
| total_creep_damage | number | 総クリープダメージ |
| total_neutral_damage | number | 総ニュートラルダメージ |
| total_max_health | number | 総最大HP |
| total_shots_hit | number | 総命中ショット数 |
| total_shots_missed | number | 総ミスショット数 |

### Notes

- hero_idでheroes endpointと紐付く
- bucketは統計のバケット分類に使用される
- 返される配列は、各ヒーローの集計統計情報を含む

---

## GET /v1/analytics/match-history

### Description

プレイヤーのマッチ履歴情報を取得

### Request Example

https://api.deadlock-api.com/v1/analytics/match-history?account_id=888807526

### Response Fields

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

### Notes

- hero_idでheroes endpointと紐付く
- account_idはクエリパラメータで指定
- 返される配列は、最新の試合から順に並んでいる
- match_resultは0が勝利、1が敗北を表す
- brawl関連のフィールドは、ブラウルモードの場合のみ値が設定される

---

## GET /v1/analytics/player-performance-curve

### Description

時間ごとのプレイヤーのスタッツの情報

### Request Example

https://api.deadlock-api.com/v1/analytics/player-performance-curve?saccount_ids=76561198849073254

### Response Fields

| field | type | description |
|------|------|-------------|
| game_time | number | ゲーム時間（秒） |
| net_worth_avg | number | 平均ネットワース |
| net_worth_std | number | ネットワースの標準偏差 |
| kills_avg | number | 平均キル数 |
| kills_std | number | キル数の標準偏差 |
| deaths_avg | number | 平均デス数 |
| deaths_std | number | デス数の標準偏差 |
| assists_avg | number | 平均アシスト数 |
| assists_std | number | アシスト数の標準偏差 |

### Notes

- game_timeは10秒ごとの区切りで統計が集計される
- 返される配列は、時間経過に伴うプレイヤーのパフォーマンス曲線を示す
- saccount_idsはクエリパラメータで指定する
