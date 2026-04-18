import requests
import time
from typing import Optional, Dict, Any


# ヒーロー一覧とIdを取得するエンドポイント
HERO_LIST_URL = "https://assets.deadlock-api.com/v2/heroes"

# プレイヤーの統計を取得するエンドポイント
METRICS_URL = "https://api.deadlock-api.com/v1/analytics/player-stats/metrics"

def fetch_hero_list():
    """ヒーロー一覧を取得"""
    response = requests.get(HERO_LIST_URL)
    response.raise_for_status()

    heroes = response.json()

    hero_ids = []
    for hero in heroes:
        # player_selectable が True かつ disabled が False のヒーローのみをリストに加える
        if hero.get("player_selectable", True) and not hero.get("disabled", False):
            print(f"{hero['name']} (ID: {hero['id']})を追加")
            hero_ids.append(hero["id"])
        else:
            print(f"{hero['name']} (ID: {hero['id']})使用不可のためスキップ")
        
        # ヒーローのIdを名前をデータベースに保存する処理を実装予定

    return hero_ids

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
        time.sleep(0.2)

    return hero_metrics
