import unittest

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


if __name__ == "__main__":
    unittest.main()
