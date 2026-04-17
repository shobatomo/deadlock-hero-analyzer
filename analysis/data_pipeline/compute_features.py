import json
import numpy as np
from pathlib import Path
from typing import Dict, Any


# --------------------------------------------
# パス解決
# --------------------------------------------
def resolve_path(path_str: str) -> Path:

    path = Path(path_str)

    if path.is_absolute():
        return path

    current_dir = Path(__file__).parent
    project_root = current_dir.parent.parent

    return project_root / path


# --------------------------------------------
# JSON読み込み
# --------------------------------------------
def load_json(path: str) -> Any:

    file_path = resolve_path(path)

    with open(file_path, "r", encoding="utf-8") as f:
        return json.load(f)


# --------------------------------------------
# JSON保存
# --------------------------------------------
def save_json(data: Dict[str, Any], path: str):

    file_path = resolve_path(path)
    file_path.parent.mkdir(parents=True, exist_ok=True)

    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


# --------------------------------------------
# percentile抽出
# --------------------------------------------
def extract_percentiles(data: Dict[str, Any]):

    result = {}

    for metric_name, metric_data in data.items():

        if not isinstance(metric_data, dict):
            continue

        metric_result = {}

        if "avg" in metric_data:
            metric_result["avg"] = metric_data["avg"]

        if "percentile5" in metric_data:
            metric_result["p5"] = metric_data["percentile5"]

        if "percentile95" in metric_data:
            metric_result["p95"] = metric_data["percentile95"]

        if metric_result:
            result[metric_name] = metric_result

    return result


# --------------------------------------------
# feature
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


# --------------------------------------------
# feature抽出
# --------------------------------------------
def extract_feature_avg(data):

    result = {}

    for feature in FEATURES:

        if feature in data and "avg" in data[feature]:
            result[feature] = data[feature]["avg"]

    return result


# --------------------------------------------
# 正規化
# --------------------------------------------
def normalize(x, min_val, max_val):

    if max_val == min_val:
        return 0

    score = (x - min_val) / (max_val - min_val)

    return max(0, min(1, score))


def normalize_features(features, global_metrics):

    normalized = {}

    for feature, value in features.items():

        if feature not in global_metrics:
            continue

        p5 = global_metrics[feature]["p5"]
        p95 = global_metrics[feature]["p95"]

        normalized[feature] = normalize(value, p5, p95)

    return normalized


# --------------------------------------------
# 6軸
# --------------------------------------------
def compute_axes(features):

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


# --------------------------------------------
# TOPヒーローの中央値抽出
# --------------------------------------------
def extract_top_hero_metrics(data):

    result = {}

    for hero_id, hero_metrics in data.items():

        hero_result = {}

        for metric_name, metric_data in hero_metrics.items():

            if isinstance(metric_data, dict) and "percentile50" in metric_data:
                hero_result[metric_name] = metric_data["percentile50"]

        result[hero_id] = hero_result

    return result


# --------------------------------------------
# ヒーローaxes
# --------------------------------------------
def compute_all_hero_axes(top_metrics, global_metrics):

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
# cosine similarity
# --------------------------------------------
def cosine_similarity(a, b):

    a = np.array(a)
    b = np.array(b)

    denom = np.linalg.norm(a) * np.linalg.norm(b)

    if denom == 0:
        return 0

    return float(np.dot(a, b) / denom)


# --------------------------------------------
# ヒーロー名
# --------------------------------------------
def load_hero_names():

    hero_data = load_json("inputs/hero_data.json")

    return {str(hero["id"]): hero["name"] for hero in hero_data}


# --------------------------------------------
# similarity計算
# --------------------------------------------
def compute_similarity(your_axes, hero_axes):

    HERO_NAMES = load_hero_names()

    AXES = [
        "aggression",
        "farming",
        "survivability",
        "frontline",
        "support",
        "mechanics",
    ]

    your_vector = [your_axes[a] for a in AXES]

    results = []

    for hero_id, axes in hero_axes.items():

        hero_vector = [axes[a] for a in AXES]

        score = cosine_similarity(your_vector, hero_vector)

        results.append({
            "hero_id": hero_id,
            "hero_name": HERO_NAMES.get(hero_id, "Unknown"),
            "score": score
        })

    results = sorted(results, key=lambda x: x["score"], reverse=True)

    return results[:3]


# --------------------------------------------
# main
# --------------------------------------------
def main():

    datasets = {
        "global": "inputs/player-stats-metrics-global.json",
        "personal": "inputs/player-stats-metrics-personal.json",
        "top": "inputs/top-hero-metrics-raw.json",
    }

    results = {}

    # --------------------------
    # GLOBAL / PERSONAL
    # --------------------------
    for name in ["global", "personal"]:

        raw = load_json(datasets[name])

        processed = extract_percentiles(raw)

        save_json(processed, f"outputs/{name}.json")

        features = extract_feature_avg(processed)

        results[name] = features

        print(f"\n===== {name} metrics =====")
        print(json.dumps(features, indent=2))


    # --------------------------
    # NORMALIZE
    # --------------------------
    global_metrics = extract_percentiles(load_json(datasets["global"]))

    normalized = normalize_features(
        results["personal"],
        global_metrics
    )

    global_normalized = normalize_features(
        results["global"],
        global_metrics
    )


    # --------------------------
    # AXES
    # --------------------------
    axes = compute_axes(normalized)

    global_axes = compute_axes(global_normalized)

    print("\n===== axes =====")
    print(json.dumps(axes, indent=2))


    # --------------------------
    # HERO AXES
    # --------------------------
    top_raw = load_json(datasets["top"])

    top_metrics = extract_top_hero_metrics(top_raw)

    save_json(top_metrics, "outputs/top-hero-metrics.json")

    hero_axes = compute_all_hero_axes(top_metrics, global_metrics)

    save_json(hero_axes, "outputs/top-hero-axes.json")


    # --------------------------
    # similarity
    # --------------------------
    similarity = compute_similarity(axes, hero_axes)

    print("\n===== top heroes =====")

    print(json.dumps(similarity, indent=2))


if __name__ == "__main__":
    main()