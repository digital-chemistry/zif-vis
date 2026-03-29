import json

from .config import MASTER_JSON, ATR_DIR, XRD_DIR, IMG_DIR
from .io_utils import find_existing_file
from .transform import ternary_xy


def format_concentration_for_filename(value):
    if value is None:
        return ""
    n = float(value)
    if n.is_integer():
        return str(int(n))
    return str(n)


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
    conc_str = format_concentration_for_filename(concentration)
    stem = f"A{conc_str}{wash_code}-{round_no}"
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
        composition = entry.get("composition", {})
        metal = composition.get("M_percent")
        ligand = composition.get("L_percent")
        bsa = composition.get("BSA_percent")

        x = y = None
        uses_real_ternary = False
        if metal is not None and ligand is not None and bsa is not None:
            x, y = ternary_xy(float(metal), float(ligand), float(bsa))
            uses_real_ternary = True

        cryst_mean = (
            entry.get("crystallinity", {})
            .get("fractions", {})
            .get("crystalline", {})
            .get("mean")
        )

        ee_mean = entry.get("encapsulation_efficiency", {}).get("mean")
        protein_ratio = entry.get("ir_data", {}).get("ratio_selected_peaks")

        phase_comp = entry.get("phase_composition", {})
        phase_candidates = []
        for phase_name, vals in phase_comp.items():
            mean_val = (vals or {}).get("mean", 0) or 0
            if mean_val > 0:
                phase_candidates.append((phase_name, mean_val))
        phase_candidates.sort(key=lambda t: t[1], reverse=True)

        primary_phase = phase_candidates[0][0] if phase_candidates else "Amorphous"
        detected_phases = " | ".join([name for name, _ in phase_candidates]) if phase_candidates else "N/A"

        experiments = []
        measurements = entry.get("measurements", {})

        for round_name, filename in sorted(measurements.items()):
            experiment_id = build_measurement_experiment_id(filename)
            if not experiment_id:
                continue

            round_no = "".join(ch for ch in str(round_name) if ch.isdigit()).zfill(2)
            xrd_file = xrd_index.get(experiment_id) or find_existing_file(XRD_DIR, experiment_id)
            atr_file = resolve_atr_file(concentration, wash_code, round_no)

            exp = {
                "experiment_id": experiment_id,
                "sample_id": experiment_id,
                "point_id": point_id,
                "id": experiment_id,
                "phase": primary_phase,
                "primary_phase": primary_phase,
                "detected_phases": detected_phases,
                "phase_label": detected_phases,
                "signal_class": "N/A",
                "layer": str(concentration),
                "washing": washing_label,
                "wash": wash_code,
                "wash_code": wash_code,
                "concentration": concentration,
                "concentration_label": str(concentration),
                "ee": ee_mean,
                "protein_ratio": protein_ratio,
                "round": round_name,
                "round_no": round_no,
                "conc": str(concentration),
                "formulation": point_id.split("_")[1] if "_" in point_id else None,
                "crystallinity": cryst_mean,
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
            "ee": ee_mean,
            "protein_ratio": protein_ratio,
            "crystallinity": cryst_mean,
            "relative_crystallinity": cryst_mean,
            "experiments": experiments,
        }

        points.append(point_summary)
        point_details[point_id] = point_summary

    points.sort(key=lambda p: p["id"])
    return points, point_details, experiment_details