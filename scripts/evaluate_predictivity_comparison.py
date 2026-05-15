from __future__ import annotations

import csv
import json
import math
from collections import Counter
from datetime import datetime
from pathlib import Path

import numpy as np
from sklearn.ensemble import ExtraTreesClassifier, RandomForestClassifier, VotingClassifier
from sklearn.metrics import accuracy_score, f1_score, mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import StratifiedKFold
from sklearn.preprocessing import LabelEncoder

from project.data_loader import load_data
from project.predictor import PHASES, CompositionPredictor, _engineer


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_ROOT = ROOT / "docs" / "ml_predictivity_runs"
DATASETS = {
    "exp_a": ROOT / "project" / "Exp-A.json",
    "exp_m": ROOT / "project" / "Exp-M.json",
}
REGRESSION_TARGETS = [
    "ee_mean",
    "ee_std",
    "lc_percent",
    "crystalline_mean",
    "crystalline_std",
    "amorphous_mean",
    "amorphous_std",
    "atr_ratio",
]


def ensure_output_dir() -> Path:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_dir = OUTPUT_ROOT / f"run_{stamp}"
    out_dir.mkdir(parents=True, exist_ok=False)
    return out_dir


def shared_classifier_params() -> dict:
    return {
        "n_estimators": 300,
        "max_features": "sqrt",
        "min_samples_leaf": 2,
        "class_weight": "balanced",
        "random_state": 42,
        "n_jobs": 1,
    }


def weighted_mean(values: np.ndarray, weights: np.ndarray) -> float:
    mask = np.isfinite(values)
    if not mask.any():
        return float("nan")
    active_weights = weights[mask]
    active_weights = active_weights / active_weights.sum()
    return float(np.dot(values[mask], active_weights))


def float_or_nan(value) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return float("nan")


def regression_prediction(train_rows: list[dict], query_row: dict, k_neighbors: int = 9) -> dict[str, float]:
    feature_matrix = np.array(
        [
            [
                row["metal_pct"],
                row["ligand_pct"],
                row["concentration"],
                row["wash_code"],
            ]
            for row in train_rows
        ],
        dtype=float,
    )
    feature_min = feature_matrix.min(axis=0)
    feature_max = feature_matrix.max(axis=0)
    feature_span = np.where((feature_max - feature_min) < 1e-9, 1.0, feature_max - feature_min)
    scaled_features = (feature_matrix - feature_min) / feature_span

    query = np.array(
        [
            query_row["metal_pct"],
            query_row["ligand_pct"],
            query_row["concentration"],
            query_row["wash_code"],
        ],
        dtype=float,
    )
    scaled_query = (query - feature_min) / feature_span

    deltas = scaled_features - scaled_query
    distances = np.sqrt((deltas ** 2).sum(axis=1))
    k = min(k_neighbors, len(train_rows))
    order = np.argsort(distances)[:k]
    chosen = distances[order]
    weights = 1.0 / (chosen + 0.02)
    weights = weights / weights.sum()

    result = {
        "distance_to_nearest": float(chosen[0]),
    }
    for target in REGRESSION_TARGETS:
        values = np.array([float_or_nan(train_rows[idx][target]) for idx in order], dtype=float)
        result[target] = weighted_mean(values, weights)
    return result


def save_csv(path: Path, rows: list[dict], fieldnames: list[str]) -> None:
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def load_predictor_rows(dataset_path: Path) -> list[dict]:
    points, _, _ = load_data(dataset_path)
    predictor = CompositionPredictor(points)
    return predictor.points


