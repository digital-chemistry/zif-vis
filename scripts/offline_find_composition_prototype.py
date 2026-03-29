from __future__ import annotations

import json
import math
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd


DATA_PATH = Path("project/zif_biocomposite_summary_by_point.json")
OUTPUT_DIR = Path("docs") / "offline_ml_prototype"
EPS = 1e-9
K_NEIGHBORS = 12

PHASES = [
    "Amorphous",
    "Sodalite",
    "Diamondoid",
    "U12",
    "U13",
    "ZIF-EC-1",
    "ZIF-C",
    "ZIF-L",
]


def ensure_output_dir() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def infer_primary_phase(phase_comp: dict | None) -> str:
    phase_comp = phase_comp or {}
    ranked = sorted(
        (
            (name, float((payload or {}).get("mean", 0.0) or 0.0))
            for name, payload in phase_comp.items()
        ),
        key=lambda item: item[1],
        reverse=True,
    )
    if not ranked or ranked[0][1] <= 0:
        return "Amorphous"
    return ranked[0][0]


def normalize_wash(raw: str) -> str:
    text = str(raw or "").strip().lower()
    if "eth" in text:
        return "ethanol"
    if "water" in text:
        return "water"
    return text


def load_dataframe() -> pd.DataFrame:
    with DATA_PATH.open(encoding="utf-8") as fh:
        raw = json.load(fh)

    rows = []
    for point_id, entry in raw.items():
        comp = entry.get("composition") or {}
        cryst = ((entry.get("crystallinity") or {}).get("fractions") or {})
        encaps = entry.get("encapsulation_efficiency") or {}
        ir_data = entry.get("ir_data") or {}

        primary_phase = infer_primary_phase(entry.get("phase_composition"))

        rows.append(
            {
                "point_id": point_id,
                "metal_pct": float(comp.get("M_percent")),
                "ligand_pct": float(comp.get("L_percent")),
                "bsa_pct": float(comp.get("BSA_percent")),
                "concentration": float(entry.get("concentration")),
                "wash": normalize_wash(entry.get("washing")),
                "primary_phase": primary_phase,
                "ee_mean": float(encaps.get("mean")),
                "ee_std": float(encaps.get("error_bar", encaps.get("std", np.nan))),
                "crystalline_mean": float(((cryst.get("crystalline") or {}).get("mean"))),
                "crystalline_std": float(((cryst.get("crystalline") or {}).get("std", (cryst.get("crystalline") or {}).get("error_bar", np.nan)))),
                "amorphous_mean": float(((cryst.get("amorphous") or {}).get("mean"))),
                "amorphous_std": float(((cryst.get("amorphous") or {}).get("std", (cryst.get("amorphous") or {}).get("error_bar", np.nan)))),
                "atr_ratio": float(ir_data.get("ratio_selected_peaks")),
            }
        )

    df = pd.DataFrame(rows)
    df["wash_code"] = df["wash"].map({"water": 0.0, "ethanol": 1.0})
    df["crystallinity_uncertainty"] = df[["crystalline_std", "amorphous_std"]].max(axis=1)
    return df


def build_feature_matrix(df: pd.DataFrame) -> np.ndarray:
    features = df[["metal_pct", "ligand_pct", "bsa_pct", "concentration", "wash_code"]].to_numpy(dtype=float)
    mins = features.min(axis=0)
    maxs = features.max(axis=0)
    span = np.where((maxs - mins) < EPS, 1.0, (maxs - mins))
    return (features - mins) / span


def distance_weights(train_features: np.ndarray, query_feature: np.ndarray, k: int = K_NEIGHBORS) -> tuple[np.ndarray, np.ndarray]:
    deltas = train_features - query_feature
    distances = np.sqrt((deltas ** 2).sum(axis=1))
    order = np.argsort(distances)[:k]
    chosen = distances[order]
    weights = 1.0 / (chosen + 0.02)
    weights = weights / weights.sum()
    return order, weights


