from __future__ import annotations

import math
import logging
from collections import Counter

import numpy as np

try:
    from sklearn.ensemble import RandomForestClassifier, ExtraTreesClassifier, VotingClassifier
    from sklearn.preprocessing import LabelEncoder
    _SKLEARN_AVAILABLE = True
except ImportError:
    _SKLEARN_AVAILABLE = False
    logging.warning("scikit-learn not found — falling back to k-NN phase classifier")


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

PHASES_WITH_CRYSTALLINE_COMPONENTS = [
    "Sodalite",
    "Diamondoid",
    "U12",
    "U13",
    "ZIF-EC-1",
    "ZIF-C",
    "ZIF-L",
]

# Phases with fewer training samples than this get a "low data" warning.
LOW_DATA_PHASE_THRESHOLD = 15

# Small epsilon to avoid division-by-zero in engineered features
_EPS = 1e-6


def normalise_wash(raw: str) -> str:
    text = str(raw or "").strip().lower()
    if "eth" in text:
        return "ethanol"
    if "water" in text:
        return "water"
    return text or "ethanol"


def _engineer(metal_pct: float, ligand_pct: float, concentration: float, wash_code: float) -> list[float]:
    """
    Return the 6-element feature vector used by the Random Forest classifier.

    Features
    --------
    metal_pct      - raw metal fraction (0-100)
    ligand_pct     - raw ligand fraction (0-100)
    concentration  - synthesis concentration
    wash_code      - 1.0 ethanol, 0.0 water
    ml_ratio       - metal / (ligand + eps)  [most important in CV]
    log_conc       - log1p(concentration)    [linearises exponential effects]
    """
    ml_ratio = metal_pct / (ligand_pct + _EPS)
    log_conc = math.log1p(concentration)
    return [metal_pct, ligand_pct, concentration, wash_code, ml_ratio, log_conc]


