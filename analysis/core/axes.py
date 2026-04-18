from typing import Optional, Dict, Any


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
            (1 - features.get("deaths", 1))
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