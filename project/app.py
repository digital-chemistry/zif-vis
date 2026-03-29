from pathlib import Path
from flask import Flask

from .data_loader import load_data, build_atr_index, build_full_experiment_index
from .routes import register_routes

BASE_DIR = Path(__file__).resolve().parent

app = Flask(
    __name__,
    template_folder=str(BASE_DIR / "templates"),
    static_folder=str(BASE_DIR / "static"),
)

POINTS, POINT_DETAILS, EXPERIMENT_DETAILS = load_data()

register_routes(
    app,
    POINTS,
    POINT_DETAILS,
    EXPERIMENT_DETAILS,
    build_atr_index,
    build_full_experiment_index,
)

if __name__ == "__main__":
    app.run(debug=True, port=8000)