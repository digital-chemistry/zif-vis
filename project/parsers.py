import re
from pathlib import Path


def parse_json_sample_id(sample_id: str, round_value=None):
    s = str(sample_id).strip()
    m = re.fullmatch(r"([0-9]+(?:\.[0-9]+)?)_([0-9]+)_([A-Za-z]+)(?:_([0-9]+))?", s)
    if not m:
        return None

    conc, formulation, wash, sample_run = m.groups()
    conc = str(conc)
    formulation = f"{int(formulation):02d}"
    wash = wash.upper()

    round_no = None

    if round_value is not None:
        r = str(round_value).strip()
        mr = re.fullmatch(r"(?i)round[_\s-]*([0-9]+)", r)
        if mr:
            round_no = f"{int(mr.group(1)):02d}"

    if round_no is None and sample_run is not None:
        round_no = f"{int(sample_run):02d}"

    if round_no is None:
        round_no = "01"

    return {
        "conc": conc,
        "formulation": formulation,
        "wash": wash,
        "round": round_no,
        "point_key": f"{conc}_{formulation}_{wash}",
        "experiment_key": f"{conc}_{formulation}_{wash}_{round_no}",
        "atr_key": f"{conc}_{wash}_{round_no}",
    }


def parse_atr_filename(filename: str):
    stem = Path(filename).stem.strip()
    m = re.fullmatch(r"A?([0-9]+(?:\.[0-9]+)?)(EW|WW)-([0-9]+)", stem, flags=re.I)
    if not m:
        return None

    conc, wash, round_no = m.groups()
    return f"{conc}_{wash.upper()}_{int(round_no):02d}"


def parse_full_experiment_filename(filename: str):
    stem = Path(filename).stem.strip()
    m = re.fullmatch(r"([0-9]+(?:\.[0-9]+)?)_([0-9]+)_([A-Za-z]+)_([0-9]+)", stem, flags=re.I)
    if not m:
        return None

    conc, formulation, wash, round_no = m.groups()
    return f"{conc}_{int(formulation):02d}_{wash.upper()}_{int(round_no):02d}"