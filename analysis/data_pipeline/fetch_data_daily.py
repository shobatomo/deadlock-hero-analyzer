# 1日に1回全体のデータを取得する#アクセス時にユーザのデータを取得してJSONファイルに保存する

# ユーザのデータを取得するエンドポイント
# https://api.deadlock-api.com/v1/analytics/player-stats/metrics

import json
import requests
import time
from pathlib import Path
from typing import Optional

# --------------------------------------------
# 全プレイヤーのデータを取得する
# --------------------------------------------
def fetch_player_stats_metrics_daily(output_path: str, filename: str) -> Optional[dict]:
    """
    Deadlock APIからプレイヤーの統計メトリクスを取得し、JSONファイルに保存する
    
    Args:
        output_path: 出力先のディレクトリパス
        filename: 保存するファイル名（拡張子を含む）
    
    Returns:
        取得したデータの辞書。エラー時はNoneを返す
    """
    # APIエンドポイントのURL
    url = "https://api.deadlock-api.com/v1/analytics/player-stats/metrics"
    
    try:
        # APIリクエストを送信
        response = requests.get(url, timeout=30)
        response.raise_for_status()  # HTTPエラーがあれば例外を発生
        
        # JSONデータを取得
        data = response.json()
        
        # 出力パスを作成（相対パスの場合はプロジェクトルートからの相対パスとして扱う）
        if not Path(output_path).is_absolute():
            # プロジェクトルートのパスを取得
            current_dir = Path(__file__).parent
            project_root = current_dir.parent.parent
            output_dir = project_root / output_path
        else:
            output_dir = Path(output_path)
        
        output_dir.mkdir(parents=True, exist_ok=True)  # ディレクトリが存在しない場合は作成
        
        # ファイルパスを結合
        output_file = output_dir / filename
        
        # JSONファイルに保存
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        
        print(f"データを取得し、{output_file} に保存しました。")
        return data
        
    except requests.exceptions.RequestException as e:
        print(f"APIリクエストエラー: {e}")
        return None
    except json.JSONDecodeError as e:
        print(f"JSON解析エラー: {e}")
        return None
    except Exception as e:
        print(f"予期しないエラー: {e}")
        return None




# --------------------------------------------
# TOP帯のプレイヤーのデータを取得する
# --------------------------------------------

HERO_LIST_URL = "https://assets.deadlock-api.com/v2/heroes"
METRICS_URL = "https://api.deadlock-api.com/v1/analytics/player-stats/metrics"

def fetch_hero_list():
    """ヒーロー一覧を取得"""
    response = requests.get(HERO_LIST_URL)
    response.raise_for_status()

    heroes = response.json()

    hero_ids = []
    for hero in heroes:
        hero_ids.append(hero["id"])

    return hero_ids


def fetch_hero_metrics(hero_id):
    """ヒーローごとのTOP帯メトリクス取得"""

    params = {
        "hero_ids": hero_id,
        "min_average_badge": 70,
        "min_duration_s": 900,
        "max_matches": 50000
    }

    response = requests.get(METRICS_URL, params=params)

    if response.status_code != 200:
        print(f"Error hero {hero_id}")
        return None

    return response.json()


def main():
    # 出力パスを作成（相対パスの場合はプロジェクトルートからの相対パスとして扱う）
    if not Path(output_path).is_absolute():
        # プロジェクトルートのパスを取得
        current_dir = Path(__file__).parent
        project_root = current_dir.parent.parent
        output_dir = project_root / output_path
    else:
        output_dir = Path(output_path)
    
    output_dir.mkdir(parents=True, exist_ok=True)  # ディレクトリが存在しない場合は作成
        
    # 出力ファイル
    output_file = output_dir / "top-hero-metrics-raw.json"

    hero_ids = fetch_hero_list()

    print(f"Found {len(hero_ids)} heroes")

    hero_metrics = {}

    for hero_id in hero_ids:

        print(f"Fetching hero {hero_id}")

        metrics = fetch_hero_metrics(hero_id)

        if metrics:
            hero_metrics[str(hero_id)] = metrics

        time.sleep(0.3)

    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(hero_metrics, f, indent=2, ensure_ascii=False)

    print(f"Saved to {output_file}")


if __name__ == "__main__":
    # 使用例
    output_path = "inputs"
    filename = "player-stats-metrics-global.json"
    
    fetch_player_stats_metrics_daily(output_path, filename)
    main()