def weighted_regression(values: np.ndarray, weights: np.ndarray) -> float:
    mask = np.isfinite(values)
    if not mask.any():
        return float("nan")
    masked_weights = weights[mask]
    masked_weights = masked_weights / masked_weights.sum()
    return float(np.dot(values[mask], masked_weights))


def weighted_phase_probabilities(labels: np.ndarray, weights: np.ndarray) -> dict[str, float]:
    scores = {phase: 0.0 for phase in PHASES}
    for label, weight in zip(labels, weights):
        key = str(label)
        if key not in scores:
            continue
        scores[key] += float(weight)
    return scores


def evaluate_leave_one_out(df: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, float]]:
    feature_matrix = build_feature_matrix(df)
    predictions = []

    regression_targets = [
        "ee_mean",
        "ee_std",
        "crystalline_mean",
        "crystalline_std",
        "amorphous_mean",
        "amorphous_std",
        "atr_ratio",
    ]

    for idx in range(len(df)):
        train_mask = np.ones(len(df), dtype=bool)
        train_mask[idx] = False

        train_df = df.loc[train_mask].reset_index(drop=True)
        train_features = feature_matrix[train_mask]
        query = feature_matrix[idx]

        neighbor_idx, weights = distance_weights(train_features, query)
        neighbor_df = train_df.iloc[neighbor_idx].reset_index(drop=True)

        phase_probs = weighted_phase_probabilities(neighbor_df["primary_phase"].to_numpy(), weights)
        phase_pred = max(phase_probs.items(), key=lambda item: item[1])[0]

        row = {
            "point_id": df.iloc[idx]["point_id"],
            "wash": df.iloc[idx]["wash"],
            "concentration": df.iloc[idx]["concentration"],
            "actual_phase": df.iloc[idx]["primary_phase"],
            "pred_phase": phase_pred,
            "phase_confidence": phase_probs.get(phase_pred, 0.0),
            "distance_to_nearest": float(
                np.sqrt(((train_features[neighbor_idx[0]] - query) ** 2).sum())
            ),
        }

        for phase in PHASES:
            row[f"p_{phase.lower().replace('-', '_')}"] = phase_probs.get(phase, 0.0)

        for target in regression_targets:
            values = neighbor_df[target].to_numpy(dtype=float)
            row[f"pred_{target}"] = weighted_regression(values, weights)
            row[f"actual_{target}"] = float(df.iloc[idx][target])

        predictions.append(row)

    pred_df = pd.DataFrame(predictions)

    metrics = {
        "n_points": float(len(df)),
        "phase_accuracy": float((pred_df["actual_phase"] == pred_df["pred_phase"]).mean()),
    }

    for target in regression_targets:
        pred = pred_df[f"pred_{target}"].to_numpy(dtype=float)
        actual = pred_df[f"actual_{target}"].to_numpy(dtype=float)
        mae = np.mean(np.abs(pred - actual))
        rmse = math.sqrt(np.mean((pred - actual) ** 2))
        metrics[f"{target}_mae"] = float(mae)
        metrics[f"{target}_rmse"] = float(rmse)

    return pred_df, metrics


def build_report(df: pd.DataFrame, metrics: dict[str, float]) -> pd.DataFrame:
    rows = [
        ("points", int(metrics["n_points"])),
        ("phase_accuracy", round(metrics["phase_accuracy"], 4)),
        ("ee_mean_mae", round(metrics["ee_mean_mae"], 4)),
        ("ee_std_mae", round(metrics["ee_std_mae"], 4)),
        ("crystalline_mean_mae", round(metrics["crystalline_mean_mae"], 4)),
        ("crystalline_std_mae", round(metrics["crystalline_std_mae"], 4)),
        ("amorphous_mean_mae", round(metrics["amorphous_mean_mae"], 4)),
        ("amorphous_std_mae", round(metrics["amorphous_std_mae"], 4)),
        ("atr_ratio_mae", round(metrics["atr_ratio_mae"], 4)),
    ]
    return pd.DataFrame(rows, columns=["metric", "value"])


