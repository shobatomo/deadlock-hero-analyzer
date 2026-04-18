from typing import Optional, Dict, Any

def normalize(x, min_val, max_val):
    """値を正規化（0-1の範囲に）"""
    if max_val == min_val:
        return 0

    score = (x - min_val) / (max_val - min_val)

    return max(0, min(1, score))


def normalize_data(hero_data: Dict[str, Any], data_for_normalization: Dict[str, Any]):
    """特徴量を全体のパーセンタイルを使用して正規化する"""
    # 結果を格納する辞書を初期化
    result_normalized = {}

    for hero_id, features in hero_data.items():
        
        # ヒーローごとの正規化されたデータを格納するための階層を初期化
        result_normalized[hero_id] = {}

        print(f"{hero_id}の正規化を実施します")
        
        for feature, value in features.items():

            if feature not in data_for_normalization[hero_id]:
                print(f"{feature}の正規化に必要なデータが見つかりません。スキップします。")
                continue

            p5 = data_for_normalization[hero_id][feature]["p5"]
            p95 = data_for_normalization[hero_id][feature]["p95"]

            normalized_value = normalize(value, p5, p95)

            result_normalized[hero_id][feature] = normalized_value
            print(f"{hero_id}の{feature}を正規化しました⇒ {feature}:{normalized_value}")
    
    return result_normalized