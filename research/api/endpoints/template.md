# Endpoint

GET /matches/{match_id}

---

## Description

試合の詳細情報を取得

---

## Request Example

https://deadlock-api.com/matches/12345

---

## Response Fields

| field | type | description |
|------|------|-------------|
| match_id | number | 試合ID |
| players | array | プレイヤー一覧 |
| duration | number | 試合時間 |

---

## Player Fields

| field | type | description |
|------|------|-------------|
| player_id | number | プレイヤーID |
| hero_id | number | 使用ヒーロー |
| kills | number | キル数 |
| deaths | number | デス数 |
| assists | number | アシスト数 |
| damage | number | 与ダメージ |
| healing | number | 回復量 |
| souls | number | ソウル |

---

## Notes

- hero_idでheroes endpointと紐付く