def build_example_queries(df: pd.DataFrame) -> pd.DataFrame:
    feature_matrix = build_feature_matrix(df)
    examples = []
    prototype_queries = [
        {"metal_pct": 20.0, "ligand_pct": 20.0, "bsa_pct": 60.0, "concentration": 37.5, "wash": "ethanol"},
        {"metal_pct": 40.0, "ligand_pct": 30.0, "bsa_pct": 30.0, "concentration": 62.5, "wash": "water"},
        {"metal_pct": 60.0, "ligand_pct": 20.0, "bsa_pct": 20.0, "concentration": 87.5, "wash": "ethanol"},
    ]

    mins = df[["metal_pct", "ligand_pct", "bsa_pct", "concentration", "wash_code"]].min().to_numpy(dtype=float)
    maxs = df[["metal_pct", "ligand_pct", "bsa_pct", "concentration", "wash_code"]].max().to_numpy(dtype=float)
    span = np.where((maxs - mins) < EPS, 1.0, (maxs - mins))

    for query in prototype_queries:
        wash_code = 1.0 if query["wash"] == "ethanol" else 0.0
        query_vec = np.array(
            [
                query["metal_pct"],
                query["ligand_pct"],
                query["bsa_pct"],
                query["concentration"],
                wash_code,
            ],
            dtype=float,
        )
        query_scaled = (query_vec - mins) / span
        neighbor_idx, weights = distance_weights(feature_matrix, query_scaled)
        neighbor_df = df.iloc[neighbor_idx].reset_index(drop=True)
        phase_probs = weighted_phase_probabilities(neighbor_df["primary_phase"].to_numpy(), weights)
        top_phase = max(phase_probs.items(), key=lambda item: item[1])[0]

        examples.append(
            {
                **query,
                "top_phase": top_phase,
                "phase_confidence": round(phase_probs[top_phase], 4),
                "pred_ee_mean": round(weighted_regression(neighbor_df["ee_mean"].to_numpy(dtype=float), weights), 4),
                "pred_ee_std": round(weighted_regression(neighbor_df["ee_std"].to_numpy(dtype=float), weights), 4),
                "pred_crystalline_mean": round(weighted_regression(neighbor_df["crystalline_mean"].to_numpy(dtype=float), weights), 4),
                "pred_crystalline_std": round(weighted_regression(neighbor_df["crystalline_std"].to_numpy(dtype=float), weights), 4),
                "pred_atr_ratio": round(weighted_regression(neighbor_df["atr_ratio"].to_numpy(dtype=float), weights), 4),
                "distance_to_nearest": round(float(np.sqrt(((feature_matrix[neighbor_idx[0]] - query_scaled) ** 2).sum())), 4),
            }
        )

    return pd.DataFrame(examples)


def main() -> None:
    ensure_output_dir()
    df = load_dataframe()

    pred_df, metrics = evaluate_leave_one_out(df)
    metric_df = build_report(df, metrics)
    example_df = build_example_queries(df)

    pred_df.to_csv(OUTPUT_DIR / "leave_one_out_predictions.csv", index=False)
    metric_df.to_csv(OUTPUT_DIR / "prototype_metrics.csv", index=False)
    example_df.to_csv(OUTPUT_DIR / "example_queries.csv", index=False)

    class_counts = Counter(df["primary_phase"])
    with (OUTPUT_DIR / "summary.txt").open("w", encoding="utf-8") as fh:
        fh.write("Offline find-composition prototype\n")
        fh.write(f"Points: {len(df)}\n")
        fh.write("Primary phase counts:\n")
        for phase, count in class_counts.most_common():
            fh.write(f"- {phase}: {count}\n")
        fh.write("\nMetrics:\n")
        for _, row in metric_df.iterrows():
            fh.write(f"- {row['metric']}: {row['value']}\n")

    print(f"Wrote outputs to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
