import os
from pathlib import Path

from flask import Flask
from werkzeug.middleware.proxy_fix import ProxyFix

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

    points, point_details, experiment_details = load_data()
    predictor = CompositionPredictor(points)

    register_routes(
        app,
        points,
        point_details,
        experiment_details,
        predictor,
        build_atr_index,
        build_full_experiment_index,
    )

    return app


app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    debug = os.environ.get("FLASK_DEBUG", "").lower() in {"1", "true", "yes"}
    app.run(debug=debug, port=port)
