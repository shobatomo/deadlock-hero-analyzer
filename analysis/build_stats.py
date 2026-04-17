# 1日に1回全体のデータを取得する#アクセス時にユーザのデータを取得してJSONファイルに保存する

# ユーザのデータを取得するエンドポイント
# https://api.deadlock-api.com/v1/analytics/player-stats/metrics

import json
import requests
import time
import numpy as np
from pathlib import Path
from typing import Optional, Dict, Any

# ヒーロー一覧とIdを取得するエンドポイント
HERO_LIST_URL = "https://assets.deadlock-api.com/v2/heroes"

# プレイヤーの統計を取得するエンドポイント
METRICS_URL = "https://api.deadlock-api.com/v1/analytics/player-stats/metrics"


# 最高ランクのプレイヤーのデータを取得する
def fetch_top_player_stats_metrics_daily(hero_ids) -> Optional[dict]:
    """
    Deadlock APIからエターナスランクのプレイヤーの統計を取得する
    """
    hero_metrics = {}

    for hero_id in hero_ids:
        print(f"Fetching hero {hero_id}")

        params = {
            "hero_ids": hero_id,
            # エターナスは11以上
            "min_average_badge": 110,
            "min_duration_s": 900,
            "max_matches": 50000
        }

        response = requests.get(METRICS_URL, params=params)

        if response.status_code != 200:
            print(f"Error hero {hero_id}")
            return None
        data = response.json()

        # hero_metricsにデータを格納していく
        hero_metrics[str(hero_id)] = data

        # レート制限を考慮しインターバルを設ける
        time.sleep(0.3)

    return hero_metrics


def fetch_hero_list():
    """ヒーロー一覧を取得"""
    response = requests.get(HERO_LIST_URL)
    response.raise_for_status()

    heroes = response.json()

    hero_ids = []
    for hero in heroes:
        # player_selectable が True かつ disabled が False のヒーローのみをリストに加える
        if hero.get("player_selectable", True) and not hero.get("disabled", False):
            print(f"使えるヒーローを追加: {hero['name']} (ID: {hero['id']})")
            hero_ids.append(hero["id"])
        else:
            print(f"ムリ！のヒーローをスキップ: {hero['name']} (ID: {hero['id']})")
        
    return hero_ids


# --------------------------------------------
# 全プレイヤーのデータを取得する
# --------------------------------------------
def fetch_player_stats_metrics_daily(hero_ids) -> Optional[dict]:
    """
    Deadlock APIからプレイヤーの統計メトリクスを取得し、JSONファイルに保存する
    
    Returns:
        取得したデータの辞書。エラー時はNoneを返す
    """
    hero_metrics = {}

    for hero_id in hero_ids:
        print(f"Fetching hero {hero_id}")

        params = {
            "hero_ids": hero_id,
            "min_duration_s": 900,
            "max_matches": 50000
        }

        response = requests.get(METRICS_URL, params=params)

        if response.status_code != 200:
            print(f"Error hero {hero_id}")
            return None
        data = response.json()

        # hero_metricsにデータを格納していく
        hero_metrics[str(hero_id)] = data

        # レート制限を考慮しインターバルを設ける
        time.sleep(0.3)

    return hero_metrics

    # # APIエンドポイントのURL
    # url = "https://api.deadlock-api.com/v1/analytics/player-stats/metrics"
    
    # try:
    #     # APIリクエストを送信
    #     response = requests.get(url, timeout=30)
    #     response.raise_for_status()  # HTTPエラーがあれば例外を発生
        
    #     # JSONデータを取得
    #     data = response.json()
    #     return data
        
    # except requests.exceptions.RequestException as e:
    #     print(f"APIリクエストエラー: {e}")
    #     return None
    # except json.JSONDecodeError as e:
    #     print(f"JSON解析エラー: {e}")
    #     return None
    # except Exception as e:
    #     print(f"予期しないエラー: {e}")
    #     return None



# --------------------------------------------
# データ整形関数（analyze_player.pyから統合）
# --------------------------------------------

FEATURES = [
    "kills",
    "assists",
    "player_damage_per_min",
    "net_worth_per_min",
    "last_hits",
    "deaths",
    "player_damage_taken_per_min",
    "accuracy",
]



def extract_feature_avg(data):
    """特徴量の平均値を抽出"""
    result = {}

    for feature in FEATURES:

        if feature in data and "avg" in data[feature]:
            result[feature] = data[feature]["avg"]

    return result


def normalize(x, min_val, max_val):
    """値を正規化（0-1の範囲に）"""
    if max_val == min_val:
        return 0

    score = (x - min_val) / (max_val - min_val)

    return max(0, min(1, score))


def normalize_features(features, global_metrics):
    """特徴量を正規化"""
    normalized = {}

    for feature, value in features.items():

        if feature not in global_metrics:
            continue

        p5 = global_metrics[feature]["p5"]
        p95 = global_metrics[feature]["p95"]

        normalized[feature] = normalize(value, p5, p95)

    return normalized


