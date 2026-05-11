import unittest

from project.app import create_app


class AppSmokeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = create_app()
        cls.app.testing = True
        cls.client = cls.app.test_client()

        points_response = cls.client.get("/api/points")
        cls.points = points_response.get_json() or []
        cls.first_point_id = cls.points[0]["id"] if cls.points else None

    def test_index_renders(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("ZIF Biocomposite Explorer", response.get_data(as_text=True))

    def test_basic_security_headers_present(self):
        response = self.client.get("/")
        self.assertEqual(response.headers.get("X-Content-Type-Options"), "nosniff")
        self.assertEqual(response.headers.get("X-Frame-Options"), "SAMEORIGIN")
        self.assertEqual(response.headers.get("Referrer-Policy"), "same-origin")

    def test_datasets_endpoint_lists_primary(self):
        response = self.client.get("/api/datasets")
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertIsInstance(payload, list)
        self.assertIn("primary", {entry.get("key") for entry in payload})

    def test_points_endpoint_returns_points(self):
        response = self.client.get("/api/points")
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertIsInstance(payload, list)
        self.assertGreater(len(payload), 0)

    def test_sample_endpoint_returns_known_point(self):
        self.assertIsNotNone(self.first_point_id)
        response = self.client.get(f"/api/sample/{self.first_point_id}")
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload.get("id"), self.first_point_id)

    def test_prediction_grid_accepts_valid_step(self):
        response = self.client.get("/api/prediction-grid?step=10")
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertIsInstance(payload, list)

    def test_prediction_grid_rejects_invalid_step(self):
        response = self.client.get("/api/prediction-grid?step=30")
        self.assertEqual(response.status_code, 400)
        payload = response.get_json()
        self.assertIn("error", payload)

    def test_predict_rejects_invalid_payload(self):
        response = self.client.post("/api/predict", json={"metal_pct": "bad"})
        self.assertEqual(response.status_code, 400)
        payload = response.get_json()
        self.assertIn("error", payload)


if __name__ == "__main__":
    unittest.main()
