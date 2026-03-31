import os
from pathlib import Path

from flask import Flask
from werkzeug.middleware.proxy_fix import ProxyFix

from .config import MASTER_JSON, MANUAL_JSON
from .data_loader import load_data, build_atr_index, build_full_experiment_index
from .predictor import CompositionPredictor
from .routes import register_routes

BASE_DIR = Path(__file__).resolve().parent


def create_app():
    app = Flask(
        __name__,
        template_folder=str(BASE_DIR / "templates"),
        static_folder=str(BASE_DIR / "static"),
    )

    # Honor reverse-proxy scheme/host headers in production.
    app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)

    datasets = {}

    def register_dataset(key, path):
        points, point_details, experiment_details = load_data(path)
        datasets[key] = {
            "key": key,
            "label": "Manual" if key == "manual" else "Primary",
            "json_path": str(path),
            "points": points,
            "point_details": point_details,
            "experiment_details": experiment_details,
            "predictor": CompositionPredictor(points),
        }

    register_dataset("primary", MASTER_JSON)
    if MANUAL_JSON.exists():
        register_dataset("manual", MANUAL_JSON)

    register_routes(
        app,
        datasets,
        build_atr_index,
        build_full_experiment_index,
    )

    return app


app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    debug = os.environ.get("FLASK_DEBUG", "").lower() in {"1", "true", "yes"}
    app.run(debug=debug, port=port)
