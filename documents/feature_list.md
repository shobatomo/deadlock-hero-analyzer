# Feature List

このドキュメントでは、Deadlockプレイヤーのプレイスタイル分析に使用する
**特徴量（Feature）** を定義する。

特徴量は以下のAPIから取得したデータを基に生成する。

* player hero stats
* hero stats
* match history
* player performance curve

---

# Feature Categories

特徴量は以下のカテゴリに分類する。

* Combat（戦闘）
* Farming（経済）
* Survivability（生存）
* Support（支援）
* Objective（オブジェクト）
* Mechanics（操作精度）

これらの特徴量を元に、最終的に **プレイスタイル6軸** を生成する。

---

# Combat Features

## KDA

```
(kills + assists) / deaths
```

プレイヤーの戦闘効率を表す指標。
キルとアシストの合計をデス数で割ることで、戦闘の成功率を測る。

---

## Kills Per Minute

```
kills_per_min
```

1分あたりのキル数。
アグレッシブなプレイスタイルかどうかを判断する材料。

---

## Damage Per Minute

```
damage_per_min
```

1分あたりのプレイヤーダメージ。
戦闘への参加度と火力の高さを示す。

---

## Kill Participation (approx)

```
kills + assists
```

試合内でどれだけ戦闘に関与しているかを示す。

---

# Farming Features

## Net Worth Per Minute

```
networth_per_min
```

1分あたりの経済成長量。
効率的なファーム能力を表す。

---

## Last Hits Per Minute

```
last_hits_per_min
```

1分あたりのラストヒット数。
レーンコントロール能力を示す。

---

## Creeps Per Minute

```
creeps_per_min
```

クリープ処理速度。
ジャングルやレーン処理能力を表す。

---

# Survivability Features

## Deaths Per Minute

```
deaths_per_min
```

1分あたりの死亡数。
低いほど生存能力が高い。

---

## Damage Taken Per Minute

```
damage_taken_per_min
```

1分あたりに受けたダメージ量。
前線に立つプレイスタイルかどうかの指標。

---

## Damage Mitigated Per Minute

```
damage_mitigated_per_min
```

軽減したダメージ量。
タンク的な役割を評価するための指標。

---

# Support Features

## Assists Per Minute

```
assists_per_min
```

1分あたりのアシスト数。
チームプレイへの関与度を示す。

---

## Healing / Mitigation Contribution

```
damage_mitigated_per_min
```

味方を守る役割への貢献度。

---

# Objective Features

## Objective Damage Per Minute

```
obj_damage_per_min
```

1分あたりのオブジェクトダメージ。
タワーや重要目標への貢献度を示す。

---

## Objective Efficiency

```
obj_damage_per_soul
```

リソースあたりのオブジェクトダメージ。
効率的なオブジェクト処理能力を評価する。

---

# Mechanics Features

## Accuracy

```
accuracy
```

射撃の命中率。
エイム精度を示す。

---

## Critical Shot Rate

```
crit_shot_rate
```

クリティカルショット率。
精密な攻撃能力を示す。

---

# Performance Curve Features

プレイヤーの試合中の成長カーブを表す特徴量。

## Early Game Economy

```
net_worth_avg (10min)
```

序盤の経済成長。

---

## Mid Game Economy

```
net_worth_avg (20min)
```

中盤の経済成長。

---

## Late Game Economy

```
net_worth_avg (40min)
```

終盤の経済成長。

---

## Economy Stability

```
net_worth_std
```

経済成長の安定性。

---

## Early Aggression

```
kills_avg (10min)
```

序盤の戦闘参加度。

---

# Derived Features

以下は複数の特徴量を組み合わせた派生特徴量。

## Aggression Score

```
kills_per_min + damage_per_min
```

戦闘的なプレイスタイルを示す指標。

---

## Farming Efficiency

```
networth_per_min + last_hits_per_min
```

経済効率を表す指標。

---

## Survival Score

```
1 / deaths_per_min
```

生存能力を示す指標。

---

# Next Step

この特徴量を元に、以下の **プレイスタイル6軸** を設計する。

候補例

* Aggression
* Farming
* Survivability
* Support
* Objective
* Mechanics

各軸は複数の特徴量を組み合わせて計算する。