def evaluate_phase_models(rows: list[dict]) -> tuple[dict, list[dict]]:
    label_counts = Counter(row["primary_phase"] for row in rows)
    eligible_labels = {label for label, count in label_counts.items() if count >= 2}
    excluded_label_counts = {
        label: count for label, count in label_counts.items() if count < 2
    }
    rows_for_cv = [row for row in rows if row["primary_phase"] in eligible_labels]
    if not rows_for_cv:
        raise RuntimeError("Not enough samples per class for stratified cross-validation.")

    X = np.array(
        [
            _engineer(
                row["metal_pct"],
                row["ligand_pct"],
                row["concentration"],
                row["wash_code"],
            )
            for row in rows_for_cv
        ],
        dtype=float,
    )
    labels = [row["primary_phase"] for row in rows_for_cv]
    label_counts = Counter(labels)
    min_class_count = min(label_counts.values())
    n_splits = min(10, min_class_count)
    if n_splits < 2:
        raise RuntimeError("Not enough samples per class for stratified cross-validation.")

    le = LabelEncoder()
    y = le.fit_transform(labels)
    class_names = list(le.classes_)

    models = {
        "rf": RandomForestClassifier(**shared_classifier_params()),
        "et": ExtraTreesClassifier(**shared_classifier_params()),
        "ensemble": VotingClassifier(
            estimators=[
                ("rf", RandomForestClassifier(**shared_classifier_params())),
                ("et", ExtraTreesClassifier(**shared_classifier_params())),
            ],
            voting="soft",
            n_jobs=1,
        ),
    }

    splitter = StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=42)
    metrics = {
        "folds": n_splits,
        "class_counts": dict(sorted(label_counts.items())),
        "excluded_singleton_classes": dict(sorted(excluded_label_counts.items())),
        "models": {},
    }

    saved_predictions: list[dict] = []

    for model_name, model in models.items():
        fold_accuracies: list[float] = []
        fold_macro_f1: list[float] = []
        y_true_all: list[int] = []
        y_pred_all: list[int] = []
        proba_all = np.zeros((len(rows_for_cv), len(class_names)), dtype=float)

        for fold_index, (train_idx, test_idx) in enumerate(splitter.split(X, y), start=1):
            model.fit(X[train_idx], y[train_idx])
            preds = model.predict(X[test_idx])
            probs = model.predict_proba(X[test_idx])

            fold_accuracies.append(float(accuracy_score(y[test_idx], preds)))
            fold_macro_f1.append(float(f1_score(y[test_idx], preds, average="macro", zero_division=0)))
            y_true_all.extend(y[test_idx].tolist())
            y_pred_all.extend(preds.tolist())
            proba_all[test_idx] = probs

            if model_name == "ensemble":
                for row_index, point_index in enumerate(test_idx):
                    record = {
                        "point_id": rows_for_cv[point_index]["point_id"],
                        "actual_phase": class_names[y[point_index]],
                        "pred_phase": class_names[preds[row_index]],
                        "phase_confidence": float(np.max(probs[row_index])),
                        "fold": fold_index,
                    }
                    for class_index, class_name in enumerate(class_names):
                        record[f"p_{class_name.lower().replace('-', '_')}"] = float(probs[row_index][class_index])
                    saved_predictions.append(record)

        metrics["models"][model_name] = {
            "accuracy_mean": float(np.mean(fold_accuracies)),
            "accuracy_std": float(np.std(fold_accuracies, ddof=1)) if len(fold_accuracies) > 1 else 0.0,
            "macro_f1_mean": float(np.mean(fold_macro_f1)),
            "macro_f1_std": float(np.std(fold_macro_f1, ddof=1)) if len(fold_macro_f1) > 1 else 0.0,
            "overall_accuracy": float(accuracy_score(y_true_all, y_pred_all)),
            "overall_macro_f1": float(f1_score(y_true_all, y_pred_all, average="macro", zero_division=0)),
        }

    return metrics, saved_predictions


def evaluate_regression(rows: list[dict], k_neighbors: int = 9) -> tuple[dict, list[dict]]:
    predictions: list[dict] = []

    for idx, row in enumerate(rows):
        train_rows = [candidate for j, candidate in enumerate(rows) if j != idx]
        predicted = regression_prediction(train_rows, row, k_neighbors=k_neighbors)
        record = {
            "point_id": row["point_id"],
            "primary_phase": row["primary_phase"],
            "distance_to_nearest": predicted["distance_to_nearest"],
        }
        for target in REGRESSION_TARGETS:
            record[f"actual_{target}"] = float_or_nan(row[target])
            record[f"pred_{target}"] = float_or_nan(predicted[target])
        predictions.append(record)

    metrics = {"k_neighbors": k_neighbors, "targets": {}}
    for target in REGRESSION_TARGETS:
        actual = np.array([row[f"actual_{target}"] for row in predictions], dtype=float)
        pred = np.array([row[f"pred_{target}"] for row in predictions], dtype=float)
        mask = np.isfinite(actual) & np.isfinite(pred)
        if not mask.any():
            metrics["targets"][target] = {"count": 0, "mae": float("nan"), "rmse": float("nan"), "r2": float("nan")}
            continue
        metrics["targets"][target] = {
            "count": int(mask.sum()),
            "mae": float(mean_absolute_error(actual[mask], pred[mask])),
            "rmse": float(math.sqrt(mean_squared_error(actual[mask], pred[mask]))),
            "r2": float(r2_score(actual[mask], pred[mask])),
        }

    return metrics, predictions


