import json
import site
import sys
import time
from typing import Optional, Dict, Any

try:
    import requests
except ModuleNotFoundError:
    user_site = site.getusersitepackages()
    if user_site not in sys.path:
        site.addsitedir(user_site)
    import requests


# ヒーロー一覧とIdを取得するエンドポイント
HERO_LIST_URL = "https://assets.deadlock-api.com/v2/heroes"

# プレイヤーの統計メトリクスを取得するエンドポイント
METRICS_URL = "https://api.deadlock-api.com/v1/analytics/player-stats/metrics"

# プレイヤー個人のヒーロー別統計を取得するエンドポイント
PLAYER_HERO_STATS_URL = "https://api.deadlock-api.com/v1/players/hero-stats"


def fetch_json(url, params=None, label="request", retries=3, timeout=30):
    """APIの一時失敗に備えてリトライし、失敗理由をログへ出す。"""
    for attempt in range(1, retries + 1):
        try:
            response = requests.get(url, params=params, timeout=timeout)
            if response.status_code == 200:
                return response.json()

            print(
                f"Error {label}: status={response.status_code}, "
                f"body={response.text[:200]}"
            )
        except requests.exceptions.RequestException as e:
            print(f"Error {label}: {e}")

        if attempt < retries:
            time.sleep(attempt)

    return None

def fetch_hero_list():
    """ヒーロー一覧を取得"""
    heroes = fetch_json(HERO_LIST_URL, label="hero list")
    if heroes is None:
        return []

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

        data = fetch_json(METRICS_URL, params=params, label=f"top hero {hero_id}")
        if data is None:
            continue

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

        data = fetch_json(METRICS_URL, params=params, label=f"hero {hero_id}")
        if data is None:
            continue

        # hero_metricsにデータを格納していく
        hero_metrics[str(hero_id)] = data

        # レート制限を考慮しインターバルを設ける
        time.sleep(0.2)

    return hero_metrics



# --------------------------------------------
# プレイヤー個人のデータを取得する
# --------------------------------------------

def fetch_player_data(player_id: str, hero_ids=None):
    """
    Deadlock APIから指定したSteamIDのプレイヤーのヒーロー別のデータを取得する
    """
    params = {
        "account_ids": player_id,
        "min_duration_s": 900,
        "max_matches": 50000
    }

    if hero_ids:
        params["hero_ids"] = hero_ids
    
    return fetch_json(PLAYER_HERO_STATS_URL, params=params, label=f"player {player_id}")


def main():

    myID = "76561198849073254"
    myId3 = int(myID) - 76561197960265728
    return fetch_player_data(str(myId3))

if __name__ == "__main__":
    result = main()

    if result:
        print("データを取得しました")
        print(json.dumps(result, indent=2))        
    else:
        print("データ取得失敗")
