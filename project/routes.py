from flask import jsonify, render_template, send_from_directory, abort, request

from .config import ATR_DIR, XRD_DIR, IMG_DIR
from .io_utils import read_xy, find_existing_file


def register_routes(app, points, point_details, experiment_details, predictor, build_atr_index, build_full_experiment_index):
    def resolve_best_experiment_for_kind(identifier: str, kind: str):
        if identifier in experiment_details:
            return experiment_details[identifier]

        point = point_details.get(identifier)
        if not point:
            return None

        experiments = point.get("experiments", [])

        if kind == "atr":
            for exp in experiments:
                if exp.get("has_atr"):
                    return exp
        elif kind == "xrd":
            for exp in experiments:
                if exp.get("has_xrd"):
                    return exp
        elif kind == "image":
            for exp in experiments:
                if exp.get("has_image"):
                    return exp

        return experiments[0] if experiments else None

    @app.route("/")
    def index():
        return render_template("index.html")

    @app.route("/api/points")
    def api_points():
        return jsonify(points)

    @app.route("/api/sample/<point_id>")
    def api_sample(point_id):
        sample = point_details.get(point_id)
        if not sample:
            abort(404)
        return jsonify(sample)

    @app.route("/api/experiment/<experiment_id>")
    def api_experiment(experiment_id):
        exp = experiment_details.get(experiment_id)
        if not exp:
            abort(404)
        return jsonify(exp)

    @app.route("/api/spectrum/<kind>/<identifier>")
    def api_spectrum(kind, identifier):
        if kind not in {"atr", "xrd"}:
            abort(404)

        exp = resolve_best_experiment_for_kind(identifier, kind)
        if not exp:
            abort(404)

        if kind == "atr":
            atr_file = exp.get("atr_file")
            if atr_file:
                return jsonify(read_xy(ATR_DIR / atr_file))
            return jsonify({"x": [], "y": []})

        xrd_file = exp.get("xrd_file") or find_existing_file(XRD_DIR, exp.get("experiment_id", ""))
        if xrd_file:
            return jsonify(read_xy(XRD_DIR / xrd_file))
        return jsonify({"x": [], "y": []})

    @app.route("/api/image/<identifier>")
    def api_image(identifier):
        exp = resolve_best_experiment_for_kind(identifier, "image")
        if not exp:
            abort(404)

        img_file = exp.get("img_file") or find_existing_file(IMG_DIR, exp.get("experiment_id", ""))
        if not img_file:
            abort(404)

        return send_from_directory(IMG_DIR, img_file)

    @app.route("/api/predict", methods=["POST"])
    def api_predict():
        payload = request.get_json(silent=True) or {}

        try:
            metal_pct = float(payload.get("metal_pct"))
            ligand_pct = float(payload.get("ligand_pct"))
            bsa_pct = float(payload.get("bsa_pct"))
            concentration = float(payload.get("concentration"))
        except (TypeError, ValueError):
            return jsonify({"error": "Invalid numeric prediction input."}), 400

        total = metal_pct + ligand_pct + bsa_pct
        if not all(0 <= value <= 100 for value in (metal_pct, ligand_pct, bsa_pct)):
            return jsonify({"error": "Composition percentages must stay between 0 and 100."}), 400
        if abs(total - 100) > 0.25:
            return jsonify({"error": "Metal + Ligand + BSA must equal 100."}), 400

        wash = payload.get("wash") or "ethanol"
        try:
            prediction = predictor.predict(
                metal_pct=metal_pct,
                ligand_pct=ligand_pct,
                bsa_pct=bsa_pct,
                concentration=concentration,
                wash=wash,
            )
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 422
        return jsonify(prediction)

    @app.route("/api/prediction-grid")
    def api_prediction_grid():
        wash = request.args.get("wash", "ethanol")
        step_raw = request.args.get("step", "5")

        try:
            step = float(step_raw)
        except (TypeError, ValueError):
            return jsonify({"error": "Invalid composition step."}), 400

        if step <= 0 or step > 25:
            return jsonify({"error": "Composition step must be between 0 and 25."}), 400

        grid = predictor.build_grid(wash=wash, composition_step=step)
        return jsonify(grid)

    @app.route("/api/debug/files")
    def api_debug_files():
        atr_index = build_atr_index()
        xrd_index = build_full_experiment_index(XRD_DIR)
        img_index = build_full_experiment_index(IMG_DIR)

        return jsonify({
            "points_count": len(points),
            "experiments_count": len(experiment_details),
            "atr_count": len(atr_index),
            "xrd_count": len(xrd_index),
            "img_count": len(img_index),
            "point_examples": points[:5],
            "atr_examples": dict(list(sorted(atr_index.items()))[:10]),
            "xrd_examples": dict(list(sorted(xrd_index.items()))[:10]),
            "img_examples": dict(list(sorted(img_index.items()))[:10]),
        })

    @app.route("/api/debug/experiment/<experiment_id>")
    def api_debug_experiment(experiment_id):
        exp = experiment_details.get(experiment_id)
        if not exp:
            abort(404)

        return jsonify({
            "experiment_id": experiment_id,
            "stored_xrd_file": exp.get("xrd_file"),
            "stored_img_file": exp.get("img_file"),
            "fallback_xrd_file": find_existing_file(XRD_DIR, experiment_id),
            "fallback_img_file": find_existing_file(IMG_DIR, experiment_id),
            "has_xrd": exp.get("has_xrd"),
            "has_image": exp.get("has_image"),
        })
