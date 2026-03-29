import json

from .config import MASTER_JSON, ATR_DIR, XRD_DIR
from .io_utils import find_existing_file
from .transform import ternary_xy


def normalise_wash_label(washing: str) -> str:
    s = str(washing or "").strip().lower()
    if "eth" in s:
        return "EW"
    if "water" in s:
        return "WW"
    return str(washing or "").strip()


def build_measurement_experiment_id(filename: str) -> str | None:
    if not filename:
        return None
    stem = filename.rsplit(".", 1)[0].strip()
    return stem or None


def build_atr_index():
    index = {}
    if not ATR_DIR.exists():
        return index
    for p in ATR_DIR.glob("*"):
        if p.is_file():
            index[p.stem] = p.name
    return index


def build_full_experiment_index(folder):
    index = {}
    if not folder.exists():
        return index
    for p in folder.glob("*"):
        if p.is_file():
            index[p.stem] = p.name
    return index


def pretty_wash_label(wash_code: str, raw: str):
    if wash_code == "WW":
        return "water washing"
    if wash_code == "EW":
        return "ethanol washing"
    return raw


def resolve_atr_file(concentration, wash_code, round_no):
    stem = f"A{int(concentration) if concentration is not None else concentration}{wash_code}-{int(round_no):02d}"
    return find_existing_file(ATR_DIR, stem)


def load_data():
    if not MASTER_JSON.exists():
        raise FileNotFoundError(f"Missing JSON file: {MASTER_JSON}")

    with open(MASTER_JSON, "r", encoding="utf-8") as f:
        raw = json.load(f)

    xrd_index = build_full_experiment_index(XRD_DIR)

    points = []
    point_details = {}
    experiment_details = {}

    for point_id, entry in raw.items():
        washing_raw = entry.get("washing", "")
        wash_code = normalise_wash_label(washing_raw)
        washing_label = pretty_wash_label(wash_code, washing_raw)

        concentration = entry.get("concentration")
        composition = entry.get("composition", {}) or {}
        metal = composition.get("M_percent")
        ligand = composition.get("L_percent")
        bsa = composition.get("BSA_percent")

        x = y = None
        uses_real_ternary = False
        if all(v is not None for v in (metal, ligand, bsa)):
            x, y = ternary_xy(float(metal), float(ligand), float(bsa))
            uses_real_ternary = True

        phase_comp = entry.get("phase_composition", {}) or {}
        phase_candidates = [
            (name, vals.get("mean", 0.0))
            for name, vals in phase_comp.items()
            if isinstance(vals, dict)
        ]
        phase_candidates.sort(key=lambda t: t[1], reverse=True)

        nonzero_phases = [name for name, val in phase_candidates if float(val or 0) > 0]
        primary_phase = nonzero_phases[0] if nonzero_phases else "Amorphous"
        detected_phases = ", ".join(nonzero_phases) if nonzero_phases else "Amorphous"

        cryst_mean = (
            entry.get("crystallinity", {})
            .get("fractions", {})
            .get("crystalline", {})
            .get("mean")
        )
        amorphous_mean = (
            entry.get("crystallinity", {})
            .get("fractions", {})
            .get("amorphous", {})
            .get("mean")
        )

        ee_mean = (
            entry.get("encapsulation_efficiency", {})
            .get("mean")
        )

        protein_ratio = (
            entry.get("ir_data", {})
            .get("ratio_selected_peaks")
        )

        experiments = []
        measurements = entry.get("measurements", {}) or {}
        for round_name, filename in measurements.items():
            round_no = "".join(ch for ch in str(round_name) if ch.isdigit()) or "1"
            experiment_id = build_measurement_experiment_id(filename) or f"{point_id}_{int(round_no):02d}"

            xrd_file = xrd_index.get(experiment_id)
            atr_file = entry.get("atr_file") if str(round_no) in {"1", "01"} else resolve_atr_file(concentration, wash_code, round_no)

            exp = {
                "experiment_id": experiment_id,
                "sample_id": experiment_id,
                "point_id": point_id,
                "id": experiment_id,
                "phase": primary_phase,
                "primary_phase": primary_phase,
                "detected_phases": detected_phases,
                "phase_label": detected_phases,
                "phase_composition": phase_comp,
                "signal_class": "N/A",
                "layer": str(concentration),
                "washing": washing_label,
                "wash": wash_code,
                "wash_code": wash_code,
                "concentration": concentration,
                "concentration_label": str(concentration),
                "ee": ee_mean,
                "encapsulation_efficiency": ee_mean,
                "protein_ratio": protein_ratio,
                "round": round_name,
                "round_no": round_no,
                "conc": str(concentration),
                "formulation": point_id.split("_")[1] if "_" in point_id else None,
                "crystallinity": cryst_mean,
                "amorphousness": amorphous_mean,
                "relative_crystallinity": cryst_mean,
                "x": x,
                "y": y,
                "z": concentration if concentration is not None else 0.0,
                "metal": metal,
                "ligand": ligand,
                "bsa": bsa,
                "uses_real_ternary": uses_real_ternary,
                "atr_file": atr_file,
                "xrd_file": xrd_file,
                "img_file": None,
                "has_atr": atr_file is not None,
                "has_xrd": xrd_file is not None,
                "has_image": False,
            }
            experiments.append(exp)
            experiment_details[experiment_id] = exp

        point_summary = {
            "id": point_id,
            "sample_id": point_id,
            "x": x,
            "y": y,
            "z": concentration if concentration is not None else 0.0,
            "metal": metal,
            "ligand": ligand,
            "bsa": bsa,
            "uses_real_ternary": uses_real_ternary,
            "conc": str(concentration),
            "concentration": concentration,
            "concentration_label": str(concentration),
            "formulation": point_id.split("_")[1] if "_" in point_id else None,
            "wash_code": wash_code,
            "wash": wash_code,
            "washing": washing_label,
            "layer": str(concentration),
            "n_experiments": len(experiments),
            "experiment_ids": [e["experiment_id"] for e in experiments],
            "first_experiment_id": experiments[0]["experiment_id"] if experiments else None,
            "has_atr": any(e["has_atr"] for e in experiments),
            "has_xrd": any(e["has_xrd"] for e in experiments),
            "has_image": False,
            "phases": [name for name, _ in phase_candidates],
            "phase": primary_phase,
            "primary_phase": primary_phase,
            "detected_phases": detected_phases,
            "phase_composition": phase_comp,
            "ee": ee_mean,
            "encapsulation_efficiency": ee_mean,
            "protein_ratio": protein_ratio,
            "crystallinity": cryst_mean,
            "amorphousness": amorphous_mean,
            "relative_crystallinity": cryst_mean,
            "experiments": experiments,
        }

        points.append(point_summary)
        point_details[point_id] = point_summary

    return points, point_details, experiment_details