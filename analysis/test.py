import json
import requests
import time
import numpy as np
from pathlib import Path
from typing import Optional, Dict, Any

def fetch_player_stats_metrics_daily() -> Optional[dict]:
    """
    Deadlock APIからプレイヤーの統計メトリクスを取得し、JSONファイルに保存する
    
    Returns:
        取得したデータの辞書。エラー時はNoneを返す
    """
    # APIエンドポイントのURL
    url = "https://api.deadlock-api.com/v1/players/888807526/account-stats"    
    
    try:
        # APIリクエストを送信
        response = requests.get(url, timeout=30)
        response.raise_for_status()  # HTTPエラーがあれば例外を発生
        
        # JSONデータを取得
        data = response.json()
        return data
    
    except requests.exceptions.RequestException as e:
        print(f"APIリクエストエラー: {e}")

        return None
    except json.JSONDecodeError as e:
        print(f"JSON解析エラー: {e}")
        return None

data = fetch_player_stats_metrics_daily()
data = json.dumps(data, indent=2)
print(data)