import re
import pandas as pd
from .config import TERNARY_MAP


def ternary_xy(m, l, b):
    total = m + l + b
    if total == 0:
        return 0.0, 0.0
    m, l, b = m / total, l / total, b / total
    x = l + 0.5 * b
    y = (3 ** 0.5 / 2.0) * b
    return x, y


def norm_text(v, default=None):
    if v is None:
        return default
    try:
        if pd.isna(v):
            return default
    except Exception:
        pass
    s = str(v).strip()
    return s if s != "" else default


def norm_float(v, default=None):
    if v is None:
        return default
    try:
        if pd.isna(v):
            return default
    except Exception:
        pass
    try:
        return float(v)
    except Exception:
        return default


def get_formulation_composition(point_key: str):
    m = re.fullmatch(r"([0-9]+(?:\.[0-9]+)?)_([0-9]+)_(EW|WW)", str(point_key).strip(), flags=re.I)
    if not m:
        return None

    _, formulation, _ = m.groups()
    formulation_idx = int(formulation)

    triplet = TERNARY_MAP.get(formulation_idx)
    if not triplet:
        return None

    metal, ligand, bsa = triplet
    return {
        "metal": metal,
        "ligand": ligand,
        "bsa": bsa,
    }