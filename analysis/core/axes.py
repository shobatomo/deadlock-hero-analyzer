from typing import Dict, Any
import json


def compute_axes(normalized_hero_data: Dict[str, Any]):
    """評価基準となる6軸を計算する"""

    axes = {}

    for hero_id, features in normalized_hero_data.items():

        # ヒーローごとにデータを格納するために解消を初期化
        axes[hero_id] = {}

        axes[hero_id]["aggression"] = (
            features.get("neutral_damage", 0)
            + features.get("neutral_damage_per_min", 0)
            + features.get("kills", 0)
            + features.get("player_damage", 0)
            + features.get("player_damage_per_min", 0)
        ) / 5

        axes[hero_id]["survivability"] = (
            (1 - features.get("deaths", 0))
            + features.get("self_healing_per_min", 0)
            + features.get("kd", 0)
        ) / 3
        
        axes[hero_id]["frontline"] = (
            features.get("teamate_barriering", 0)
            + features.get("kills_plus_assists", 0)
            + features.get("player_damage_taken_per_min", 0)
            + features.get("kda", 0)
        ) / 4

        axes[hero_id]["support"] = (
            features.get("teammate_healing", 0)
            + features.get("player_healing", 0)
            + features.get("assists", 0)
        ) / 3

        axes[hero_id]["mechanics"] = (
            features.get("accuracy", 0)
            + features.get("crit_shot_rate", 0)
            + features.get("heal_prevented", 0)
            + features.get("player_damage_per_health", 0)
        ) / 4

        axes[hero_id]["farming"] = (
            features.get("denies", 0)
            + features.get("last_hits", 0)
            + features.get("net_worth", 0)
            + features.get("net_worth_per_min", 0)
        ) / 4

    return axes


# --------------------------------------------
# 値が存在する特徴量だけで平均値を計算する
# --------------------------------------------
def average_values(values):
    # プレイヤーAPIに存在しない特徴量はNoneとして除外する
    values = [value for value in values if value is not None]
    if not values:
        return 0
    return sum(values) / len(values)


# --------------------------------------------
# 辞書から数値を取得する
# --------------------------------------------
def get_optional_number(data: Dict[str, Any], key: str):
    # キーが存在しない場合は平均計算から除外するためNoneを返す
    value = data.get(key)
    if value is None:
        return None
    return value


# --------------------------------------------
# 低いほど良い特徴量を反転する
# --------------------------------------------
def get_inverted_number(data: Dict[str, Any], key: str):
    # deathsなどは少ないほど良いため、正規化済みの値を1から引く
    value = get_optional_number(data, key)
    if value is None:
        return None
    return 1 - value


# --------------------------------------------
# プレイヤーデータをヒーローIDキーの辞書に変換する
# --------------------------------------------
def normalize_player_stats(player_data):
    """fetch_player_dataの戻り値をhero_idキーの辞書へ変換する"""

    # すでに辞書形式の場合はそのまま返す
    if isinstance(player_data, dict):
        print("プレイヤーデータがすでに辞書型の為処理をスキップします。")
        return player_data

    result = {}

    # fetch_player_dataの戻り値はヒーローごとの配列なので、hero_idをキーに詰め替える
    for hero_stats in player_data:
        hero_id = hero_stats.get("hero_id")
        if hero_id is None:
            continue

        result[str(hero_id)] = hero_stats

    return result


# --------------------------------------------
# プレイヤーの6軸を計算する
# --------------------------------------------
def compute_player_axes(player_data):
    """正規化済みのプレイヤーのヒーロー別データから6軸を計算する"""

    # 結果を格納する辞書を初期化する
    axes = {}

    # 念のためhero_idをキーにした辞書形式へ揃える
    player_stats_by_hero = normalize_player_stats(player_data)

    for hero_id, stats in player_stats_by_hero.items():
        # ヒーローごとに6軸の格納先を初期化する
        axes[hero_id] = {}

        # 攻撃性: キル数と分間プレイヤーダメージから算出する
        axes[hero_id]["aggression"] = average_values([
            get_optional_number(stats, "kills"),
            get_optional_number(stats, "player_damage_per_min"),
        ])

        # 生存力: デス数は少ないほど良いため反転し、KDと合わせて算出する
        axes[hero_id]["survivability"] = average_values([
            get_inverted_number(stats, "deaths"),
            get_optional_number(stats, "kd"),
        ])

        # 前線性能: キルアシスト合計、被ダメージ、KDAから算出する
        axes[hero_id]["frontline"] = average_values([
            get_optional_number(stats, "kills_plus_assists"),
            get_optional_number(stats, "player_damage_taken_per_min"),
            get_optional_number(stats, "kda"),
        ])

        # 支援性能: 現時点ではプレイヤーAPIで取得できるアシスト数を使用する
        axes[hero_id]["support"] = average_values([
            get_optional_number(stats, "assists"),
        ])

        # 操作精度: 命中率とクリティカル率から算出する
        axes[hero_id]["mechanics"] = average_values([
            get_optional_number(stats, "accuracy"),
            get_optional_number(stats, "crit_shot_rate"),
        ])

        # ファーム力: TOP帯と比較可能な分間ネットワースを使用する
        axes[hero_id]["farming"] = average_values([
            get_optional_number(stats, "net_worth_per_min"),
        ])

    return axes
