
# Endpoint

GET /v1/analytics/player-performance-curve

---

## Description

時間ごとのプレイヤーのスタッツの情報

---

## Request Example

https://api.deadlock-api.com/v1/analytics/player-performance-curve?saccount_ids=76561198849073254

---

## Response Fields

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

---

## Notes

- game_timeは10秒ごとの区切りで統計が集計される
- 返される配列は、時間経過に伴うプレイヤーのパフォーマンス曲線を示す
- saccount_idsはクエリパラメータで指定する