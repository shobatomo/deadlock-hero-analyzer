# Endpoint

GET /v1/analytics/player-stats/metrics

---

## Description

プレイヤーの統計メトリクス情報を取得。各メトリクスの平均値、標準偏差、パーセンタイル値を含む。

---

## Request Example

https://api.deadlock-api.com/v1/analytics/player-stats/metrics?account_ids=888807526

---

## Query Parameters

| parameter | type | description |
|-----------|------|-------------|
| account_ids | number | プレイヤーのアカウントID |

---

## Response Structure

レスポンスは各メトリクス名をキーとするオブジェクトで、各メトリクスには以下の統計情報が含まれます。

| field | type | description |
|------|------|-------------|
| avg | number | 平均値 |
| std | number | 標準偏差 |
| percentile1 | number | 1パーセンタイル値 |
| percentile5 | number | 5パーセンタイル値 |
| percentile10 | number | 10パーセンタイル値 |
| percentile25 | number | 25パーセンタイル値（第1四分位数） |
| percentile50 | number | 50パーセンタイル値（中央値） |
| percentile75 | number | 75パーセンタイル値（第3四分位数） |
| percentile90 | number | 90パーセンタイル値 |
| percentile95 | number | 95パーセンタイル値 |
| percentile99 | number | 99パーセンタイル値 |

---

## Response Fields

レスポンスに含まれるメトリクス一覧：

| metric | type | description |
|--------|------|-------------|
| kd | object | キルデス比の統計情報 |
| player_damage_per_min | object | 分あたりのプレイヤーダメージの統計情報 |
| player_damage | object | プレイヤーダメージの統計情報 |
| player_damage_taken_per_min | object | 分あたりの受けたダメージの統計情報 |
| healing | object | 回復量の統計情報 |
| kills_plus_assists | object | キルとアシストの合計の統計情報 |
| self_healing_per_min | object | 分あたりの自己回復量の統計情報 |
| crit_shot_rate | object | クリティカルショット率の統計情報 |
| healing_per_min | object | 分あたりの回復量の統計情報 |
| neutral_damage_per_min | object | 分あたりのニュートラルダメージの統計情報 |
| accuracy | object | 命中率の統計情報 |
| kills | object | キル数の統計情報 |
| net_worth | object | ネットワースの統計情報 |
| player_healing_per_min | object | 分あたりのプレイヤー回復量の統計情報 |
| player_healing | object | プレイヤー回復量の統計情報 |
| boss_damage | object | ボスダメージの統計情報 |
| last_hits | object | ラストヒット数の統計情報 |
| kda | object | KDA（キル+アシスト/デス）の統計情報 |
| denies | object | デナイ数の統計情報 |
| net_worth_per_min | object | 分あたりのネットワースの統計情報 |
| player_damage_per_health | object | ヘルスあたりのプレイヤーダメージの統計情報 |
| neutral_damage | object | ニュートラルダメージの統計情報 |
| deaths | object | デス数の統計情報 |
| boss_damage_per_min | object | 分あたりのボスダメージの統計情報 |
| assists | object | アシスト数の統計情報 |
| self_healing | object | 自己回復量の統計情報 |

---

## Notes

- account_idsはクエリパラメータで指定
- 各メトリクスは統計情報オブジェクトを含む
- パーセンタイル値は、そのプレイヤーの全試合データにおける分布を示す
- percentile50は中央値（メディアン）を表す
