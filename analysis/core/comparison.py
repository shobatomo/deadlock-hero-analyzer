import numpy as np

# ---------------------------------------------
# プレイヤーのデータを比較するための関数群
# ---------------------------------------------

# 特徴量のラベル定義
AXES_LABELS = [
    "aggression",
    "survivability",
    "frontline",
    "support",
    "mechanics",
    "farming"
]

# 辞書を配列に変換する関数
def axes_to_vector(axes):
    """6軸の辞書を数値のみの配列に変換して返す"""
    return np.array([axes.get(label, 0) for label in AXES_LABELS])


def compare_heros(top_vectors, player_vector):
    """プレイヤーの6軸とTOP帯の全ヒーローの6軸を比較してヒーローidと距離の辞書を返す"""
    
    # 結果の距離を格納する辞書を初期化
    distances = {}

    # TOP帯の全ヒーローと比較するためにfor文
    for hero_id, top_vector in top_vectors.items():
        # プレイヤーの6軸とTOP帯のヒーローの6軸の距離を計算する
        distance = np.linalg.norm(player_vector - top_vector)
        distances[hero_id] = distance

    return distances

def comparison_top_and_player(top_axes, player_axes):
    """プレイヤーの6軸をTOP帯の6軸それぞれと比較して最も近い3ヒーローを返す"""

    # TOP帯の6軸を繰り返し処理で配列に変換、キーをヒーローID、値を6軸の数値配列にした辞書を作成
    top_vectors = {}
    for hero_id, axes in top_axes.items():
        top_vectors[hero_id] = axes_to_vector(axes)

    # プレイヤーの6軸も配列に変換
    player_vector = axes_to_vector(player_axes)

    # プレイヤーの6軸とTOP帯の6軸をそれぞれ比較する
    distances = compare_heros(top_vectors, player_vector)

    # 距離が一番小さい3ヒーローとその距離を返す
    sorted_heroes = sorted(distances.items(), key=lambda x: x[1])
    return sorted_heroes[:3]