class CompositionPredictor:
    """
    Composition predictor: Random Forest phase classifier + k-NN regressor.

    Phase classification
    --------------------
    Uses RandomForestClassifier (n_estimators=300, class_weight='balanced')
    trained on 6-dimensional engineered feature space.  Falls back to k-NN
    weighted voting if scikit-learn is not installed.

    Regression targets (EE, crystallinity, LC%, ATR ratio)
    -------------------------------------------------------
    Handled by inverse-distance weighted k-NN — RF isn't well-suited to
    small datasets for regression with missing labels, and kNN already
    captures local smoothness well for continuous targets.

    Confidence / trust
    ------------------
    Distance thresholds are calibrated from the actual NN-distance distribution
    at fit time (p33 = "near known data", p75 = "moderate extrapolation").
    Phases with < LOW_DATA_PHASE_THRESHOLD training samples are flagged.

    Improvements over v1
    --------------------
    - BSA% dropped from feature matrix (collinear: M+L+BSA=100)
    - k=9 default (LOO-CV optimal on primary dataset)
    - RF achieves ~85% 10-fold CV accuracy vs ~80% for kNN
    - Engineered features: M/L ratio + log(concentration)
    - Confidence thresholds calibrated from actual NN-distance distribution
    - Low-data phases flagged in predictions
    """

    def __init__(self, points: list[dict], k_neighbors: int = 9):
        self.k_neighbors = k_neighbors
        usable = []

        for point in points:
            try:
                wash = normalise_wash(point.get("washing") or point.get("wash"))
                usable.append(
                    {
                        "point_id": point.get("id"),
                        "metal_pct": float(point.get("metal")),
                        "ligand_pct": float(point.get("ligand")),
                        "bsa_pct": float(point.get("bsa")),
                        "concentration": float(point.get("concentration")),
                        "wash": wash,
                        "wash_code": 1.0 if wash == "ethanol" else 0.0,
                        "primary_phase": point.get("primary_phase") or point.get("phase") or "Amorphous",
                        "ee_mean": point.get("ee"),
                        "ee_std": point.get("ee_error") if point.get("ee_error") is not None else point.get("ee_std"),
                        "lc_percent": point.get("lc_percent"),
                        "crystalline_mean": point.get("crystallinity"),
                        "crystalline_std": point.get("crystallinity_std"),
                        "amorphous_mean": point.get("amorphousness"),
                        "amorphous_std": point.get("amorphousness_std"),
                        "atr_ratio": point.get("protein_ratio"),
                    }
                )
            except (TypeError, ValueError):
                continue

        self.points = usable

        # kNN feature matrix: 4 raw features (BSA dropped - collinear)
        self.feature_matrix = np.array(
            [
                [
                    row["metal_pct"],
                    row["ligand_pct"],
                    row["concentration"],
                    row["wash_code"],
                ]
                for row in usable
            ],
            dtype=float,
        )

        self.feature_min = self.feature_matrix.min(axis=0)
        self.feature_max = self.feature_matrix.max(axis=0)
        self.feature_span = np.where(
            (self.feature_max - self.feature_min) < 1e-9,
            1.0,
            self.feature_max - self.feature_min,
        )
        self.scaled_features = (self.feature_matrix - self.feature_min) / self.feature_span

        self.available_concentrations = sorted(
            {float(row["concentration"]) for row in usable if row.get("concentration") is not None}
        )

        self.component_bounds = {
            "metal_pct": (
                float(min(row["metal_pct"] for row in usable)),
                float(max(row["metal_pct"] for row in usable)),
            ),
            "ligand_pct": (
                float(min(row["ligand_pct"] for row in usable)),
                float(max(row["ligand_pct"] for row in usable)),
            ),
            "bsa_pct": (
                float(min(row["bsa_pct"] for row in usable)),
                float(max(row["bsa_pct"] for row in usable)),
            ),
            "concentration": (
                float(min(row["concentration"] for row in usable)),
                float(max(row["concentration"] for row in usable)),
            ),
        }

        self._phase_counts = Counter(row["primary_phase"] for row in usable)
        self._low_data_phases = {
            phase for phase, count in self._phase_counts.items()
            if count < LOW_DATA_PHASE_THRESHOLD
        }
        self._near_threshold, self._far_threshold = self._calibrate_distance_thresholds()

        # Random Forest classifier (optional, falls back to kNN)
        self._rf_classifier = None
        self._rf_label_encoder = None
        if _SKLEARN_AVAILABLE and len(usable) >= 10:
            self._fit_random_forest(usable)

    # ------------------------------------------------------------------
    # Random Forest helpers
    # ------------------------------------------------------------------

    def _fit_random_forest(self, usable):
        """
        Soft-voting ensemble (RandomForest + ExtraTrees), 6-feature space.

        10-fold CV on n=360:
          RF-300 alone:    85.6% +/- 5.5%
          ET-300 alone:    85.0% +/- 5.0%
          Soft vote RF+ET: 86.1% +/- 5.7%  <- used here
        """
        X = np.array(
            [
                _engineer(
                    row["metal_pct"],
                    row["ligand_pct"],
                    row["concentration"],
                    row["wash_code"],
                )
                for row in usable
            ],
            dtype=float,
        )
        labels = [row["primary_phase"] for row in usable]
        le = LabelEncoder()
        y = le.fit_transform(labels)

        _shared = dict(
            n_estimators=300,
            max_features="sqrt",
            min_samples_leaf=2,
            class_weight="balanced",
            random_state=42,
            n_jobs=1,
        )
        clf = VotingClassifier(
            estimators=[
                ("rf", RandomForestClassifier(**_shared)),
                ("et", ExtraTreesClassifier(**_shared)),
            ],
            voting="soft",
            n_jobs=1,
        )
        clf.fit(X, y)

        self._rf_classifier = clf
        self._rf_label_encoder = le

    def _rf_phase_scores(self, metal_pct, ligand_pct, concentration, wash_code):
        """
        Return {phase_name: probability} dict using the Random Forest.
        All PHASES are represented (zero for phases not seen during training).
        """
        x = np.array([_engineer(metal_pct, ligand_pct, concentration, wash_code)], dtype=float)
        proba = self._rf_classifier.predict_proba(x)[0]
        classes = self._rf_label_encoder.classes_

        scores = {phase: 0.0 for phase in PHASES}
        for cls, prob in zip(classes, proba):
            if cls in scores:
                scores[cls] = float(prob)
        return scores

    # ------------------------------------------------------------------
    # kNN helpers (fallback classification + regression)
    # ------------------------------------------------------------------

    def _calibrate_distance_thresholds(self):
        """
        Compute nearest-neighbour distances across all training points (LOO-style)
        and return (near_threshold, far_threshold) at the 33rd and 75th percentiles.
        """
        if len(self.scaled_features) < 2:
            return 0.08, 0.16

        nn_distances = []
        for i, query in enumerate(self.scaled_features):
            deltas = self.scaled_features - query
            deltas[i] = np.inf  # exclude self
            d = np.sqrt((deltas ** 2).sum(axis=1))
            nn_distances.append(float(np.min(d)))

        near = float(np.percentile(nn_distances, 33))
        far = float(np.percentile(nn_distances, 75))
        if far <= near:
            far = near * 1.5 if near > 0 else 0.25
        return near, far

    def _confidence_band(self, distance):
        if distance <= self._near_threshold:
            return "near known data"
        if distance <= self._far_threshold:
            return "moderate extrapolation"
        return "far from measured data"

    def is_within_supported_domain(self, metal_pct, ligand_pct, bsa_pct, concentration):
        return (
            self.component_bounds["metal_pct"][0] <= metal_pct <= self.component_bounds["metal_pct"][1]
            and self.component_bounds["ligand_pct"][0] <= ligand_pct <= self.component_bounds["ligand_pct"][1]
            and self.component_bounds["bsa_pct"][0] <= bsa_pct <= self.component_bounds["bsa_pct"][1]
            and self.component_bounds["concentration"][0] <= concentration <= self.component_bounds["concentration"][1]
        )

    def _scale_query(self, metal_pct, ligand_pct, concentration, wash):
        wash_code = 1.0 if normalise_wash(wash) == "ethanol" else 0.0
        query = np.array([metal_pct, ligand_pct, concentration, wash_code], dtype=float)
        return (query - self.feature_min) / self.feature_span

    def _neighbor_weights(self, query_scaled):
        deltas = self.scaled_features - query_scaled
        distances = np.sqrt((deltas ** 2).sum(axis=1))
        order = np.argsort(distances)[: self.k_neighbors]
        chosen = distances[order]
        weights = 1.0 / (chosen + 0.02)
        weights = weights / weights.sum()
        return order, chosen, weights

    @staticmethod
    def _weighted_mean(values, weights):
        numeric = []
        masked_weights = []
        for value, weight in zip(values, weights):
            try:
                number = float(value)
            except (TypeError, ValueError):
                continue
            if math.isfinite(number):
                numeric.append(number)
                masked_weights.append(float(weight))

        if not numeric:
            return None

        masked_weights = np.array(masked_weights, dtype=float)
        masked_weights = masked_weights / masked_weights.sum()
        return float(np.dot(np.array(numeric, dtype=float), masked_weights))

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def predict(self, metal_pct, ligand_pct, bsa_pct, concentration, wash):
        if not self.is_within_supported_domain(metal_pct, ligand_pct, bsa_pct, concentration):
            raise ValueError(
                "Prediction outside the experimentally supported composition domain is disabled."
            )

        wash_norm = normalise_wash(wash)
        wash_code = 1.0 if wash_norm == "ethanol" else 0.0

        # kNN neighbours (always needed for regression + trust distance)
        query_scaled = self._scale_query(metal_pct, ligand_pct, concentration, wash)
        order, distances, weights = self._neighbor_weights(query_scaled)
        neighbors = [self.points[i] for i in order]
        nearest_distance = float(distances[0])

        # Phase scores: RF if available, kNN fallback otherwise
        if self._rf_classifier is not None:
            phase_scores = self._rf_phase_scores(metal_pct, ligand_pct, concentration, wash_code)
            classifier_used = "RF+ET ensemble"
        else:
            phase_scores = {phase: 0.0 for phase in PHASES}
            for neighbor, weight in zip(neighbors, weights):
                phase = str(neighbor["primary_phase"] or "Amorphous")
                if phase not in phase_scores:
                    phase = "Amorphous"
                phase_scores[phase] += float(weight)
            classifier_used = "kNN"

        top_phase = max(phase_scores.items(), key=lambda item: item[1])[0]

        nearest = []
        for neighbor, distance in zip(neighbors[:5], distances[:5]):
            nearest.append(
                {
                    "point_id": neighbor["point_id"],
                    "phase": neighbor["primary_phase"],
                    "distance": float(distance),
                    "wash": neighbor["wash"],
                    "concentration": neighbor["concentration"],
                }
            )

        return {
            "query": {
                "metal_pct": metal_pct,
                "ligand_pct": ligand_pct,
                "bsa_pct": bsa_pct,
                "concentration": concentration,
                "wash": wash_norm,
            },
            "predictions": {
                "phase_probabilities": phase_scores,
                "top_phase": top_phase,
                "top_phase_low_data_warning": top_phase in self._low_data_phases,
                "encapsulation_efficiency_mean": self._weighted_mean([row["ee_mean"] for row in neighbors], weights),
                "encapsulation_efficiency_std": self._weighted_mean([row["ee_std"] for row in neighbors], weights),
                "lc_percent_mean": self._weighted_mean([row["lc_percent"] for row in neighbors], weights),
                "crystalline_fraction_mean": self._weighted_mean([row["crystalline_mean"] for row in neighbors], weights),
                "crystalline_fraction_std": self._weighted_mean([row["crystalline_std"] for row in neighbors], weights),
                "amorphous_fraction_mean": self._weighted_mean([row["amorphous_mean"] for row in neighbors], weights),
                "amorphous_fraction_std": self._weighted_mean([row["amorphous_std"] for row in neighbors], weights),
                "atr_ratio_mean": self._weighted_mean([row["atr_ratio"] for row in neighbors], weights),
            },
            "trust": {
                "distance_to_known": nearest_distance,
                "confidence_band": self._confidence_band(nearest_distance),
                "near_threshold": self._near_threshold,
                "far_threshold": self._far_threshold,
                "classifier": classifier_used,
            },
            "neighbors": nearest,
            "method": (
                "Random Forest phase classifier + k-NN regression"
                if self._rf_classifier else
                "k-NN prototype predictor"
            ),
        }

    def build_grid(
        self,
        wash,
        concentrations=None,
        composition_step=5.0,
        include_intermediate_layers=False,
    ):
        wash_value = normalise_wash(wash)
        step = float(composition_step)
        layers = concentrations or self.available_concentrations

        if include_intermediate_layers and len(layers) > 1:
            expanded_layers = []
            for index, layer in enumerate(layers[:-1]):
                next_layer = layers[index + 1]
                expanded_layers.append(float(layer))
                expanded_layers.append(float((layer + next_layer) / 2))
            expanded_layers.append(float(layers[-1]))
            layers = expanded_layers

        if step <= 0:
            raise ValueError("composition_step must be positive")

        grid_points = []
        scaled = int(round(100 / step))
        composition_values = [round(i * step, 6) for i in range(scaled + 1)]

        for concentration in layers:
            for metal_pct in composition_values:
                remaining = 100.0 - metal_pct
                ligand_steps = int(round(remaining / step))

                for j in range(ligand_steps + 1):
                    ligand_pct = round(j * step, 6)
                    bsa_pct = round(100.0 - metal_pct - ligand_pct, 6)
                    if bsa_pct < -1e-9:
                        continue

                    bsa_pct = max(0.0, bsa_pct)
                    if not self.is_within_supported_domain(
                        metal_pct=metal_pct,
                        ligand_pct=ligand_pct,
                        bsa_pct=bsa_pct,
                        concentration=float(concentration),
                    ):
                        continue

                    prediction = self.predict(
                        metal_pct=metal_pct,
                        ligand_pct=ligand_pct,
                        bsa_pct=bsa_pct,
                        concentration=float(concentration),
                        wash=wash_value,
                    )

                    preds = prediction["predictions"]
                    phase_scores = preds["phase_probabilities"]

                    phase_composition = {
                        phase: {"mean": float(phase_scores.get(phase, 0.0)), "std": None}
                        for phase in PHASES_WITH_CRYSTALLINE_COMPONENTS
                    }

                    grid_points.append(
                        {
                            "id": f"pred_{wash_value}_{concentration}_{metal_pct}_{ligand_pct}_{bsa_pct}",
                            "label": "Predicted grid point",
                            "is_predicted": True,
                            "x": None,
                            "y": None,
                            "z": float(concentration),
                            "metal": float(metal_pct),
                            "ligand": float(ligand_pct),
                            "bsa": float(bsa_pct),
                            "uses_real_ternary": True,
                            "conc": str(concentration),
                            "concentration": float(concentration),
                            "concentration_label": str(concentration),
                            "wash_code": "EW" if wash_value == "ethanol" else "WW",
                            "wash": "EW" if wash_value == "ethanol" else "WW",
                            "washing": "ethanol washing" if wash_value == "ethanol" else "water washing",
                            "layer": str(concentration),
                            "phase": preds["top_phase"],
                            "primary_phase": preds["top_phase"],
                            "detected_phases": preds["top_phase"],
                            "phase_composition": phase_composition,
                            "phase_probabilities": phase_scores,
                            "ee": preds["encapsulation_efficiency_mean"],
                            "ee_error": preds["encapsulation_efficiency_std"],
                            "lc_percent": preds["lc_percent_mean"],
                            "protein_ratio": preds["atr_ratio_mean"],
                            "crystallinity": preds["crystalline_fraction_mean"],
                            "crystallinity_std": preds["crystalline_fraction_std"],
                            "amorphousness": preds["amorphous_fraction_mean"],
                            "amorphousness_std": preds["amorphous_fraction_std"],
                            "crystallinity_uncertainty": preds["crystalline_fraction_std"],
                            "relative_crystallinity": preds["crystalline_fraction_mean"],
                            "prediction_confidence": float(phase_scores.get(preds["top_phase"], 0.0)),
                            "distance_to_known": prediction["trust"]["distance_to_known"],
                            "trust_band": prediction["trust"]["confidence_band"],
                            "low_data_warning": preds.get("top_phase_low_data_warning", False),
                            "is_intermediate_layer": concentration not in self.available_concentrations,
                            "classifier": prediction["trust"].get("classifier", "kNN"),
                        }
                    )

        return grid_points
