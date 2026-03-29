from __future__ import annotations

import math

import numpy as np


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


def normalise_wash(raw: str) -> str:
    text = str(raw or "").strip().lower()
    if "eth" in text:
        return "ethanol"
    if "water" in text:
        return "water"
    return text or "ethanol"


def confidence_band(distance_to_known: float) -> str:
    if distance_to_known <= 0.08:
        return "near known data"
    if distance_to_known <= 0.16:
        return "moderate extrapolation"
    return "far from measured data"


class CompositionPredictor:
    def __init__(self, points: list[dict], k_neighbors: int = 12):
        self.k_neighbors = k_neighbors
        usable = []

        for point in points:
            try:
                usable.append(
                    {
                        "point_id": point.get("id"),
                        "metal_pct": float(point.get("metal")),
                        "ligand_pct": float(point.get("ligand")),
                        "bsa_pct": float(point.get("bsa")),
                        "concentration": float(point.get("concentration")),
                        "wash": normalise_wash(point.get("washing") or point.get("wash")),
                        "wash_code": 1.0 if normalise_wash(point.get("washing") or point.get("wash")) == "ethanol" else 0.0,
                        "primary_phase": point.get("primary_phase") or point.get("phase") or "Amorphous",
                        "ee_mean": point.get("ee"),
                        "ee_std": point.get("ee_error") if point.get("ee_error") is not None else point.get("ee_std"),
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
        self.feature_matrix = np.array(
            [
                [
                    row["metal_pct"],
                    row["ligand_pct"],
                    row["bsa_pct"],
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
            {
                float(row["concentration"])
                for row in usable
                if row.get("concentration") is not None
            }
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

    def is_within_supported_domain(
        self,
        metal_pct: float,
        ligand_pct: float,
        bsa_pct: float,
        concentration: float,
    ) -> bool:
        return (
            self.component_bounds["metal_pct"][0] <= metal_pct <= self.component_bounds["metal_pct"][1]
            and self.component_bounds["ligand_pct"][0] <= ligand_pct <= self.component_bounds["ligand_pct"][1]
            and self.component_bounds["bsa_pct"][0] <= bsa_pct <= self.component_bounds["bsa_pct"][1]
            and self.component_bounds["concentration"][0] <= concentration <= self.component_bounds["concentration"][1]
        )

    def _scale_query(self, metal_pct: float, ligand_pct: float, bsa_pct: float, concentration: float, wash: str) -> np.ndarray:
        wash_code = 1.0 if normalise_wash(wash) == "ethanol" else 0.0
        query = np.array([metal_pct, ligand_pct, bsa_pct, concentration, wash_code], dtype=float)
        return (query - self.feature_min) / self.feature_span

    def _neighbor_weights(self, query_scaled: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        deltas = self.scaled_features - query_scaled
        distances = np.sqrt((deltas ** 2).sum(axis=1))
        order = np.argsort(distances)[: self.k_neighbors]
        chosen = distances[order]
        weights = 1.0 / (chosen + 0.02)
        weights = weights / weights.sum()
        return order, chosen, weights

    @staticmethod
    def _weighted_mean(values: list[object], weights: np.ndarray) -> float | None:
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

    def predict(self, metal_pct: float, ligand_pct: float, bsa_pct: float, concentration: float, wash: str) -> dict:
        if not self.is_within_supported_domain(metal_pct, ligand_pct, bsa_pct, concentration):
            raise ValueError(
                "Prediction outside the experimentally supported composition domain is disabled."
            )

        query_scaled = self._scale_query(metal_pct, ligand_pct, bsa_pct, concentration, wash)
        order, distances, weights = self._neighbor_weights(query_scaled)
        neighbors = [self.points[i] for i in order]

        phase_scores = {phase: 0.0 for phase in PHASES}
        for neighbor, weight in zip(neighbors, weights):
            phase = str(neighbor["primary_phase"] or "Amorphous")
            if phase not in phase_scores:
                phase = "Amorphous"
            phase_scores[phase] += float(weight)

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
                "wash": normalise_wash(wash),
            },
            "predictions": {
                "phase_probabilities": phase_scores,
                "top_phase": top_phase,
                "encapsulation_efficiency_mean": self._weighted_mean([row["ee_mean"] for row in neighbors], weights),
                "encapsulation_efficiency_std": self._weighted_mean([row["ee_std"] for row in neighbors], weights),
                "crystalline_fraction_mean": self._weighted_mean([row["crystalline_mean"] for row in neighbors], weights),
                "crystalline_fraction_std": self._weighted_mean([row["crystalline_std"] for row in neighbors], weights),
                "amorphous_fraction_mean": self._weighted_mean([row["amorphous_mean"] for row in neighbors], weights),
                "amorphous_fraction_std": self._weighted_mean([row["amorphous_std"] for row in neighbors], weights),
                "atr_ratio_mean": self._weighted_mean([row["atr_ratio"] for row in neighbors], weights),
            },
            "trust": {
                "distance_to_known": float(distances[0]),
                "confidence_band": confidence_band(float(distances[0])),
            },
            "neighbors": nearest,
            "method": "Prototype prediction from nearby measured compositions",
        }

    def build_grid(
        self,
        wash: str,
        concentrations: list[float] | None = None,
        composition_step: float = 5.0,
    ) -> list[dict]:
        wash_value = normalise_wash(wash)
        step = float(composition_step)
        layers = concentrations or self.available_concentrations

        if step <= 0:
            raise ValueError("composition_step must be positive")

        grid_points: list[dict] = []
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
                        }
                    )

        return grid_points
