from typing import Optional, Dict, Any

GLOBAL_FEATURES = [
    # aggression関連の数値
    'neutral_damage',
    'neutral_damage_per_min',
    'kills',
    'player_damage',
    'player_damage_per_min',
    
    # survivability関連の数値
    'deaths',
    'self_healing_per_min',
    'kd',
    
    # frontline関連の数値
    'teamate_barriering',
    'kills_plus_assists',
    'player_damage_taken_per_min',
    'kda',


    # support関連の数値
    'teammate_healing',
    'player_healing',
    'assists',

    # mechanics関連の数値
    'accuracy',
    'crit_shot_rate',
    'heal_prevented',
    'player_damage_per_health',

    # farming関連の数値
    'denies',
    'last_hits',
    'net_worth',
    'net_worth_per_min',
]


# プレイヤーデータの項目名を、6軸計算で使う共通の特徴量名へ寄せる
PLAYER_FEATURE_ALIASES = {
    'kills': 'kills',
    'kills_per_min': 'kills_per_min',
    'deaths': 'deaths',
    'deaths_per_min': 'deaths_per_min',
    'assists': 'assists',
    'assists_per_min': 'assists_per_min',
    'damage_per_min': 'player_damage_per_min',
    'damage_mitigated_per_min': 'damage_mitigated_per_min',
    'damage_taken_per_min': 'player_damage_taken_per_min',
    'denies_per_min': 'denies_per_min',
    'networth_per_min': 'net_worth_per_min',
    'last_hits_per_min': 'last_hits_per_min',
    'creeps_per_min': 'creeps_per_min',
    'accuracy': 'accuracy',
    'crit_shot_rate': 'crit_shot_rate',
    'obj_damage_per_min': 'obj_damage_per_min',
}


def extract_feature(data: Dict[str, Any]):
    """データ全体から必要な特徴量の値のみを取得する"""
    result = {}
    

    # 全ヒーローのデータを繰り返し処理
    for hero_id, hero_stats in data.items():

        # ヒーローごとの結果を格納するために辞書を作成して初期化
        result[hero_id] = {}

        # 指定した特徴量を繰り返し処理
        for feature in GLOBAL_FEATURES:

            print(f"{hero_id}の{feature}を取得します")

            # 特定のヒーローのデータの中に特徴量が存在するか確認
            if feature in hero_stats:

                # 存在する場合は特徴量の値を結果に格納
                result[hero_id][feature] = hero_stats[feature]
                print(f"{hero_id}の{feature}の値を取得しました: {hero_stats[feature]}")
    
    return result



def extract_top_avg_data(data: Dict[str, Any]):
    """TOP帯のデータから平均値のみを取得して辞書に格納する"""
    top_avg = {}
    for hero_id, hero_stats in data.items():
        
        print(f"{hero_id}のTOP帯の平均値を取得します。")
        top_avg[hero_id] = {}

        for metric_name, metric_data in hero_stats.items():
            
            if not isinstance(metric_data, dict):
                print(f"{hero_id}の{metric_name}のデータが正常に取得できません。")
                continue
            
            if "avg" in metric_data:
                top_avg[hero_id][metric_name] = metric_data["avg"]
                print(f"{hero_id}の{metric_name}の平均値を取得しました。")

    return top_avg

def extract_percentiles(data: Dict[str, Any]):
    """パーセンタイルを抽出と平均値を取得"""
    result = {}

    for hero_id, hero_stats in data.items():

        print(f"{hero_id} のデータを取得します。")
        result[hero_id] = {}

        for metric_name, metric_data in hero_stats.items():   
            if not isinstance(metric_data, dict):
                continue

            metric_result = {}

            if "avg" in metric_data:
                print(f"{hero_id}の{metric_name}の平均値を取得します。⇒{metric_data['avg']}")
                metric_result["avg"] = metric_data["avg"]

            if "percentile5" in metric_data:
                print(f"{hero_id}の{metric_name}のパーセンタイル5を取得します。⇒{metric_data['percentile5']}")
                metric_result["p5"] = metric_data["percentile5"]

            if "percentile95" in metric_data:
                print(f"{hero_id}の{metric_name}のパーセンタイル95を取得します。⇒{metric_data['percentile95']}")
                metric_result["p95"] = metric_data["percentile95"]

            if metric_result:
                result[hero_id][metric_name] = metric_result

    return result

def extract_player_data(data: Dict[str, Any]):
    """プレイヤーデータから必要な特徴量を取得する"""

    result = {}

    if not data:
        return result

    for hero_stats in data:
        hero_id = str(hero_stats.get("hero_id", "unknown"))
        print(f"{hero_id}のプレイヤーデータを取得します。")

        result[hero_id] = {}

        for source_name, output_name in PLAYER_FEATURE_ALIASES.items():
            if source_name in hero_stats and hero_stats[source_name] is not None:
                result[hero_id][output_name] = hero_stats[source_name]

        kills = result[hero_id].get("kills", 0)
        assists = result[hero_id].get("assists", 0)
        deaths = result[hero_id].get("deaths", 0)

        result[hero_id]["kills_plus_assists"] = kills + assists
        result[hero_id]["kd"] = kills / max(deaths, 1)
        result[hero_id]["kda"] = (kills + assists) / max(deaths, 1)

    return result
