import argparse
import json
import sys
import numpy as np
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from analysis.core.axes import compute_player_axes, normalize_player_stats
from analysis.core.extract import extract_feature, extract_percentiles, extract_player_data
from analysis.core.fetch import fetch_player_data, fetch_player_stats_metrics_daily
from analysis.core.normalize import normalize_data

STEAM_ID64_OFFSET = 76561197960265728


# --------------------------------------------
# 出力先パスを解決する
# --------------------------------------------
def resolve_output_path(output_path: str) -> Path:
    # 相対パスの場合はプロジェクトルートからの相対パスとして扱う
    path = Path(output_path)
    if path.is_absolute():
        return path
    return PROJECT_ROOT / path


# --------------------------------------------
# SteamID64をDeadlock API用のaccount_idに変換する
# --------------------------------------------
def normalize_account_id(account_id: str) -> str:
    """SteamID64が渡された場合はDeadlock API用のaccount_idへ変換する。"""
    account_id = str(account_id).strip()

    # SteamID64は17桁以上の数値なので、API用のID3に変換する
    if account_id.isdigit() and len(account_id) >= 17:
        return str(int(account_id) - STEAM_ID64_OFFSET)

    return account_id


# --------------------------------------------
# 結果をJSONファイルに保存する
# --------------------------------------------
def save_json(data, output_path: str):
    # 保存先ディレクトリが存在しない場合は作成する
    output_file = resolve_output_path(output_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)

    # 日本語が読めるようにensure_ascii=Falseで保存する
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    print(f"Saved to {output_file}")


# --------------------------------------------
# オンデマンドでプレイヤーの統計と6軸を作成する
# --------------------------------------------
def build_ondemand_stats(account_id: str):
    # APIに渡せる形式のaccount_idに変換する
    normalized_account_id = normalize_account_id(account_id)

    # 指定したプレイヤーのヒーロー別データを取得する
    player_raw_data = fetch_player_data(normalized_account_id)
    if not player_raw_data:
        return None

    # ヒーローIDをキーにした辞書へ変換する
    player_data_by_hero = normalize_player_stats(player_raw_data)


    # 取得したプレイヤーデータから正規化に必要な特徴量を抽出する
    player_features = extract_player_data(player_raw_data)

    # プレイヤーが使用しているヒーローIDだけを対象に全体データを取得する
    hero_ids = list(player_data_by_hero.keys())

    print(hero_ids)

    # TODO: Daily処理で保存した全体データをDBから取得する形に置き換える。
    # 暫定実装として、オンデマンド実行時に対象ヒーローの全体データを取得する
    global_player_data = fetch_player_stats_metrics_daily(hero_ids)
    if not global_player_data:
        return None

    # 全体データから正規化対象の特徴量だけを抽出する
    required_global_player_data = extract_feature(global_player_data)

    # 全体データのパーセンタイルを正規化基準として抽出する
    global_data_for_normalization = extract_percentiles(required_global_player_data)

    # プレイヤーの特徴量を全体データのp5〜p95で0〜1に正規化する
    normalized_player_data = normalize_data(
        player_features,
        global_data_for_normalization
    )

    # 正規化済みの特徴量から6軸を計算する
    player_axes = compute_player_axes(normalized_player_data)

    # 後続処理や確認に使えるように、生データ・正規化後データ・6軸を返す
    return {
        "account_id": normalized_account_id,
        "player_data": player_data_by_hero,
        "normalized_player_data": normalized_player_data,
        "axes": player_axes,
    }


# --------------------------------------------
# コマンドライン引数を解析する
# --------------------------------------------
def parse_args():
    # account_idを必須、outputを任意の保存先として受け取る
    parser = argparse.ArgumentParser(
        description="指定プレイヤーのオンデマンド統計を取得して6軸を算出します。"
    )
    parser.add_argument("account_id", help="Deadlock account_id または SteamID64")
    parser.add_argument(
        "--output",
        default=None,
        help="結果JSONの保存先。省略時は保存せず標準出力のみ。",
    )
    return parser.parse_args()


# --------------------------------------------
# コマンドライン実行時のメイン処理
# --------------------------------------------
def main():
    # コマンドライン引数を取得する
    args = parse_args()

    # 指定されたプレイヤーのオンデマンド統計を作成する
    player_data = build_ondemand_stats(args.account_id)
    if player_data is None:
        print("Failed to process on-demand stats")
        return None

    # 作成されたプレイヤーのヒーロー別6軸を試合数で重みづけして統合
    print("プレイヤーの6軸を統合します。")
    weighted_player_axes = compute_weighted_axes(player_data["axes"], player_data["player_data"])
    player_data["weighted_axes"] = weighted_player_axes

    # 実行結果を標準出力に表示する
    print("\n===== On-demand player stats =====")
    print(json.dumps(player_data, indent=2, ensure_ascii=False))

    # outputが指定されている場合はJSONファイルとして保存する
    if args.output:
        save_json(player_data, args.output)

    return player_data

# --------------------------------------------
# プレイヤーのヒーロー別6軸を試合数で重み付けし統合する
# --------------------------------------------
def compute_weighted_axes(player_axes, player_data):
    """プレイヤーのヒーロー別の6軸を試合数で重みづけして統合"""
    weighted_axes = {}
    total_matches = 0
    for hero_id, axes in player_axes.items():
        # player_dataから該当ヒーローidで試合数を取得

        match_count = player_data.get(hero_id, {}).get("matches", 0)    
        total_match_count += match_count



    return weighted_axes

if __name__ == "__main__":
    main()