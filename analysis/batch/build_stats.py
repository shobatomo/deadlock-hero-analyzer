from analysis.core.fetch import fetch_hero_list, fetch_top_player_stats_metrics_daily, fetch_player_stats_metrics_daily
from analysis.core.extract import extract_feature, extract_top_avg_data, extract_percentiles
from analysis.core.normalize import normalize_data
from analysis.core.axes import compute_axes
import json


def main():

    # ヒーローデータの一覧を取得
    hero_ids = fetch_hero_list()

    # 取得したヒーローのデータでTOP帯のプレイヤーのデータを取得する
    hero_top_data = fetch_top_player_stats_metrics_daily(hero_ids)
    
    # 必要な特徴量のみに絞る
    required_hero_top_data = extract_feature(hero_top_data)
    
    # TOP帯のデータのavgのみを取得する
    hero_top_avg_data = extract_top_avg_data(required_hero_top_data)
    
    # 取得したヒーローのデータで全体のプレイヤーのデータを取得する
    global_player_data = fetch_player_stats_metrics_daily(hero_ids)

    # 必要な特徴量のみに絞る
    required_global_player_data = extract_feature(global_player_data)

    # パーセンタイルと平均値を取得する
    global_data_for_normalization = extract_percentiles(required_global_player_data)    

    # 取得したTOP帯の平均値を全体のパーセンタイルで正規化する
    normalized_hero_top_data = normalize_data(hero_top_avg_data, global_data_for_normalization)
    
    # 評価基準となる6軸に算出する
    hero_top_axes = compute_axes(normalized_hero_top_data)
    
    print("\n===== Top hero axes =====")
    print(json.dumps(hero_top_axes, indent=2))

    # # データベースに保存する
    # # ヒーローごとのデータを保存

if __name__ == "__main__":

    result = main()
    if result:
        print("\n===== Processing completed =====")
        print(json.dumps(result, indent=2))
    else:
        print("Failed to process data")