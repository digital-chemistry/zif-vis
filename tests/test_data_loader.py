import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from project.data_loader import load_data

from project.data_loader import (
    build_measurement_experiment_id,
    normalise_wash_label,
)


class DataLoaderUtilityTests(unittest.TestCase):
    def test_normalise_wash_label_maps_ethanol(self):
        self.assertEqual(normalise_wash_label("ethanol washing"), "EW")

    def test_normalise_wash_label_maps_water(self):
        self.assertEqual(normalise_wash_label("water washing"), "WW")

    def test_build_measurement_experiment_id_preserves_decimal_values(self):
        self.assertEqual(
            build_measurement_experiment_id("12.5_sample.xy"),
            "12.5_sample",
        )

    def test_build_measurement_experiment_id_returns_none_for_blank_input(self):
        self.assertIsNone(build_measurement_experiment_id(""))

    def test_load_data_threads_loading_capacity_into_points_and_details(self):
        sample_payload = {
            "100_01_EW": {
                "washing": "ethanol_washing",
                "concentration": 100.0,
                "measurements": {"Round_1": "100_01_EW_01.xy"},
                "composition": {
                    "M_percent": 10.0,
                    "L_percent": 10.0,
                    "BSA_percent": 80.0,
                },
                "crystallinity": {
                    "fractions": {
                        "crystalline": {"mean": 0.0, "std": 0.0},
                        "amorphous": {"mean": 1.0, "std": 0.0},
                    }
                },
                "phase_composition": {
                    "Sodalite": {"mean": 0.0, "std": 0.0}
                },
                "encapsulation_efficiency": {"mean": 94.5, "error_bar": 3.2},
                "ir_data": {"ratio_selected_peaks": 0.7615},
                "LC_percent": 42,
            }
        }

        with TemporaryDirectory() as tmpdir:
            json_path = Path(tmpdir) / "sample.json"
            json_path.write_text(__import__("json").dumps(sample_payload), encoding="utf-8")

            points, point_details, experiment_details = load_data(json_path)

        self.assertEqual(points[0]["lc_percent"], 42)
        self.assertEqual(point_details["100_01_EW"]["lc_percent"], 42)
        self.assertEqual(experiment_details["100_01_EW_01"]["lc_percent"], 42)


if __name__ == "__main__":
    unittest.main()