def compute_axes(features):
    """6軸を計算"""
    axes = {}

    axes["aggression"] = (
        features.get("kills", 0)
        + features.get("player_damage_per_min", 0)
    ) / 2

    axes["farming"] = (
        features.get("net_worth_per_min", 0)
        + features.get("last_hits", 0)
    ) / 2

    axes["survivability"] = 1 - features.get("deaths", 0)

    axes["frontline"] = features.get("player_damage_taken_per_min", 0)

    axes["support"] = features.get("assists", 0)

    axes["mechanics"] = features.get("accuracy", 0)

    return axes


def extract_top_hero_metrics(data):
    """TOPヒーローの中央値（percentile50）を抽出"""
    result = {}

    for hero_id, hero_metrics in data.items():

        hero_result = {}

        for metric_name, metric_data in hero_metrics.items():

            if isinstance(metric_data, dict) and "percentile50" in metric_data:
                hero_result[metric_name] = metric_data["percentile50"]

        result[hero_id] = hero_result

    return result


def compute_all_hero_axes(top_metrics, global_metrics):
    """全ヒーローの軸を計算"""
    hero_axes = {}

    for hero_id, metrics in top_metrics.items():

        features = {}

        for f in FEATURES:
            if f in metrics and metrics[f] is not None:
                features[f] = metrics[f]

        if not features:
            continue

        normalized = normalize_features(features, global_metrics)

        if not normalized:
            continue

        axes = compute_axes(normalized)

        hero_axes[hero_id] = axes

    return hero_axes


# --------------------------------------------
# データ整形処理
# --------------------------------------------
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
                print(F"{hero_id}の{metric_name}の平均値を取得します。")
                top_avg[hero_id][metric_name] = metric_data["avg"]

    return top_avg

def process_top_hero_metrics(hero_metrics: Dict[str, Any], global_metrics: Dict[str, Any]):
    """
    TOPヒーローメトリクスを整形する
    
    Args:
        hero_metrics: ヒーローごとのメトリクスデータ
        global_metrics: グローバルメトリクス（正規化用）
    
    Returns:
        整形されたヒーローデータ
    """
    # TOPヒーローのメトリクスを抽出
    top_metrics = extract_top_hero_metrics(hero_metrics)
    
    # 全ヒーローの軸を計算
    hero_axes = compute_all_hero_axes(top_metrics, global_metrics)
    
    return {
        "top_metrics": top_metrics,
        "hero_axes": hero_axes
    }


# def main():
    # """
    # グローバル統計データとTOP帯ヒーローデータを取得して整形する
    # """
    # results = {}
    
    # # グローバル統計データを取得
    # print("Fetching global player stats metrics...")
    # global_data = fetch_player_stats_metrics_daily()
    
    # if not global_data:
    #     print("Failed to fetch global data")
    #     return None
    
    # # グローバルデータを整形
    # print("Processing global data...")
    # global_processed = process_global_stats_metrics(global_data)
    # results["global"] = global_processed
    
    # print("\n===== Global metrics =====")
    # print(json.dumps(global_processed["features"], indent=2))
    
    # # TOPヒーローのデータを取得
    # print("\nFetching top hero metrics...")
    # hero_ids = fetch_hero_list()
    # print(f"Found {len(hero_ids)} heroes")

    # hero_metrics = {}

    # for hero_id in hero_ids:
    #     print(f"Fetching hero {hero_id}")
    #     metrics = fetch_hero_metrics(hero_id)

    #     if metrics:
    #         hero_metrics[str(hero_id)] = metrics

    #     time.sleep(0.3)
    
    # # TOPヒーローデータを整形
    # if hero_metrics:
    #     print("\nProcessing top hero metrics...")
    #     global_metrics = global_processed["metrics"]
    #     top_hero_data = process_top_hero_metrics(hero_metrics, global_metrics)
        
    #     results["top_heroes"] = top_hero_data
        
    #     print(f"\nProcessed {len(top_hero_data['hero_axes'])} heroes")
    
    # return results


if __name__ == "__main__":
    # ヒーローデータの一覧を取得
    hero_ids = fetch_hero_list()

    # 取得したヒーローのデータでTOP帯のプレイヤーのデータを取得する
    hero_top_data = fetch_top_player_stats_metrics_daily(hero_ids)
    # TOP帯のデータのavgのみを取得する
    hero_top_avg_data = extract_top_avg_data(hero_top_data)

    print("\n===== TOP hero average metrics =====")
    print(json.dumps(hero_top_avg_data, indent=2))
    
    # 取得したヒーローのデータで全体のプレイヤーのデータを取得する
    global_player_data = fetch_player_stats_metrics_daily(hero_ids)
    # パーセンタイルと平均値を取得する
    global_data_for_normalization = extract_percentiles(global_player_data)    
    
    # # print(json.dumps(global_player_data, indent=2))



    # # データベースに保存する
    # # ヒーローごとのデータを保存
    

    # print("\n===== Global metrics for normalization =====")
    # print(json.dumps(global_data_for_normalization, indent=2))

    # # TOP帯のデータを正規化する
    # normalized_global_data = normalize_global_metrics(global_data_for_normalization)


    # result = main()
    # if result:
    #     print("\n===== Processing completed =====")
    #     print(json.dumps({
    #         "global_features": result["global"]["features"],
    #         "top_heroes_count": len(result.get("top_heroes", {}).get("hero_axes", {}))
    #     }, indent=2))
    # else:
    #     print("Failed to process data")