def build_dataset_summary(rows: list[dict]) -> dict:
    return {
        "points": len(rows),
        "phase_counts": dict(sorted(Counter(row["primary_phase"] for row in rows).items())),
        "wash_counts": dict(sorted(Counter(row["wash"] for row in rows).items())),
        "concentrations": sorted({float(row["concentration"]) for row in rows}),
    }


def write_summary_markdown(path: Path, comparison: dict) -> None:
    exp_a = comparison["datasets"]["exp_a"]
    exp_m = comparison["datasets"]["exp_m"]
    exp_a_acc = exp_a["phase_metrics"]["models"]["ensemble"]["accuracy_mean"]
    exp_m_acc = exp_m["phase_metrics"]["models"]["ensemble"]["accuracy_mean"]

    def target_line(target: str) -> str:
        a = exp_a["regression_metrics"]["targets"][target]["mae"]
        m = exp_m["regression_metrics"]["targets"][target]["mae"]
        winner = "Exp-A" if a < m else "Exp-M"
        return f"- `{target}` MAE: Exp-A `{a:.4f}` vs Exp-M `{m:.4f}` -> {winner} lower"

    lines = [
        "# ML Predictivity Comparison",
        "",
        f"- Run timestamp: `{comparison['run_timestamp']}`",
        f"- Phase CV protocol: `{comparison['phase_cv_protocol']}`",
        f"- Regression protocol: `{comparison['regression_protocol']}`",
        "",
        "## Phase Accuracy",
        "",
        f"- Exp-A ensemble accuracy: `{exp_a_acc:.4f}`",
        f"- Exp-M ensemble accuracy: `{exp_m_acc:.4f}`",
        f"- Delta (Exp-A - Exp-M): `{exp_a_acc - exp_m_acc:+.4f}`",
        "",
        "## Regression MAE",
        "",
        target_line("ee_mean"),
        target_line("lc_percent"),
        target_line("crystalline_mean"),
        target_line("atr_ratio"),
        "",
        "## Output Files",
        "",
        "- `exp_a/phase_metrics.json`",
        "- `exp_a/regression_metrics.json`",
        "- `exp_a/phase_cv_predictions.csv`",
        "- `exp_a/regression_loo_predictions.csv`",
        "- `exp_m/phase_metrics.json`",
        "- `exp_m/regression_metrics.json`",
        "- `comparison.json`",
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def evaluate_dataset(dataset_key: str, dataset_path: Path, output_dir: Path) -> dict:
    rows = load_predictor_rows(dataset_path)
    dataset_dir = output_dir / dataset_key
    dataset_dir.mkdir(parents=True, exist_ok=True)

    phase_metrics, phase_predictions = evaluate_phase_models(rows)
    regression_metrics, regression_predictions = evaluate_regression(rows)

    (dataset_dir / "phase_metrics.json").write_text(
        json.dumps(phase_metrics, indent=2),
        encoding="utf-8",
    )
    (dataset_dir / "regression_metrics.json").write_text(
        json.dumps(regression_metrics, indent=2),
        encoding="utf-8",
    )

    if phase_predictions:
        phase_fields = list(phase_predictions[0].keys())
        save_csv(dataset_dir / "phase_cv_predictions.csv", phase_predictions, phase_fields)
    if regression_predictions:
        regression_fields = list(regression_predictions[0].keys())
        save_csv(dataset_dir / "regression_loo_predictions.csv", regression_predictions, regression_fields)

    return {
        "dataset_path": str(dataset_path),
        "summary": build_dataset_summary(rows),
        "phase_metrics": phase_metrics,
        "regression_metrics": regression_metrics,
    }


def main() -> None:
    output_dir = ensure_output_dir()
    comparison = {
        "run_timestamp": datetime.now().isoformat(),
        "phase_cv_protocol": "Stratified cross-validation with same RF/ET/soft-vote hyperparameters as project.predictor; folds=min(10, minimum class count).",
        "regression_protocol": "Leave-one-out inverse-distance weighted kNN regression with 4 raw features and k=9, matching project.predictor settings.",
        "datasets": {},
    }

    for dataset_key, dataset_path in DATASETS.items():
        comparison["datasets"][dataset_key] = evaluate_dataset(dataset_key, dataset_path, output_dir)

    (output_dir / "comparison.json").write_text(
        json.dumps(comparison, indent=2),
        encoding="utf-8",
    )
    write_summary_markdown(output_dir / "summary.md", comparison)

    print(output_dir)


if __name__ == "__main__":
    main()
