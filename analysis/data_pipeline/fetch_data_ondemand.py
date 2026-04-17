#アクセス時にユーザのデータを取得してJSONファイルに保存する

# ユーザのデータを取得するエンドポイント
# https://api.deadlock-api.com/v1/analytics/player-stats/metrics?account_ids=888807526

import json
import requests
from pathlib import Path
from typing import Optional


def fetch_player_stats_metrics(account_id: str, output_path: str, filename: str) -> Optional[dict]:
    """
    Deadlock APIからプレイヤーの統計メトリクスを取得し、JSONファイルに保存する
    
    Args:
        account_id: プレイヤーのアカウントID
        output_path: 出力先のディレクトリパス
        filename: 保存するファイル名（拡張子を含む）
    
    Returns:
        取得したデータの辞書。エラー時はNoneを返す
    """


    # APIエンドポイントのURL
    base_url = "https://api.deadlock-api.com/v1/analytics/player-stats/metrics"
    url = f"{base_url}?account_ids={account_id}"
    
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


if __name__ == "__main__":
    # 使用例
    account_id = "1090169676"
    output_path = "inputs"
    filename = "player-stats-metrics-personal.json"
    
    fetch_player_stats_metrics(account_id, output_path, filename)